import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';

export interface Taxonomies {
  lookingFor: { code: string; label: string; intent: string }[];
  interests: { code: string; label: string; section: 'classic' | 'consultant' }[];
  practiceAreas: { code: string; label: string }[];
  profileQuestions: { code: string; label: string; text: string }[];
}

/** Durata della cache L1 delle tassonomie (D229): pochi minuti, i testi cambiano di rado. */
const CACHE_MS = 60_000;

/**
 * Tassonomie a tema come dati (D45, D130): codici stabili, etichette correnti dal database. Le
 * voci non attive spariscono dalle scelte e dai profili, ma restano per i riferimenti. Cache L1
 * in memoria per istanza: non decide mai la visibilità.
 */
@Injectable()
export class TaxonomiesService {
  private cache: { at: number; value: Taxonomies; etag: string } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async all(): Promise<{ value: Taxonomies; etag: string }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const [lookingFor, interests, practiceAreas, profileQuestions] = await Promise.all([
      this.db.execute<{ code: string; label: string; intent: string }>(
        sql`select code, label, intent from looking_for_options where is_active order by position`,
      ),
      this.db.execute<{ code: string; label: string; section: 'classic' | 'consultant' }>(
        sql`select code, label, section from interests where is_active order by position`,
      ),
      this.db.execute<{ code: string; label: string }>(
        sql`select code, label from practice_areas where is_active order by position`,
      ),
      this.db.execute<{ code: string; label: string; text: string }>(
        sql`select code, label, text from profile_questions where is_active order by position`,
      ),
    ]);
    const value: Taxonomies = {
      lookingFor: lookingFor.rows,
      interests: interests.rows,
      practiceAreas: practiceAreas.rows,
      profileQuestions: profileQuestions.rows,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 22)}"`;
    this.cache = { at: Date.now(), value, etag };
    return this.cache;
  }

  /** Voce attiva della tassonomia indicata (per la validazione delle scelte). */
  async isActive(
    table: 'looking_for_options' | 'practice_areas' | 'interests' | 'profile_questions',
    codes: string[],
    tx: Executor = this.db,
  ): Promise<boolean> {
    if (!codes.length) return true;
    const result = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from ${sql.identifier(table)}
       where is_active and code in (${sql.join(
         codes.map((code) => sql`${code}`),
         sql`, `,
       )})`);
    return (result.rows[0]?.n ?? 0) === new Set(codes).size;
  }
}
