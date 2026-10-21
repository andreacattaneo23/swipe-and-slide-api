import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { DATABASE, type Database, type Executor } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { NotificationsService } from '../../domain/notifications/notifications.service';
import { RealtimePublisher } from '../../domain/realtime/realtime-publisher';
import { FeedChatError } from '../feed-chat/feed-chat.errors';
import { PeopleService } from '../feed-chat/people.service';
import { uuidArray } from '../feed-chat/rome';
import { FeedService } from '../feed/feed.service';
import { type DealClosedDto, type RollbackResultDto, type SwipeResultDto } from './swipes.dto';

type SwipeType = 'like' | 'pass' | 'escalation';

const TODAY = sql`(now() at time zone 'Europe/Rome')::date`;

/**
 * Swipe, limiti e Rollback (architettura, "Swipe, limiti e Rollback"; D53, D54, D62, D152): in una
 * sola transazione blocco consultivo sulla coppia, ricontrollo della regola e dei filtri del feed
 * con `feed_candidates` (`can_interact` compresa), contatori atomici del giorno, riga di `swipes`
 * (il trigger ricontrolla `can_interact`) e match al like reciproco. Eventi e notifiche partono
 * dopo il commit, con i destinatari già decisi.
 */
@Injectable()
export class SwipesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly coreRule: CoreRuleService,
    private readonly people: PeopleService,
    private readonly feed: FeedService,
    private readonly realtime: RealtimePublisher,
    private readonly notifications: NotificationsService,
  ) {}

  async swipe(
    me: string,
    target: string,
    type: SwipeType,
    offsiteId?: string,
  ): Promise<SwipeResultDto> {
    if ((await this.feed.requesterState(me)) !== 'ready') throw ApiError.notFound();
    const limits = await this.limits();
    const outcome = await this.db.transaction(async (tx) => {
      if (offsiteId && !(await this.offsiteWindowOpen(me, offsiteId, tx)))
        throw ApiError.notFound();
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
        least(${me}::uuid, ${target}::uuid)::text || greatest(${me}::uuid, ${target}::uuid)::text, 0))`);
      // Stessa regola e stessi filtri del feed (o dello swipe dell'offsite), al momento dello swipe
      const eligible = await tx.execute(sql`
        select 1 from feed_candidates(${me}::uuid, false, ${offsiteId ?? null}::uuid,
                                      ${uuidArray([target])}::uuid[], 1)`);
      if (eligible.rows.length === 0) throw ApiError.notFound();
      if (type === 'like') await this.consume(tx, me, 'likes_used', limits.likes, true);
      if (type === 'escalation')
        await this.consume(tx, me, 'escalations_used', limits.escalations, false);
      await tx.execute(sql`delete from swipes where from_user_id = ${me}::uuid
                             and to_user_id = ${target}::uuid and expires_at <= now()`);
      await tx.execute(sql`
        insert into swipes (from_user_id, to_user_id, type, offsite_id)
        values (${me}::uuid, ${target}::uuid, ${type}::swipe_type, ${offsiteId ?? null}::uuid)`);
      await tx.execute(sql`
        insert into daily_counters (user_id, day, last_swipe_target_id)
        values (${me}::uuid, ${TODAY}, ${target}::uuid)
        on conflict (user_id, day) do update set last_swipe_target_id = excluded.last_swipe_target_id`);
      if (type === 'pass') return { matchId: null };
      const reverse = await tx.execute<{ offsite_id: string | null }>(sql`
        select offsite_id from swipes
         where from_user_id = ${target}::uuid and to_user_id = ${me}::uuid
           and type in ('like', 'escalation') and expires_at > now() for update`);
      if (reverse.rows.length === 0) return { matchId: null };
      const created = await tx.execute<{ id: string }>(sql`
        insert into matches (user_a_id, user_b_id, offsite_id)
        values (least(${me}::uuid, ${target}::uuid), greatest(${me}::uuid, ${target}::uuid),
                coalesce(${offsiteId ?? null}::uuid, ${reverse.rows[0]!.offsite_id}::uuid))
        returning id`);
      const matchId = created.rows[0]!.id;
      // Chi completa il match vede subito "Deal Closed!": il match è già visto da lui
      await tx.execute(sql`
        update matches set user_a_seen_at = case when user_a_id = ${me}::uuid then now() end,
                           user_b_seen_at = case when user_b_id = ${me}::uuid then now() end
         where id = ${matchId}::uuid`);
      await tx.execute(sql`delete from swipes
        where (from_user_id = ${me}::uuid and to_user_id = ${target}::uuid)
           or (from_user_id = ${target}::uuid and to_user_id = ${me}::uuid)`);
      return { matchId };
    });
    const result: SwipeResultDto = {
      matched: false,
      todaySlides: await this.people.todaySlides(me),
    };
    if (outcome.matchId) {
      result.matched = true;
      result.match = await this.dealClosed(me, target, outcome.matchId);
      await this.realtime.publishAll([
        { userId: me, event: { type: 'match', matchId: outcome.matchId, status: 'active' } },
        { userId: target, event: { type: 'match', matchId: outcome.matchId, status: 'active' } },
      ]);
      // Alla persona che aveva messo il like prima (D60, D65), con il match ancora attivo
      await this.notifications.notify({
        userId: target,
        type: 'new_match',
        text: 'notification.match',
        data: { matchId: outcome.matchId },
      });
    } else if (type === 'escalation' && (await this.coreRule.canInteract(me, target))) {
      // Notifica dell'escalation solo con `can_interact` vera all'invio, senza nome né foto (D53)
      await this.notifications.notify({
        userId: target,
        type: 'escalation',
        text: 'notification.escalation',
      });
    }
    return result;
  }

  /** Rollback dell'ultimo swipe del giorno, se non ha creato un match (D53). */
  async rollback(me: string, target: string): Promise<RollbackResultDto> {
    await this.db.transaction(async (tx) => {
      const counter = await tx.execute<{ last: string | null }>(sql`
        select last_swipe_target_id as last from daily_counters
         where user_id = ${me}::uuid and day = ${TODAY} for update`);
      if (counter.rows[0]?.last !== target) {
        throw ApiError.conflict(FeedChatError.nothingToRollback);
      }
      const removed = await tx.execute<{ type: SwipeType }>(sql`
        delete from swipes where from_user_id = ${me}::uuid and to_user_id = ${target}::uuid
        returning type`);
      const swipeType = removed.rows[0]?.type;
      if (!swipeType) throw ApiError.conflict(FeedChatError.nothingToRollback);
      await tx.execute(sql`
        update daily_counters
           set last_swipe_target_id = null,
               likes_used = greatest(0, likes_used - ${swipeType === 'like' ? 1 : 0}),
               escalations_used = greatest(0, escalations_used - ${swipeType === 'escalation' ? 1 : 0})
         where user_id = ${me}::uuid and day = ${TODAY}`);
    });
    return { todaySlides: await this.people.todaySlides(me) };
  }

  async dealClosed(me: string, other: string, matchId: string): Promise<DealClosedDto> {
    const summary = (await this.people.summaries([other])).get(other);
    const row = await this.db.execute<{ offsite_title: string | null; deadline_at: Date }>(sql`
      select o.title as offsite_title, m.created_at + interval '7 days' as deadline_at
        from matches m left join offsites o on o.id = m.offsite_id where m.id = ${matchId}::uuid`);
    return {
      matchId,
      firstName: summary?.firstName ?? '',
      lastName: summary?.lastName ?? null,
      companyName: summary?.companyName ?? '',
      photo: summary?.photo ?? null,
      offsiteTitle: row.rows[0]?.offsite_title ?? null,
      deadlineAt: new Date(row.rows[0]!.deadline_at).toISOString(),
    };
  }

  /** Finestra dello swipe dell'offsite: iscritto, dall'iscrizione a 24 ore dopo la fine (D152). */
  async offsiteWindowOpen(me: string, offsiteId: string, tx: Executor = this.db): Promise<boolean> {
    const result = await tx.execute(sql`
      select 1 from offsite_attendees a join offsites o on o.id = a.offsite_id
       where a.offsite_id = ${offsiteId}::uuid and a.user_id = ${me}::uuid
         and o.status in ('published', 'completed') and now() <= o.ends_at + interval '24 hours'
         and o.is_demo = (select is_demo from users where id = ${me}::uuid)`);
    return result.rows.length > 0;
  }

  private async limits(): Promise<{ likes: number; escalations: number }> {
    const result = await this.db.execute<{ likes: number; escalations: number }>(sql`
      select coalesce((select (value #>> '{}')::int from config where key = 'swipes.daily_likes'), 25) as likes,
             coalesce((select (value #>> '{}')::int from config where key = 'swipes.daily_escalations'), 1) as escalations`);
    const row = result.rows[0]!;
    return { likes: Number(row.likes), escalations: Number(row.escalations) };
  }

  /** Consumo atomico del contatore sotto il limite (più i bonus per i like); oltre, `429`. */
  private async consume(
    tx: Executor,
    me: string,
    column: 'likes_used' | 'escalations_used',
    limit: number,
    withBonus: boolean,
  ): Promise<void> {
    const col = sql.raw(column);
    const max = withBonus
      ? sql`${limit} + 3 * daily_counters.bonuses_received`
      : sql`${limit}::int`;
    const result = await tx.execute(sql`
      insert into daily_counters (user_id, day, ${col})
      select ${me}::uuid, ${TODAY}, 1 where ${limit}::int >= 1
      on conflict (user_id, day) do update set ${col} = daily_counters.${col} + 1
       where daily_counters.${col} < ${max}
      returning 1`);
    if (result.rows.length === 0) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        column === 'likes_used' ? FeedChatError.slidesFinished : FeedChatError.escalationUsed,
      );
    }
  }
}
