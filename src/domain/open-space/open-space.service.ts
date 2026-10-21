import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asDate } from '../../infra/database/timestamps';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { ParametersService } from '../parameters/parameters.service';
import {
  type ActiveMatch,
  activeMatchesOf,
  publishClosedMatches,
} from '../realtime/match-closures';
import { RealtimePublisher } from '../realtime/realtime-publisher';

export interface OpenSpaceStatus {
  enabled: boolean;
  since: Date | null;
  /** Dopo un cambio di azienda con l'Open space attivo: chiedere se riattivarlo (D197). */
  prompt: boolean;
  /** Attivazioni rimaste nei 30 giorni (5 ogni 30, D197); lo spegnimento non ha limiti. */
  changesRemaining: number;
  maxChanges: number;
  /** Solo oltre il limite: da quando si potrà riattivare. */
  changeableAt: Date | null;
  /**
   * Riepilogo dei filtri dell'utente stesso per il pannello dell'indicatore (D157): numero delle
   * proprie aziende escluse (anche in attesa) e delle persone bloccate; mai dati su altri.
   */
  filters: { excludedCompanies: number; blockedPeople: number };
}

/**
 * Open space dell'utente stesso (D137–D140, D156, D157, D166): lettura dello stato con il
 * riepilogo dei filtri, attivazione dopo la conferma (con la versione dei testi mostrati) entro
 * il limite, spegnimento sempre ammesso con il riallineamento nella stessa transazione. La
 * scrittura passa solo da `CoreRuleService.setOpenSpace` (`set_open_space`).
 */
@Injectable()
export class OpenSpaceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly coreRule: CoreRuleService,
    private readonly parameters: ParametersService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async status(userId: string, tx: Executor = this.db): Promise<OpenSpaceStatus> {
    const max = await this.parameters.int('open_space.max_changes', 5, tx);
    const days = await this.parameters.int('open_space.period_days', 30, tx);
    const result = await tx.execute<{
      open_space: boolean;
      open_space_since: Date | null;
      prompt: boolean;
      excluded: number;
      blocked: number;
    }>(sql`
      select x.open_space, x.open_space_since, x.open_space_prompt_at is not null as prompt,
             excluded_companies_total(x.id) as excluded,
             (select count(*)::int from blocks k
               where k.from_user_id = x.id and k.unblocked_at is null) as blocked
        from users x where x.id = ${userId}::uuid`);
    const row = result.rows[0];
    if (!row) throw ApiError.notFound();
    const changes = await tx.execute<{ changed_at: Date | string }>(sql`
      select changed_at from open_space_history
       where user_id = ${userId}::uuid and source = 'user'
         and changed_at > now() - make_interval(days => ${days})
       order by changed_at desc`);
    const used = changes.rows.length;
    const changeableAt =
      used >= max
        ? new Date(new Date(changes.rows[max - 1]!.changed_at).getTime() + days * 86_400_000)
        : null;
    return {
      enabled: row.open_space,
      since: asDate(row.open_space_since),
      prompt: row.prompt,
      changesRemaining: Math.max(0, max - used),
      maxChanges: max,
      changeableAt,
      filters: { excludedCompanies: row.excluded, blockedPeople: row.blocked },
    };
  }

  /**
   * Attiva o spegne. In approvazione l'origine è `approval`, fuori dal limite (D166); dopo
   * l'approvazione `user`. Oltre il limite l'attivazione riceve `429` neutro con la data.
   */
  async set(
    userId: string,
    enabled: boolean,
    textVersion: string | null,
  ): Promise<OpenSpaceStatus> {
    if (enabled && !textVersion) throw ApiError.badRequest('validation');
    let before: ActiveMatch[] = [];
    const status = await this.db.transaction(async (tx) => {
      const state = await tx.execute<{ status: string }>(
        sql`select status from users where id = ${userId}::uuid for update`,
      );
      const status = state.rows[0]?.status;
      if (!status) throw ApiError.notFound();
      const source = status === 'pending_approval' ? 'approval' : 'user';
      // Lo spegnimento chiude subito i match senza messaggi tra colleghi (D140)
      if (!enabled) before = await activeMatchesOf(tx, [userId]);
      const result = await this.coreRule.setOpenSpace(
        userId,
        enabled,
        source,
        enabled ? textVersion : null,
        tx,
      );
      if (enabled && result.changeableAt) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'openSpace.limit.reached', {
          date: result.changeableAt,
        });
      }
      return this.status(userId, tx);
    });
    await publishClosedMatches(this.db, this.realtime, before);
    return status;
  }
}
