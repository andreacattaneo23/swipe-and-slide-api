import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { type Candidate, PeopleService } from '../feed-chat/people.service';
import { uuidArray } from '../feed-chat/rome';
import { type FeedDto } from './feed.dto';
import { FeedBatchCache } from './feed-cache';

export const FEED_PAGE = 20;
const BATCH = 100;

export interface FeedOptions {
  tripsOnly?: boolean;
  offsiteId?: string;
}

/** Stato di chi chiede: solo i suoi dati, per l'invito a completare il profilo o uscire dall'OOO. */
export type RequesterState = 'ready' | 'incomplete' | 'ooo' | 'unavailable';

/**
 * Feed e swipe dell'offsite (architettura, "Feed", "Offsite"; D31, D52, D152): candidati da
 * `feed_candidates`, che applica i filtri del feed e `can_interact` nel database; pagine di 20 in
 * ordine casuale pesato, mai ricostruibile; "Backlog vuoto" uguale per ogni motivo.
 */
@Injectable()
export class FeedService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly people: PeopleService,
    private readonly cache: FeedBatchCache,
  ) {}

  async requesterState(me: string): Promise<RequesterState> {
    const result = await this.db.execute<{ visible: boolean; complete: boolean; ooo: boolean }>(sql`
      select account_visible(u.id) as visible, coalesce(p.is_complete, false) as complete,
             p.ooo_since is not null as ooo
        from users u left join profiles p on p.user_id = u.id where u.id = ${me}::uuid`);
    const row = result.rows[0];
    if (!row?.visible) return 'unavailable';
    if (row.ooo) return 'ooo';
    if (!row.complete) return 'incomplete';
    return 'ready';
  }

  async feed(me: string, options: FeedOptions = {}): Promise<FeedDto> {
    const state = await this.requesterState(me);
    const todaySlides = await this.people.todaySlides(me);
    const openSpace = await this.db.execute<{ open_space: boolean }>(
      sql`select open_space from users where id = ${me}::uuid`,
    );
    const base: FeedDto = { cards: [], backlogEmpty: true, todaySlides };
    if (openSpace.rows[0]?.open_space) base.openSpaceEnabled = true; // solo per sé (D157)
    if (state !== 'ready') return { ...base, state };
    await this.db.execute(sql`
      update users set last_seen_on = (now() at time zone 'Europe/Rome')::date
       where id = ${me}::uuid and last_seen_on is distinct from (now() at time zone 'Europe/Rome')::date`);
    const candidates = await this.page(me, options);
    const cards = await this.people.cards(candidates);
    return { ...base, cards, backlogEmpty: cards.length === 0 };
  }

  /**
   * Pagina dal lotto in cache, ricontrollata con la regola; se il lotto non basta se ne calcola uno
   * nuovo. Un lotto non più lungo di una pagina non si conserva, così ogni richiesta ha un
   * ordine nuovo (RC-121).
   */
  private async page(me: string, options: FeedOptions): Promise<Candidate[]> {
    const key = `${me}:${options.offsiteId ?? 'feed'}:${options.tripsOnly ? 'trips' : 'all'}`;
    const cached = await this.cache.take(key, FEED_PAGE);
    if (cached.length > 0) {
      const valid = await this.candidates(me, options, cached, cached.length);
      const order = new Map(cached.map((id, index) => [id, index]));
      valid.sort((a, b) => (order.get(a.user_id) ?? 0) - (order.get(b.user_id) ?? 0));
      if (valid.length === FEED_PAGE) return valid;
      const seen = new Set(valid.map((item) => item.user_id));
      const fresh = (await this.candidates(me, options, null, BATCH)).filter(
        (item) => !seen.has(item.user_id),
      );
      const page = [...valid, ...fresh.slice(0, FEED_PAGE - valid.length)];
      await this.keep(key, fresh.slice(FEED_PAGE - valid.length));
      return page;
    }
    const fresh = await this.candidates(me, options, null, BATCH);
    await this.keep(key, fresh.slice(FEED_PAGE));
    return fresh.slice(0, FEED_PAGE);
  }

  private async keep(key: string, rest: Candidate[]): Promise<void> {
    await this.cache.store(key, rest.length > FEED_PAGE ? rest.map((item) => item.user_id) : []);
  }

  private async candidates(
    me: string,
    options: FeedOptions,
    only: string[] | null,
    limit: number,
  ): Promise<Candidate[]> {
    const result = await this.db.execute<Candidate>(sql`
      select * from feed_candidates(${me}::uuid, ${options.tripsOnly ?? false},
                                    ${options.offsiteId ?? null}::uuid,
                                    ${only ? uuidArray(only) : null}::uuid[], ${limit})`);
    return result.rows;
  }
}
