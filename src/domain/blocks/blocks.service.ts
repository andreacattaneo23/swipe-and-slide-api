import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { activeMatchesOf, publishClosedMatches } from '../realtime/match-closures';
import { RealtimePublisher } from '../realtime/realtime-publisher';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { photoKeys } from '../photos/photos.service';
import {
  OBJECT_STORAGE,
  ObjectStorage,
  SIGNED_URL_SECONDS,
} from '../../infra/storage/object-storage';

/** Un match chiuso da poco si può ancora usare per bloccare o segnalare [Proposta]. */
const RECENT_MATCH_DAYS = 30;

export interface BlockedPerson {
  userId: string;
  firstName: string;
  photoUrl: string | null;
}

/**
 * Blocchi (D70, D108): immediati, silenziosi, nei due sensi. In un'unica transazione: blocco
 * delle righe dei due utenti in ordine, riga in `blocks`, chiusura del match attivo con
 * `blocked` (gli inviti si chiudono con lui) e cancellazione dei like in attesa nei due sensi.
 * Lo sblocco non riapre nulla e la riga resta efficace per 30 giorni. Esportato anche per il
 * blocco automatico delle segnalazioni (D71).
 */
@Injectable()
export class BlocksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly coreRule: CoreRuleService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly realtime: RealtimePublisher,
  ) {}

  /**
   * Blocca `targetId`: ammesso per una persona del feed (`can_interact`) o di un match attivo o
   * chiuso da poco; altrimenti `404` neutro, come per un identificativo inesistente.
   */
  async block(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw ApiError.notFound();
    const before = await this.db.transaction(async (tx) => {
      const [first, second] = userId < targetId ? [userId, targetId] : [targetId, userId];
      const locked = await tx.execute(sql`
        select 1 from users where id in (${first}::uuid, ${second}::uuid) order by id for update`);
      if (locked.rows.length !== 2) throw ApiError.notFound();
      const already = await tx.execute<{ active: boolean }>(sql`
        select unblocked_at is null as active from blocks
         where from_user_id = ${userId}::uuid and to_user_id = ${targetId}::uuid`);
      if (already.rows[0]?.active) return [];
      const match = await tx.execute<{ id: string }>(sql`
        select id from matches where user_a_id = ${first}::uuid and user_b_id = ${second}::uuid
           and (status = 'active' or closed_at > now() - make_interval(days => ${RECENT_MATCH_DAYS}))
         limit 1`);
      if (!match.rows[0] && !(await this.coreRule.canInteract(userId, targetId, tx))) {
        throw ApiError.notFound();
      }
      await tx.execute(sql`
        insert into blocks (from_user_id, to_user_id) values (${userId}::uuid, ${targetId}::uuid)
        on conflict (from_user_id, to_user_id)
        do update set created_at = now(), unblocked_at = null`);
      const active = (await activeMatchesOf(tx, [userId])).filter(
        (match) => match.userA === first && match.userB === second,
      );
      await tx.execute(sql`
        update matches set status = 'closed', close_reason = 'blocked', closed_at = now()
         where status = 'active' and user_a_id = ${first}::uuid and user_b_id = ${second}::uuid`);
      await tx.execute(sql`
        delete from swipes where type in ('like', 'escalation')
           and ((from_user_id = ${userId}::uuid and to_user_id = ${targetId}::uuid)
             or (from_user_id = ${targetId}::uuid and to_user_id = ${userId}::uuid))`);
      return active;
    });
    // Dopo il commit: il match chiuso sparisce subito dalle due app (D70, D180)
    await publishClosedMatches(this.db, this.realtime, before);
  }

  /**
   * "Persone bloccate": solo i blocchi fatti dall'utente, con nome e foto principale; unica rotta
   * che mostra una persona senza visibilità reciproca (eccezione del test di copertura).
   */
  async list(userId: string): Promise<BlockedPerson[]> {
    const rows = await this.db.execute<{
      user_id: string;
      first_name: string;
      storage_key: string | null;
    }>(sql`
      select k.to_user_id as user_id, coalesce(p.first_name, '') as first_name,
             (select f.storage_key from photos f where f.user_id = k.to_user_id
                and f.status = 'approved' order by f.position limit 1) as storage_key
        from blocks k left join profiles p on p.user_id = k.to_user_id
       where k.from_user_id = ${userId}::uuid and k.unblocked_at is null
       order by k.created_at desc`);
    return Promise.all(
      rows.rows.map(async (row) => ({
        userId: row.user_id,
        firstName: row.first_name,
        photoUrl: row.storage_key
          ? await this.storage.signedDownload(
              photoKeys(row.storage_key).thumb,
              SIGNED_URL_SECONDS.download,
            )
          : null,
      })),
    );
  }

  /** Sblocco: la persona esce dall'elenco, la riga vale ancora 30 giorni (D54, D70). */
  async unblock(userId: string, targetId: string): Promise<void> {
    const result = await this.db.execute(sql`
      update blocks set unblocked_at = now()
       where from_user_id = ${userId}::uuid and to_user_id = ${targetId}::uuid
         and unblocked_at is null`);
    if (!result.rowCount) throw ApiError.notFound();
  }

  /** Processo giornaliero `clean-unblocked-blocks`: sblocchi di oltre 30 giorni. */
  async cleanUnblocked(): Promise<number> {
    const result = await this.db.execute(
      sql`delete from blocks where unblocked_at < now() - interval '30 days'`,
    );
    return result.rowCount ?? 0;
  }
}
