import { type INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../infra/database/database';
import {
  NotificationsService,
  type NotifyResult,
} from '../domain/notifications/notifications.service';
import { type PushTextKey } from '../domain/notifications/push-texts';
import { RealtimePublisher } from '../domain/realtime/realtime-publisher';
import { type Job } from './job';

const ROME_TODAY = sql`(now() at time zone 'Europe/Rome')::date`;

function deps(context: INestApplicationContext) {
  return {
    db: context.get<Database>(DATABASE),
    notifications: context.get(NotificationsService),
    realtime: context.get(RealtimePublisher),
  };
}

/** Un promemoria è fatto se non è stato rimandato (fascia silenziosa o notte). */
const done = (results: NotifyResult[]): boolean => results.every((r) => r !== 'deferred');

// ------------------------------------------------------------------------------------------------
// Processo giornaliero (di notte)
// ------------------------------------------------------------------------------------------------

/** `expire-swipes`: like senza risposta e scartati dopo 30 giorni (D54). */
export const expireSwipes: Job = {
  name: 'expire-swipes',
  async run(context) {
    const { db } = deps(context);
    const result = await db.execute(sql`delete from swipes where expires_at <= now()`);
    return { deleted: result.rowCount ?? 0 };
  },
};

/**
 * `delete-closed-matches`: match chiusi, scaduti o revocati da 30 giorni, con messaggi, inviti e
 * chiave del match (cascata). Le copie dei messaggi segnalati vivono nelle segnalazioni (D63).
 */
export const deleteClosedMatches: Job = {
  name: 'delete-closed-matches',
  async run(context) {
    const { db } = deps(context);
    let total = 0;
    for (;;) {
      const result = await db.execute(sql`
        delete from matches where id in (
          select id from matches where status = 'closed' and closed_at < now() - interval '30 days'
          limit 500)`);
      total += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) < 500) break;
    }
    return { deleted: total };
  },
};

/** `clean-invites`: meeting 30 giorni dopo il loro giorno, anche nei match attivi (D146). */
export const cleanInvites: Job = {
  name: 'clean-invites',
  async run(context) {
    const { db } = deps(context);
    const result = await db.execute(sql`delete from invites where day < ${ROME_TODAY} - 30`);
    return { deleted: result.rowCount ?? 0 };
  },
};

/** `complete-offsites`: offsite pubblicati e finiti diventano `completed` (D150). */
export const completeOffsites: Job = {
  name: 'complete-offsites',
  async run(context) {
    const { db } = deps(context);
    const result = await db.execute(sql`
      update offsites set status = 'completed', updated_at = now()
       where status = 'published' and ends_at < now()`);
    return { completed: result.rowCount ?? 0 };
  },
};

/** `clean-offsite-attendees`: iscrizioni degli offsite conclusi o annullati da 30 giorni (D151). */
export const cleanOffsiteAttendees: Job = {
  name: 'clean-offsite-attendees',
  async run(context) {
    const { db } = deps(context);
    const result = await db.execute(sql`
      delete from offsite_attendees a using offsites o
       where o.id = a.offsite_id
         and ((o.status in ('completed', 'published') and o.ends_at < now() - interval '30 days')
              or (o.status = 'cancelled' and coalesce(o.cancelled_at, o.ends_at) < now() - interval '30 days'))`);
    return { deleted: result.rowCount ?? 0 };
  },
};

/** `clean-counters` (parte dei contatori giornalieri): righe più vecchie di due giorni. */
export const cleanCounters: Job = {
  name: 'clean-counters',
  async run(context) {
    const { db } = deps(context);
    const result = await db.execute(sql`delete from daily_counters where day < ${ROME_TODAY} - 2`);
    return { deleted: result.rowCount ?? 0 };
  },
};

// ------------------------------------------------------------------------------------------------
// Processo orario
// ------------------------------------------------------------------------------------------------

/**
 * `match-deadlines` (D62): promemoria a 3 giorni e mezzo ai due, una volta; chiusura con
 * `expired` a 7 giorni dei match senza messaggi, anche in OOO. Le chiusure arrivano come "match
 * non più disponibile", con la stessa forma di ogni chiusura.
 */
export const matchDeadlines: Job = {
  name: 'match-deadlines',
  async run(context) {
    const { db, notifications, realtime } = deps(context);
    const expired = await db.execute<{ id: string; user_a_id: string; user_b_id: string }>(sql`
      update matches set status = 'closed', close_reason = 'expired', closed_at = now()
       where status = 'active' and chat_started_at is null
         and created_at <= now() - interval '7 days'
      returning id, user_a_id, user_b_id`);
    for (const row of expired.rows) {
      for (const userId of [row.user_a_id, row.user_b_id]) {
        await realtime.publish(userId, { type: 'match', matchId: row.id, status: 'unavailable' });
        await realtime.publish(userId, { type: 'agenda' });
      }
    }
    const due = await db.execute<{ id: string; user_a_id: string; user_b_id: string }>(sql`
      select id, user_a_id, user_b_id from matches
       where status = 'active' and chat_started_at is null and expiry_reminder_at is null
         and created_at <= now() - interval '84 hours'`);
    let reminded = 0;
    for (const row of due.rows) {
      const results: NotifyResult[] = [];
      for (const userId of [row.user_a_id, row.user_b_id]) {
        results.push(
          await notifications.notify(
            {
              userId,
              type: 'match_expiry',
              text: 'notification.expiry',
              data: { matchId: row.id },
            },
            { reminder: true },
          ),
        );
      }
      if (done(results)) {
        // Condizione ripetuta: se nel frattempo qualcuno ha scritto, il promemoria non conta
        await db.execute(sql`update matches set expiry_reminder_at = now()
                              where id = ${row.id}::uuid and expiry_reminder_at is null`);
        reminded += 1;
      }
    }
    return { expired: expired.rows.length, reminded };
  },
};

/**
 * `invite-reminders` (D64): "Meeting domani" ai due dal pomeriggio del giorno prima (dalle 18,
 * `Europe/Rome`), rispettando la "Modalità in riunione" e la notte; inviti accettati passati
 * `completed`, in sospeso passati `expired`.
 */
export const inviteReminders: Job = {
  name: 'invite-reminders',
  async run(context) {
    const { db, notifications, realtime } = deps(context);
    const finished = await db.execute<{ user_a_id: string; user_b_id: string }>(sql`
      with changed as (
        update invites set status = case when status = 'accepted' then 'completed'::invite_status
                                         else 'expired'::invite_status end
         where status in ('accepted', 'pending') and day < ${ROME_TODAY}
        returning match_id)
      select distinct m.user_a_id, m.user_b_id from changed c join matches m on m.id = c.match_id`);
    for (const row of finished.rows) {
      await realtime.publish(row.user_a_id, { type: 'agenda' });
      await realtime.publish(row.user_b_id, { type: 'agenda' });
    }
    const hour = await db.execute<{ h: number }>(
      sql`select extract(hour from now() at time zone 'Europe/Rome')::int as h`,
    );
    let reminded = 0;
    if (Number(hour.rows[0]?.h ?? 0) >= 18) {
      const due = await db.execute<{
        id: string;
        match_id: string;
        user_a_id: string;
        user_b_id: string;
      }>(sql`
        select i.id, i.match_id, m.user_a_id, m.user_b_id
          from invites i join matches m on m.id = i.match_id
         where i.status = 'accepted' and i.reminder_at is null and i.day = ${ROME_TODAY} + 1
           and m.status = 'active' and account_visible(m.user_a_id) and account_visible(m.user_b_id)`);
      for (const row of due.rows) {
        const results: NotifyResult[] = [];
        for (const userId of [row.user_a_id, row.user_b_id]) {
          results.push(
            await notifications.notify(
              {
                userId,
                type: 'invite',
                text: 'notification.meetingTomorrow',
                data: { matchId: row.match_id, inviteId: row.id },
              },
              { reminder: true },
            ),
          );
        }
        if (done(results)) {
          await db.execute(sql`update invites set reminder_at = now() where id = ${row.id}::uuid`);
          reminded += 1;
        }
      }
    }
    return { finished: finished.rows.length, reminded };
  },
};

/** `offsite-reminders` (D151): "Offsite domani" agli iscritti dalle 18 del giorno prima, una volta. */
export const offsiteReminders: Job = {
  name: 'offsite-reminders',
  async run(context) {
    const { db, notifications } = deps(context);
    const due = await db.execute<{ id: string }>(sql`
      select id from offsites
       where status = 'published' and reminder_sent_at is null
         and (starts_at at time zone 'Europe/Rome')::date = ${ROME_TODAY} + 1
         and extract(hour from now() at time zone 'Europe/Rome') >= 18`);
    let sent = 0;
    for (const offsite of due.rows) {
      const claimed = await db.execute(sql`
        update offsites set reminder_sent_at = now()
         where id = ${offsite.id}::uuid and reminder_sent_at is null returning id`);
      if (claimed.rows.length === 0) continue;
      sent += await notifyAttendees(
        context,
        offsite.id,
        'notification.offsite.tomorrow',
        notifications,
      );
    }
    return { offsites: due.rows.length, sent };
  },
};

/**
 * `offsite-notices` [Proposta]: avvisi accodati dal backoffice per un offsite modificato o
 * annullato (D197), consegnati agli iscritti con l'evento `offsite` e la notifica a tema.
 */
export const offsiteNotices: Job = {
  name: 'offsite-notices',
  async run(context) {
    const { db, notifications, realtime } = deps(context);
    const notices = await db.execute<{
      id: string;
      offsite_id: string;
      kind: 'updated' | 'cancelled';
    }>(sql`
      update offsite_notices set sent_at = now()
       where id in (select id from offsite_notices where sent_at is null
                     order by created_at limit 100 for update skip locked)
      returning id, offsite_id, kind`);
    let sent = 0;
    for (const notice of notices.rows) {
      const attendees = await db.execute<{ user_id: string }>(
        sql`select user_id from offsite_attendees where offsite_id = ${notice.offsite_id}::uuid`,
      );
      for (const row of attendees.rows) {
        await realtime.publish(row.user_id, {
          type: 'offsite',
          offsiteId: notice.offsite_id,
          attendeesRounded: null,
        });
        await realtime.publish(row.user_id, { type: 'agenda' });
      }
      sent += await notifyAttendees(
        context,
        notice.offsite_id,
        notice.kind === 'updated'
          ? 'notification.offsite.updated'
          : 'notification.offsite.cancelled',
        notifications,
      );
    }
    return { notices: notices.rows.length, sent };
  },
};

async function notifyAttendees(
  context: INestApplicationContext,
  offsiteId: string,
  text: PushTextKey,
  notifications: NotificationsService,
): Promise<number> {
  const { db } = deps(context);
  const attendees = await db.execute<{ user_id: string }>(
    sql`select user_id from offsite_attendees where offsite_id = ${offsiteId}::uuid`,
  );
  let sent = 0;
  for (const row of attendees.rows) {
    const result = await notifications.notify({
      userId: row.user_id,
      type: 'offsite',
      text,
      data: { offsiteId },
    });
    if (result === 'sent') sent += 1;
  }
  return sent;
}

/** Processi di feed, match, chat, inviti e offsite (team B2), nell'ordine dell'architettura. */
export const FEED_CHAT_DAILY_JOBS: Job[] = [
  expireSwipes,
  deleteClosedMatches,
  cleanInvites,
  completeOffsites,
  cleanOffsiteAttendees,
  cleanCounters,
];

export const FEED_CHAT_HOURLY_JOBS: Job[] = [
  matchDeadlines,
  inviteReminders,
  offsiteReminders,
  offsiteNotices,
];
