import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asDate } from '../../infra/database/timestamps';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { ParametersService } from '../parameters/parameters.service';
import { OwnPhoto, PhotosService } from '../photos/photos.service';
import { TaxonomiesService } from '../taxonomies/taxonomies.service';
import { WordFilterService } from '../safety/word-filter.service';

export type Gender = 'woman' | 'man' | 'non_binary' | 'undisclosed';
export type InterestedIn = 'men' | 'women' | 'everyone';
export type MaxDistance = 'city' | 'km25' | 'km50' | 'km100' | 'km200' | 'italy';

/** Modifiche ammesse del proprio profilo: mai la data di nascita (D112). */
export interface ProfilePatch {
  firstName?: string;
  lastName?: string | null;
  gender?: Gender;
  interestedIn?: InterestedIn;
  lookingFor?: string | null;
  bio?: string | null;
  practiceArea?: string | null;
  homeCityId?: string;
  ageMin?: number;
  ageMax?: number;
  maxDistance?: MaxDistance;
  showCalendar?: boolean;
  readReceipts?: boolean;
  ooo?: boolean;
}

export interface OwnProfile {
  firstName: string | null;
  lastName: string | null;
  birthDate: string;
  age: number;
  gender: Gender | null;
  interestedIn: InterestedIn | null;
  lookingFor: string | null;
  bio: string | null;
  practiceArea: string | null;
  homeCity: { id: string; name: string; provinceCode: string } | null;
  /** Solo se il limite non permette un altro cambio della città base (D233). */
  homeCityChangeableAt: Date | null;
  preferences: { ageMin: number; ageMax: number; maxDistance: MaxDistance };
  showCalendar: boolean;
  readReceipts: boolean;
  oooSince: Date | null;
  isComplete: boolean;
  /** Cosa manca per il profilo completo (D51): la guida dell'app. */
  missing: ('photos' | 'firstName' | 'gender' | 'interestedIn' | 'homeCity')[];
  interests: string[];
  answers: { question: string; answer: string }[];
  photos: OwnPhoto[];
}

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  birth_date: string;
  age: number;
  gender: Gender | null;
  interested_in: InterestedIn | null;
  looking_for: string | null;
  bio: string | null;
  practice_area: string | null;
  home_city_id: string | null;
  city_name: string | null;
  city_province: string | null;
  age_min: number;
  age_max: number;
  max_distance: MaxDistance;
  show_calendar: boolean;
  read_receipts: boolean;
  ooo_since: Date | null;
  is_complete: boolean;
  approved_photos: number;
};

/**
 * Profilo dell'utente stesso (D46–D51, D56, D81, D109, D112): lettura completa, modifiche per
 * gruppo che valgono subito, interessi e domande a tema sostituiti per intero, filtro delle
 * parole su nome, bio e risposte, limite di frequenza dei cambi della città base. La completezza
 * la ricalcola il trigger nella stessa transazione.
 */
@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taxonomies: TaxonomiesService,
    private readonly filter: WordFilterService,
    private readonly parameters: ParametersService,
    private readonly photos: PhotosService,
  ) {}

  async getOwn(userId: string): Promise<OwnProfile> {
    const result = await this.db.execute<ProfileRow>(sql`
      select p.first_name, p.last_name, p.birth_date::text as birth_date,
             age_years(p.birth_date) as age, p.gender, p.interested_in, p.looking_for, p.bio,
             p.practice_area, p.home_city_id, c.name as city_name, c.province_code as city_province,
             p.age_min, p.age_max, p.max_distance, p.show_calendar, p.read_receipts, p.ooo_since,
             p.is_complete,
             (select count(*)::int from photos f where f.user_id = p.user_id and f.status = 'approved')
               as approved_photos
        from profiles p left join cities c on c.id = p.home_city_id
       where p.user_id = ${userId}::uuid`);
    const row = result.rows[0];
    if (!row) throw ApiError.notFound();
    const [interests, answers, photos, changeableAt] = await Promise.all([
      this.db.execute<{ interest: string }>(sql`
        select u.interest from user_interests u join interests i on i.code = u.interest
         where u.user_id = ${userId}::uuid order by i.position`),
      this.db.execute<{ question: string; answer: string }>(sql`
        select question, answer from profile_answers
         where user_id = ${userId}::uuid order by position, question`),
      this.photos.listOwn(userId),
      this.homeCityChangeableAt(userId, this.db),
    ]);
    const missing: OwnProfile['missing'] = [];
    if (row.approved_photos < 2) missing.push('photos');
    if (!row.first_name) missing.push('firstName');
    if (!row.gender) missing.push('gender');
    if (!row.interested_in) missing.push('interestedIn');
    if (!row.home_city_id) missing.push('homeCity');
    return {
      firstName: row.first_name,
      lastName: row.last_name,
      birthDate: row.birth_date,
      age: row.age,
      gender: row.gender,
      interestedIn: row.interested_in,
      lookingFor: row.looking_for,
      bio: row.bio,
      practiceArea: row.practice_area,
      homeCity:
        row.home_city_id && row.city_name
          ? { id: row.home_city_id, name: row.city_name, provinceCode: row.city_province ?? '' }
          : null,
      homeCityChangeableAt: changeableAt,
      preferences: { ageMin: row.age_min, ageMax: row.age_max, maxDistance: row.max_distance },
      showCalendar: row.show_calendar,
      readReceipts: row.read_receipts,
      oooSince: asDate(row.ooo_since),
      isComplete: row.is_complete,
      missing,
      interests: interests.rows.map((item) => item.interest),
      answers: answers.rows,
      photos,
    };
  }

  /** Modifica di un gruppo di campi: vale subito, perché sono filtri del feed (D197). */
  async update(userId: string, patch: ProfilePatch): Promise<OwnProfile> {
    for (const text of [patch.firstName, patch.lastName, patch.bio]) {
      if (!(await this.filter.isAllowed(text))) throw new ApiError(422, 'profile.text.rejected');
    }
    if (
      patch.lookingFor &&
      !(await this.taxonomies.isActive('looking_for_options', [patch.lookingFor]))
    ) {
      throw ApiError.badRequest('validation');
    }
    if (
      patch.practiceArea &&
      !(await this.taxonomies.isActive('practice_areas', [patch.practiceArea]))
    ) {
      throw ApiError.badRequest('validation');
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      const current = await tx.execute<{
        age_min: number;
        age_max: number;
        home_city_id: string | null;
      }>(sql`select age_min, age_max, home_city_id from profiles where user_id = ${userId}::uuid`);
      const row = current.rows[0];
      if (!row) throw ApiError.notFound();
      const ageMin = patch.ageMin ?? row.age_min;
      const ageMax = patch.ageMax ?? row.age_max;
      if (ageMin > ageMax) throw new ApiError(422, 'profile.ageRange.invalid');
      if (patch.homeCityId !== undefined && patch.homeCityId !== row.home_city_id) {
        await this.changeHomeCity(tx, userId, patch.homeCityId);
      }
      const sets = [
        patch.firstName !== undefined ? sql`first_name = ${patch.firstName.trim()}` : null,
        patch.lastName !== undefined ? sql`last_name = ${blankToNull(patch.lastName)}` : null,
        patch.gender !== undefined ? sql`gender = ${patch.gender}::gender` : null,
        patch.interestedIn !== undefined
          ? sql`interested_in = ${patch.interestedIn}::interested_in`
          : null,
        patch.lookingFor !== undefined ? sql`looking_for = ${patch.lookingFor}` : null,
        patch.bio !== undefined ? sql`bio = ${blankToNull(patch.bio)}` : null,
        patch.practiceArea !== undefined ? sql`practice_area = ${patch.practiceArea}` : null,
        patch.ageMin !== undefined ? sql`age_min = ${patch.ageMin}` : null,
        patch.ageMax !== undefined ? sql`age_max = ${patch.ageMax}` : null,
        patch.maxDistance !== undefined
          ? sql`max_distance = ${patch.maxDistance}::max_distance`
          : null,
        patch.showCalendar !== undefined ? sql`show_calendar = ${patch.showCalendar}` : null,
        patch.readReceipts !== undefined ? sql`read_receipts = ${patch.readReceipts}` : null,
        // Modalità OOO (D81): la data resta quella della prima attivazione; il promemoria riparte
        patch.ooo === true ? sql`ooo_since = coalesce(ooo_since, now())` : null,
        patch.ooo === true
          ? sql`ooo_reminder_at = case when ooo_since is null then null else ooo_reminder_at end`
          : null,
        patch.ooo === false ? sql`ooo_since = null, ooo_reminder_at = null` : null,
      ].filter((item) => item !== null);
      if (sets.length) {
        await tx.execute(
          sql`update profiles set ${sql.join(sets, sql`, `)} where user_id = ${userId}::uuid`,
        );
      }
    });
    return this.getOwn(userId);
  }

  /** Interessi sostituiti per intero: al massimo 5 in tutto, da una o due sezioni (D48). */
  async setInterests(userId: string, codes: string[]): Promise<OwnProfile> {
    const unique = [...new Set(codes)];
    if (unique.length > 5) throw new ApiError(422, 'interest.limit.reached');
    if (!(await this.taxonomies.isActive('interests', unique)))
      throw ApiError.badRequest('validation');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      await tx.execute(sql`delete from user_interests where user_id = ${userId}::uuid`);
      for (const code of unique) {
        await tx.execute(
          sql`insert into user_interests (user_id, interest) values (${userId}::uuid, ${code})`,
        );
      }
    });
    return this.getOwn(userId);
  }

  /** Domande a tema sostituite per intero: al massimo 3, risposte fino a 150 caratteri (D56). */
  async setAnswers(
    userId: string,
    answers: { question: string; answer: string }[],
  ): Promise<OwnProfile> {
    const questions = answers.map((item) => item.question);
    if (answers.length > 3) throw new ApiError(422, 'profile.questions.limit.reached');
    if (new Set(questions).size !== questions.length) throw ApiError.badRequest('validation');
    if (!(await this.taxonomies.isActive('profile_questions', questions))) {
      throw ApiError.badRequest('validation');
    }
    for (const item of answers) {
      if (!item.answer.trim()) throw new ApiError(422, 'profile.answer.error');
      if (!(await this.filter.isAllowed(item.answer)))
        throw new ApiError(422, 'profile.text.rejected');
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      await tx.execute(sql`delete from profile_answers where user_id = ${userId}::uuid`);
      for (const [index, item] of answers.entries()) {
        await tx.execute(sql`
          insert into profile_answers (user_id, question, answer, position)
          values (${userId}::uuid, ${item.question}, ${item.answer.trim()}, ${index + 1})`);
      }
    });
    return this.getOwn(userId);
  }

  /**
   * Cambio della città base con il limite di frequenza (misura della DPIA): gli eventi non
   * contengono la città; oltre il limite `429` con la data da cui riprovare.
   */
  private async changeHomeCity(tx: Executor, userId: string, cityId: string): Promise<void> {
    const city = await tx.execute<{ id: string }>(
      sql`select id from cities where id = ${cityId} and is_active`,
    );
    if (!city.rows[0]) throw ApiError.badRequest('registration.city.invalid');
    const changeableAt = await this.homeCityChangeableAt(userId, tx);
    if (changeableAt) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'profile.city.limit', {
        date: changeableAt,
      });
    }
    await tx.execute(
      sql`update profiles set home_city_id = ${cityId} where user_id = ${userId}::uuid`,
    );
    await tx.execute(
      sql`insert into rate_limit_events (user_id, type) values (${userId}::uuid, 'home_city')`,
    );
  }

  /** Data da cui si potrà cambiare di nuovo la città base, se il limite è raggiunto. */
  private async homeCityChangeableAt(userId: string, tx: Executor): Promise<Date | null> {
    const max = await this.parameters.int('rate_limits.home_city.max', 3, tx);
    const days = await this.parameters.int('rate_limits.home_city.period_days', 30, tx);
    return rateLimitedUntil(tx, userId, 'home_city', max, days);
  }
}

/**
 * Data da cui un nuovo evento sarà ammesso dal limite di frequenza (`max` eventi in `days`
 * giorni), oppure `null` se è già ammesso.
 */
export async function rateLimitedUntil(
  tx: Executor,
  userId: string,
  type: 'home_city' | 'trip',
  max: number,
  days: number,
): Promise<Date | null> {
  const result = await tx.execute<{ occurred_at: Date | string }>(sql`
    select occurred_at from rate_limit_events
     where user_id = ${userId}::uuid and type = ${type}::rate_limit_event_type
       and occurred_at > now() - make_interval(days => ${days})
     order by occurred_at desc`);
  if (result.rows.length < max) return null;
  const oldestCounted = result.rows[max - 1]!.occurred_at;
  return new Date(new Date(oldestCounted).getTime() + days * 24 * 60 * 60 * 1000);
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
