import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';

export type OpenSpaceSource = 'registration' | 'approval' | 'user' | 'company_change';

export interface RealignmentResult {
  matchesRevoked: number;
  likesDeleted: number;
}

export interface OpenSpaceResult {
  /** Stato dell'Open space dopo la richiesta. */
  enabled: boolean;
  /** Solo oltre il limite delle attivazioni: da quando si potrà riattivare. */
  changeableAt: Date | null;
}

/**
 * Unico punto applicativo della regola core "colleghi, solo se vuoi". Non ricalcola nulla:
 * interroga le funzioni SQL (`can_see`, `can_interact`, `can_write`, `company_conflict`,
 * `mutual_open_space`, `set_open_space`, `realign_users`), anche dentro la transazione in corso.
 * Nessun altro modulo legge identità, esclusioni, blocchi o sanzioni per decidere la visibilità.
 */
@Injectable()
export class CoreRuleService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** A vede B: il mattone della regola (P8), simmetrico con D175. */
  async canSee(a: string, b: string, tx: Executor = this.db): Promise<boolean> {
    if (a === b) return false;
    return this.bool(tx, sql`select can_see(${a}::uuid, ${b}::uuid) as result`);
  }

  /** Visibilità reciproca: feed, profilo dal feed, swipe, nuovi match (D31, D58, P8). */
  async canInteract(a: string, b: string, tx: Executor = this.db): Promise<boolean> {
    if (a === b) return false;
    return this.bool(tx, sql`select can_interact(${a}::uuid, ${b}::uuid) as result`);
  }

  /** Messaggi e inviti in un match esistente (D59, D63, D64). */
  async canWrite(me: string, matchId: string, tx: Executor = this.db): Promise<boolean> {
    return this.bool(tx, sql`select can_write(${me}::uuid, ${matchId}::uuid) as result`);
  }

  /** Colleghi senza Open space reciproco, azienda non nota o tipi di account diversi. */
  async companyConflict(a: string, b: string, tx: Executor = this.db): Promise<boolean> {
    return this.bool(tx, sql`select company_conflict(${a}::uuid, ${b}::uuid) as result`);
  }

  /** Badge "Open space" (D168): solo tra colleghi con Open space reciproco. */
  async openSpaceColleagues(a: string, b: string, tx: Executor = this.db): Promise<boolean> {
    return this.bool(
      tx,
      sql`select (mutual_open_space(${a}::uuid, ${b}::uuid)
                  and (select x.company_id = y.company_id from users x, users y
                        where x.id = ${a}::uuid and y.id = ${b}::uuid)) is true as result`,
    );
  }

  /** Account visibile (stati, sanzioni, ripensamento, azienda in rimozione). */
  async accountVisible(userId: string, tx: Executor = this.db): Promise<boolean> {
    return this.bool(tx, sql`select account_visible(${userId}::uuid) as result`);
  }

  /** Revoca tra chi diventa collega senza Open space reciproco (D9, D58, D59, D140). */
  async realign(userIds: string[], tx: Executor): Promise<RealignmentResult> {
    const result = await tx.execute<{ matches_revoked: number; likes_deleted: number }>(
      sql`select * from realign_users(${`{${userIds.join(',')}}`}::uuid[])`,
    );
    const row = result.rows[0];
    return { matchesRevoked: row?.matches_revoked ?? 0, likesDeleted: row?.likes_deleted ?? 0 };
  }

  /**
   * Attivazione o spegnimento dell'Open space (D137, D139, D140): blocco della riga, limite
   * delle sole attivazioni, storico e, allo spegnimento, riallineamento nella stessa
   * transazione. Restituisce solo l'esito per l'utente stesso: mai nulla sui colleghi.
   */
  async setOpenSpace(
    me: string,
    enabled: boolean,
    source: OpenSpaceSource,
    textVersion: string | null,
    tx: Executor,
  ): Promise<OpenSpaceResult> {
    const result = await tx.execute<{ result: boolean; changeable_at: Date | string | null }>(
      sql`select * from set_open_space(${me}::uuid, ${enabled}, ${source}::open_space_source,
                                       ${textVersion})`,
    );
    const row = result.rows[0];
    return {
      enabled: row?.result === true,
      changeableAt: row?.changeable_at ? new Date(row.changeable_at) : null,
    };
  }

  private async bool(tx: Executor, query: ReturnType<typeof sql>): Promise<boolean> {
    const result = await tx.execute<{ result: boolean | null }>(query);
    return result.rows[0]?.result === true;
  }
}
