import { sql } from 'drizzle-orm';
import { type Executor } from '../../infra/database/database';
import { type RealtimePublisher } from './realtime-publisher';

/** Match attivo con le due persone: solo identificativi (D182). */
export interface ActiveMatch {
  id: string;
  userA: string;
  userB: string;
}

/**
 * Match attivi di alcune persone, letti nella transazione prima di una scrittura che può
 * chiuderli dal database (blocco, Open space spento, cambio azienda): dopo il commit
 * `publishClosedMatches` avvisa le due persone dei soli match chiusi.
 */
export async function activeMatchesOf(tx: Executor, userIds: string[]): Promise<ActiveMatch[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.execute<{ id: string; user_a_id: string; user_b_id: string }>(sql`
    select id, user_a_id, user_b_id from matches
     where status = 'active'
       and (user_a_id = any(${`{${userIds.join(',')}}`}::uuid[])
         or user_b_id = any(${`{${userIds.join(',')}}`}::uuid[]))`);
  return rows.rows.map((row) => ({ id: row.id, userA: row.user_a_id, userB: row.user_b_id }));
}

/**
 * Dopo il commit: evento `match` `unavailable` e `agenda` alle due persone dei match che non sono
 * più attivi, con la stessa forma per ogni motivo di chiusura e nessuna push (RC-197).
 */
export async function publishClosedMatches(
  db: Executor,
  realtime: RealtimePublisher,
  before: ActiveMatch[],
): Promise<void> {
  if (before.length === 0) return;
  const still = await db.execute<{ id: string }>(sql`
    select id from matches
     where status = 'active' and id = any(${`{${before.map((m) => m.id).join(',')}}`}::uuid[])`);
  const active = new Set(still.rows.map((row) => row.id));
  const closed = before.filter((match) => !active.has(match.id));
  await realtime.publishAll(
    closed.flatMap((match) =>
      [match.userA, match.userB].flatMap((userId) => [
        {
          userId,
          event: { type: 'match' as const, matchId: match.id, status: 'unavailable' as const },
        },
        { userId, event: { type: 'agenda' as const } },
      ]),
    ),
  );
}
