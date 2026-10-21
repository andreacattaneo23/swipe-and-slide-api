import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { appeals, sanctions } from '../../infra/database/schema-safety';
import { RealtimePublisher } from '../realtime/realtime-publisher';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAction } from '../companies/companies.service';
import { NoticesService } from './notices.service';
import { SafetySettings } from './safety-settings.service';

export const SANCTION_TYPES = ['warning', 'disciplinary_suspension', 'expulsion'] as const;
export type DecidedSanctionType = (typeof SANCTION_TYPES)[number];
export const SEVERE_CASES = [
  'threats_violence',
  'minor_content',
  'fraud',
  'stalking',
  'colleague_rule_evasion',
  'false_statements',
] as const;
export type SevereCase = (typeof SEVERE_CASES)[number];

export interface SanctionInput {
  userId: string;
  type: DecidedSanctionType;
  severeCase?: SevereCase | null;
  reportId?: string | null;
  /** Motivazione per l'utente (D75, DSA art. 17): contenuto e regola violata, mai chi segnala. */
  userExplanation: string;
}

export interface UserSanction {
  id: string;
  type: string;
  severeCase: string | null;
  explanation: string;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
  appealDeadlineAt: Date | null;
  appeal: { status: 'pending' | 'accepted' | 'rejected'; submittedAt: Date } | null;
}

/**
 * Sanzioni (D75, D113): avviso, sospensione disciplinare di 7 giorni, espulsione, espulsione
 * immediata nei casi gravi. Sono righe di `sanctions`, non stati dell'account: sospensioni ed
 * espulsione rendono l'account invisibile tramite `account_visible`. All'espulsione le impronte
 * delle due email entrano in `blocked_hashes` per 2 anni e la cancellazione definitiva arriva
 * dopo 7 giorni senza un ricorso aperto (processo `complete-expulsions`).
 */
@Injectable()
export class SanctionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
    private readonly settings: SafetySettings,
    private readonly crypto: CryptoService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async apply(input: SanctionInput, by: OperatorAction, tx?: Executor): Promise<string> {
    if (input.severeCase && input.type !== 'expulsion') {
      throw ApiError.badRequest('validation', { field: 'severeCase' });
    }
    const run = async (executor: Executor): Promise<string> => {
      const exists = await executor.execute<{ id: string }>(
        sql`select id from users where id = ${input.userId}::uuid for update`,
      );
      if (!exists.rows.length) throw ApiError.notFound();
      const months = await this.settings.int('sanctions.appeal_months', 6);
      const days = await this.settings.int('sanctions.suspension_days', 7);
      // Collegamento del ricorso dopo la cancellazione: codice casuale, solo l'impronta (D75)
      const appealCode = input.type === 'expulsion' ? this.crypto.randomToken(24) : null;
      const [row] = await executor
        .insert(sanctions)
        .values({
          userId: input.userId,
          type: input.type,
          severeCase: input.severeCase ?? null,
          reportId: input.reportId ?? null,
          explanation: input.userExplanation.trim(),
          decidedBy: by.operatorId,
          endsAt:
            input.type === 'disciplinary_suspension'
              ? sql`now() + make_interval(days => ${days})`
              : null,
          appealDeadlineAt: sql`now() + make_interval(months => ${months})`,
          appealCodeHash: appealCode ? this.crypto.hash('appeal-code', appealCode) : null,
          notifiedAt: sql`now()`,
        })
        .returning({ id: sanctions.id });
      const id = row!.id;
      if (input.type !== 'warning') {
        await executor.execute(sql`select limit_user_sessions(${input.userId}::uuid)`);
      }
      let hashes = 0;
      if (input.type === 'expulsion') {
        const blocked = await executor.execute<{ written: number }>(
          sql`select block_expelled_emails(${id}::uuid) as written`,
        );
        hashes = blocked.rows[0]?.written ?? 0;
      }
      await this.audit.write(
        {
          type: 'action',
          action: 'sanction_decided',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: input.userId,
          explanation: by.explanation,
          details: {
            sanctionId: id,
            type: input.type,
            severeCase: input.severeCase ?? null,
            hashes,
          },
        },
        executor,
      );
      await this.notices.toUser(
        input.userId,
        'sanction.decided',
        { sanctionId: id, type: input.type, explanation: input.userExplanation.trim(), appealCode },
        executor,
      );
      return id;
    };
    if (tx) return run(tx);
    const id = await this.db.transaction(run);
    // Sospensione o espulsione: le sessioni sono passate a `limited`, i canali si chiudono e
    // l'app si ricollega con l'ambito nuovo (D75, D231)
    if (input.type !== 'warning')
      await this.realtime.closeChannels(input.userId, [], { all: true });
    return id;
  }

  /**
   * Revoca di una sanzione (ricorso accolto, riattivazione, verifica dell'età superata): tutti i
   * suoi effetti si annullano, impronte comprese; l'account torna com'era.
   */
  async revoke(
    sanctionId: string,
    by: OperatorAction,
    tx?: Executor,
    options: { notify?: boolean } = {},
  ): Promise<void> {
    const run = async (executor: Executor): Promise<void> => {
      const [row] = await executor
        .update(sanctions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(sanctions.id, sanctionId), isNull(sanctions.revokedAt)))
        .returning({ userId: sanctions.userId, type: sanctions.type });
      if (!row) throw ApiError.conflict('conflict');
      await executor.execute(
        sql`delete from blocked_hashes where sanction_id = ${sanctionId}::uuid`,
      );
      await this.audit.write(
        {
          type: 'action',
          action: 'sanction_revoked',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'sanction',
          objectId: sanctionId,
          explanation: by.explanation,
          details: { type: row.type },
        },
        executor,
      );
      if (row.userId && options.notify !== false) {
        await this.notices.toUser(row.userId, 'sanction.revoked', { type: row.type }, executor);
      }
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** Sanzioni in corso di un utente (sospensioni ed espulsione non revocate). */
  async activeFor(userId: string, tx: Executor = this.db) {
    return tx
      .select({ id: sanctions.id, type: sanctions.type })
      .from(sanctions)
      .where(
        and(
          eq(sanctions.userId, userId),
          isNull(sanctions.revokedAt),
          sql`${sanctions.startsAt} <= now()`,
          sql`(${sanctions.endsAt} is null or ${sanctions.endsAt} > now())`,
          sql`${sanctions.type} <> 'warning'`,
        ),
      );
  }

  /** Decisioni motivate dell'utente stesso, con il ricorso (app, D75). */
  async listFor(userId: string): Promise<UserSanction[]> {
    const rows = await this.db
      .select({
        id: sanctions.id,
        type: sanctions.type,
        severeCase: sanctions.severeCase,
        explanation: sanctions.explanation,
        startsAt: sanctions.startsAt,
        endsAt: sanctions.endsAt,
        revokedAt: sanctions.revokedAt,
        appealDeadlineAt: sanctions.appealDeadlineAt,
        appealOutcome: appeals.outcome,
        appealSubmittedAt: appeals.submittedAt,
      })
      .from(sanctions)
      .leftJoin(appeals, eq(appeals.sanctionId, sanctions.id))
      .where(eq(sanctions.userId, userId))
      .orderBy(desc(sanctions.startsAt))
      .limit(20);
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      severeCase: row.severeCase,
      // La motivazione della cautelativa è un codice: l'app mostra il testo della verifica
      explanation: row.explanation,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      active:
        !row.revokedAt &&
        row.type !== 'warning' &&
        row.startsAt.getTime() <= now &&
        (!row.endsAt || row.endsAt.getTime() > now),
      appealDeadlineAt: row.appealDeadlineAt,
      appeal:
        row.appealOutcome && row.appealSubmittedAt
          ? { status: row.appealOutcome, submittedAt: row.appealSubmittedAt }
          : null,
    }));
  }
}
