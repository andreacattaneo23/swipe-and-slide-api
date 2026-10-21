import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, lt, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { offsites } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../infra/storage/object-storage';
import { OperatorAction } from '../companies/companies.service';

export interface OffsiteInput {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  cityId: string;
  startsAt: Date;
  endsAt: Date;
  capacity?: number | null;
  isDemo?: boolean;
}

export interface OffsiteRecord {
  id: string;
  title: string;
  description: string;
  coverKey: string | null;
  venueName: string;
  venueAddress: string;
  cityId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  isDemo: boolean;
  createdAt: Date;
  publishedAt: Date | null;
  updatedAt: Date;
  cancelledAt: Date | null;
  /** Iscritti arrotondati (D167): `0` vuol dire "meno di 10", poi la decina per difetto. */
  attendeesRounded: number;
  /** URL firmato della copertina, pochi minuti. */
  coverUrl: string | null;
}

/**
 * Offsite creati solo dal backoffice (D150): bozza, modifica, pubblicazione, annullamento.
 * Mai l'elenco né il numero esatto degli iscritti, nemmeno qui (D153, D167).
 * Modifica e annullamento accodano un avviso in `offsite_notices`: il backoffice non legge mai le
 * iscrizioni (D90, RC-117), e il processo `offsite-notices` avvisa gli iscritti con l'evento
 * `offsite` e la notifica a tema, senza nomi di persone (D197). [Proposta] Copertina con URL
 * firmato: da fare.
 */
@Injectable()
export class OffsitesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly crypto: CryptoService,
  ) {}

  /** Copertina nell'archivio (D150): sostituisce la precedente. */
  async setCover(
    id: string,
    body: Buffer,
    contentType: string,
    by: OperatorAction,
  ): Promise<OffsiteRecord> {
    const key = `offsites/${id}/${this.crypto.randomToken(12).toLowerCase()}`;
    await this.storage.write(key, body, contentType);
    let previous: string | null = null;
    try {
      const record = await this.db.transaction(async (tx) => {
        const current = await this.lock(tx, id);
        if (current.status === 'cancelled' || current.status === 'completed') {
          throw ApiError.conflict('offsite.notEditable');
        }
        previous = current.coverKey;
        await tx
          .update(offsites)
          .set({ coverKey: key, updatedAt: sql`now()` })
          .where(eq(offsites.id, id));
        await this.log(tx, 'offsite_updated', id, by);
        return this.get(id, tx);
      });
      if (previous) await this.storage.delete(previous).catch(() => undefined);
      return record;
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async list(params: { limit: number; before?: string }): Promise<OffsiteRecord[]> {
    const rows = await this.db
      .select()
      .from(offsites)
      .where(params.before ? lt(offsites.startsAt, new Date(params.before)) : undefined)
      .orderBy(desc(offsites.startsAt), asc(offsites.id))
      .limit(params.limit);
    return Promise.all(rows.map((row) => this.withCount(row)));
  }

  async get(id: string, tx: Executor = this.db): Promise<OffsiteRecord> {
    const [row] = await tx.select().from(offsites).where(eq(offsites.id, id));
    if (!row) throw ApiError.notFound();
    return this.withCount(row, tx);
  }

  async create(input: OffsiteInput, by: OperatorAction): Promise<OffsiteRecord> {
    this.checkDates(input.startsAt, input.endsAt);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(offsites)
        .values({
          ...input,
          capacity: input.capacity ?? null,
          isDemo: input.isDemo ?? false,
          createdBy: by.operatorId,
        })
        .returning({ id: offsites.id });
      await this.log(tx, 'offsite_created', row!.id, by);
      return this.get(row!.id, tx);
    });
  }

  async update(
    id: string,
    input: Partial<OffsiteInput>,
    by: OperatorAction,
  ): Promise<OffsiteRecord> {
    const updated = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status === 'cancelled' || current.status === 'completed') {
        throw ApiError.conflict('offsite.notEditable');
      }
      if (input.isDemo !== undefined && input.isDemo !== current.isDemo) {
        throw ApiError.badRequest('offsite.typeImmutable');
      }
      this.checkDates(input.startsAt ?? current.startsAt, input.endsAt ?? current.endsAt);
      const { isDemo: _ignored, ...changes } = input;
      await tx
        .update(offsites)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(eq(offsites.id, id));
      await this.log(tx, 'offsite_updated', id, by);
      if (current.status === 'published') await this.queueNotice(tx, id, 'updated');
      return this.get(id, tx);
    });
    return updated;
  }

  async publish(id: string, by: OperatorAction): Promise<OffsiteRecord> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status !== 'draft') throw ApiError.conflict('offsite.notDraft');
      await tx
        .update(offsites)
        .set({ status: 'published', publishedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(offsites.id, id));
      await this.log(tx, 'offsite_published', id, by);
      return this.get(id, tx);
    });
  }

  async cancel(id: string, by: OperatorAction): Promise<OffsiteRecord> {
    const cancelled = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status === 'cancelled' || current.status === 'completed') {
        throw ApiError.conflict('offsite.notEditable');
      }
      await tx
        .update(offsites)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(offsites.id, id));
      await this.log(tx, 'offsite_cancelled', id, by);
      if (current.status === 'published') await this.queueNotice(tx, id, 'cancelled');
      return this.get(id, tx);
    });
    return cancelled;
  }

  /** Avviso agli iscritti, inviato dal processo `offsite-notices` (D197). */
  private async queueNotice(
    tx: Executor,
    id: string,
    kind: 'updated' | 'cancelled',
  ): Promise<void> {
    await tx.execute(
      sql`insert into offsite_notices (offsite_id, kind) values (${id}::uuid, ${kind})`,
    );
  }

  private checkDates(startsAt: Date, endsAt: Date): void {
    if (!(endsAt > startsAt)) throw ApiError.badRequest('offsite.dates.invalid');
  }

  private async lock(tx: Executor, id: string): Promise<typeof offsites.$inferSelect> {
    const [row] = await tx.select().from(offsites).where(eq(offsites.id, id)).for('update');
    if (!row) throw ApiError.notFound();
    return row;
  }

  private async log(
    tx: Executor,
    action: 'offsite_created' | 'offsite_updated' | 'offsite_published' | 'offsite_cancelled',
    id: string,
    by: OperatorAction,
  ): Promise<void> {
    await this.audit.write(
      {
        type: 'action',
        action,
        operatorId: by.operatorId,
        sessionId: by.sessionId,
        objectType: 'offsite',
        objectId: id,
        explanation: by.explanation || null,
      },
      tx,
    );
  }

  private async withCount(
    row: typeof offsites.$inferSelect,
    tx: Executor = this.db,
  ): Promise<OffsiteRecord> {
    const count = await tx.execute<{ rounded: number }>(
      sql`select rounded_attendee_count(${row.id}::uuid) as rounded`,
    );
    const { createdBy: _createdBy, ...rest } = row;
    const coverUrl = row.coverKey ? (await this.storage.signedGetUrl(row.coverKey, 600)).url : null;
    return { ...rest, attendeesRounded: Number(count.rows[0]?.rounded ?? 0), coverUrl };
  }
}
