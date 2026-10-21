import { Inject, Injectable } from '@nestjs/common';
import { asDate } from '../../infra/database/timestamps';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { PhotosService } from '../photos/photos.service';
import { Gender } from './profiles.service';

/** Finestra di visibilità di una trasferta nel profilo degli altri: 14 giorni prima (D57, D109). */
export const TRIP_WINDOW_DAYS = 14;

/**
 * Profilo nel dettaglio di un'altra persona (D104, D106, D177), con i dati che la persona del
 * feed può vedere: mai cognome, azienda, città base, data di nascita, "chi ti interessa",
 * preferenze, modalità OOO, email o aziende escluse (D30, D47, D56, D109, RC-22, RC-62, RC-114).
 */
export interface ProfileDeck {
  id: string;
  firstName: string;
  age: number;
  /** `non_binary` e `undisclosed` solo a chi cerca "tutti" (D56, D109); altrimenti assente. */
  gender: Gender | null;
  practiceArea: { code: string; label: string } | null;
  lookingFor: { code: string; label: string } | null;
  bio: string | null;
  photos: { id: string; url: string; thumbnailUrl: string }[];
  interests: { code: string; label: string; section: 'classic' | 'consultant' }[];
  answers: { question: string; text: string; answer: string }[];
  /** Solo nella finestra di 14 giorni e mai con il calendario nascosto; città mostrata (D109). */
  trips: { cityName: string; startDate: string; endDate: string }[];
  /** Righe "sarò all'offsite" accese dalla persona (D154). */
  offsites: { offsiteId: string; title: string; city: string; startsAt: Date }[];
  /** Badge "Open space": solo tra colleghi con Open space reciproco (D168). */
  openSpaceColleagues: boolean;
}

type DeckRow = {
  first_name: string | null;
  age: number;
  gender: Gender | null;
  practice_area: string | null;
  practice_label: string | null;
  looking_for: string | null;
  looking_label: string | null;
  bio: string | null;
  viewer_interested_in: string | null;
};

/**
 * Composizione del profilo di un'altra persona. Non decide la visibilità: le rotte la chiamano
 * solo dopo la regola dichiarata (`interact` dal feed, `match` dal match). Dal feed servono anche
 * i profili completi di entrambi e nessuno dei due in OOO (D81, D109, RC-137).
 */
@Injectable()
export class ProfileViewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly coreRule: CoreRuleService,
    private readonly photos: PhotosService,
  ) {}

  /** Profilo aperto dal feed: `404` neutro se uno dei due è incompleto o in OOO. */
  async fromFeed(viewerId: string, targetId: string): Promise<ProfileDeck> {
    const both = await this.db.execute<{ ok: boolean }>(sql`
      select count(*) = 2 as ok from profiles
       where user_id in (${viewerId}::uuid, ${targetId}::uuid) and is_complete and ooo_since is null`);
    if (both.rows[0]?.ok !== true) throw ApiError.notFound();
    return this.deck(viewerId, targetId);
  }

  /** Profilo di `targetId` come lo vede `viewerId`, già autorizzato dalla regola della rotta. */
  async deck(viewerId: string, targetId: string, tx: Executor = this.db): Promise<ProfileDeck> {
    const result = await tx.execute<DeckRow>(sql`
      select p.first_name, age_years(p.birth_date) as age, p.gender,
             p.practice_area, pa.label as practice_label, p.looking_for, lf.label as looking_label,
             p.bio, v.interested_in as viewer_interested_in
        from profiles p
        left join practice_areas pa on pa.code = p.practice_area and pa.is_active
        left join looking_for_options lf on lf.code = p.looking_for and lf.is_active
        left join profiles v on v.user_id = ${viewerId}::uuid
       where p.user_id = ${targetId}::uuid`);
    const row = result.rows[0];
    if (!row?.first_name) throw ApiError.notFound();
    const [photos, interests, answers, trips, offsites, colleagues] = await Promise.all([
      this.photos.approvedFor(targetId, tx),
      tx.execute<{ code: string; label: string; section: 'classic' | 'consultant' }>(sql`
        select i.code, i.label, i.section from user_interests u
          join interests i on i.code = u.interest and i.is_active
         where u.user_id = ${targetId}::uuid order by i.position`),
      tx.execute<{ question: string; text: string; answer: string }>(sql`
        select a.question, q.text, a.answer from profile_answers a
          join profile_questions q on q.code = a.question and q.is_active
         where a.user_id = ${targetId}::uuid order by a.position`),
      tx.execute<{ city_name: string; start_date: string; end_date: string }>(sql`
        select coalesce(d.name, c.name) as city_name, t.start_date::text as start_date,
               t.end_date::text as end_date
          from trips t
          join profiles p on p.user_id = t.user_id and p.show_calendar
          join cities c on c.id = t.city_id
          left join cities d on d.id = c.display_city_id
         where t.user_id = ${targetId}::uuid
           and t.end_date >= (now() at time zone 'Europe/Rome')::date
           and t.start_date - ${TRIP_WINDOW_DAYS}::int <= (now() at time zone 'Europe/Rome')::date
         order by t.start_date`),
      tx.execute<{ offsite_id: string; title: string; city: string; starts_at: Date }>(sql`
        select o.id as offsite_id, o.title, c.name as city, o.starts_at from offsite_attendees a
          join offsites o on o.id = a.offsite_id
          join cities c on c.id = o.city_id
         where a.user_id = ${targetId}::uuid and a.show_on_profile
           and o.status = 'published' and o.ends_at > now()
         order by o.starts_at`),
      this.coreRule.openSpaceColleagues(viewerId, targetId, tx),
    ]);
    const hiddenGender =
      (row.gender === 'non_binary' || row.gender === 'undisclosed') &&
      row.viewer_interested_in !== 'everyone';
    return {
      id: targetId,
      firstName: row.first_name,
      age: row.age,
      gender: hiddenGender ? null : row.gender,
      practiceArea:
        row.practice_area && row.practice_label
          ? { code: row.practice_area, label: row.practice_label }
          : null,
      lookingFor:
        row.looking_for && row.looking_label
          ? { code: row.looking_for, label: row.looking_label }
          : null,
      bio: row.bio,
      photos,
      interests: interests.rows,
      answers: answers.rows,
      trips: trips.rows.map((trip) => ({
        cityName: trip.city_name,
        startDate: trip.start_date,
        endDate: trip.end_date,
      })),
      offsites: offsites.rows.map((offsite) => ({
        offsiteId: offsite.offsite_id,
        title: offsite.title,
        city: offsite.city,
        startsAt: asDate(offsite.starts_at)!,
      })),
      openSpaceColleagues: colleagues,
    };
  }
}
