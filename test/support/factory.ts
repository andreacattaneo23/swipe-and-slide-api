import { randomUUID } from 'node:crypto';
import { type Pool, type PoolClient } from 'pg';

/**
 * Dati di prova scritti direttamente nel database, con le stesse regole dei trigger: un utente
 * attivo ha email aziendale attiva, consensi, profilo completo, scelta dell'Open space in
 * registrazione e una revisione approvata da un operatore.
 */
export type Status = 'registering' | 'pending_approval' | 'active' | 'reverifying' | 'suspended';

export interface UserOptions {
  status?: Status;
  openSpace?: boolean;
  isDemo?: boolean;
  /** Solo per `registering`: account senza azienda (prima del passo 3). */
  withoutCompany?: boolean;
}

type Db = Pool | PoolClient;

export class Factory {
  private operatorId: string | null = null;
  private counter = 0;

  constructor(private readonly pool: Pool) {}

  async company(options: { isDemo?: boolean; domain?: string } = {}): Promise<string> {
    const n = ++this.counter;
    const { rows } = await this.pool.query<{ id: string }>(
      'insert into companies (name, is_demo) values ($1, $2) returning id',
      [`Azienda ${n} ${randomUUID().slice(0, 6)}`, options.isDemo ?? false],
    );
    const id = rows[0]!.id;
    await this.pool.query('insert into company_domains (domain, company_id) values ($1, $2)', [
      options.domain ?? `azienda${n}-${id.slice(0, 6)}.example`,
      id,
    ]);
    return id;
  }

  async domainOf(companyId: string): Promise<string> {
    const { rows } = await this.pool.query<{ domain: string }>(
      'select domain from company_domains where company_id = $1 order by domain limit 1',
      [companyId],
    );
    return rows[0]!.domain;
  }

  async operator(): Promise<string> {
    if (this.operatorId) {
      const { rowCount } = await this.pool.query('select 1 from operators where id = $1', [
        this.operatorId,
      ]);
      if (rowCount) return this.operatorId;
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into operators (email, name, roles, encrypted_totp_secret)
       values ($1, 'Operatore di prova', '{admin,moderator,support}', 'x') returning id`,
      [`op-${randomUUID()}@backoffice.example`],
    );
    this.operatorId = rows[0]!.id;
    return this.operatorId;
  }

  /** Utente con l'azienda indicata e lo stato richiesto (di base attivo, Open space spento). */
  async user(companyId: string | null, options: UserOptions = {}): Promise<string> {
    const status = options.status ?? 'active';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const isDemo = options.isDemo ?? false;
      const { rows } = await client.query<{ id: string }>(
        "insert into users (company_id, is_demo, status) values ($1, $2, 'registering') returning id",
        [options.withoutCompany ? null : companyId, isDemo],
      );
      const id = rows[0]!.id;
      await client.query(
        `insert into personal_identities (user_id, provider, subject, email, email_hash, email_verified_at)
         values ($1, 'email', $2, $3, $2, now())`,
        [id, `hash-${id}`, `persona-${id}@personale.example`],
      );
      if (!options.withoutCompany && companyId) {
        const domain = await this.domainOf(companyId);
        await client.query(
          `insert into work_emails (user_id, company_id, domain, email, email_hash, verified_at, next_reverification_at)
           values ($1, $2, $3, $4, $5, now(), now() + interval '90 days')`,
          [id, companyId, domain, `persona-${id}@${domain}`, `work-${id}`],
        );
      }
      await client.query(
        `insert into profiles (user_id, first_name, birth_date, gender, interested_in, home_city_id)
         values ($1, 'Persona', '1992-01-01', 'woman', 'everyone', null)`,
        [id],
      );
      for (const type of ['terms', 'p7_declaration', 'art9']) {
        await client.query(
          "insert into consents (user_id, type, text_version) values ($1, $2, 'test')",
          [id, type],
        );
      }
      await client.query("select set_open_space($1, $2, 'registration', 'test')", [
        id,
        options.openSpace ?? false,
      ]);
      if (status !== 'registering') {
        await client.query("update users set status = 'pending_approval' where id = $1", [id]);
        if (status !== 'pending_approval') {
          await client.query(
            `insert into profile_reviews (user_id, attempt, due_at, outcome, decided_by, decided_at)
             values ($1, 1, now() + interval '1 day', 'approved', $2, now())`,
            [id, await this.operator()],
          );
          await client.query("update users set status = 'active' where id = $1", [id]);
          if (status !== 'active')
            await client.query('update users set status = $2 where id = $1', [id, status]);
        } else {
          await client.query(
            "insert into profile_reviews (user_id, attempt, due_at) values ($1, 1, now() + interval '1 day')",
            [id],
          );
        }
      }
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setOpenSpace(
    userId: string,
    enabled: boolean,
    source = 'user',
  ): Promise<{ result: boolean; changeable_at: Date | null }> {
    const { rows } = await this.pool.query<{ result: boolean; changeable_at: Date | null }>(
      'select * from set_open_space($1, $2, $3::open_space_source, $4)',
      [userId, enabled, source, 'test'],
    );
    return rows[0]!;
  }

  async like(from: string, to: string, db: Db = this.pool): Promise<void> {
    await db.query("insert into swipes (from_user_id, to_user_id, type) values ($1, $2, 'like')", [
      from,
      to,
    ]);
  }

  /** Match attivo tra due persone (ordine canonico), facoltativamente con un messaggio. */
  async match(a: string, b: string, options: { withMessageFrom?: string } = {}): Promise<string> {
    const [first, second] = a < b ? [a, b] : [b, a];
    const { rows } = await this.pool.query<{ id: string }>(
      'insert into matches (user_a_id, user_b_id) values ($1, $2) returning id',
      [first, second],
    );
    const id = rows[0]!.id;
    if (options.withMessageFrom) await this.message(id, options.withMessageFrom);
    return id;
  }

  async message(matchId: string, senderId: string, db: Db = this.pool): Promise<void> {
    await db.query(
      `insert into messages (match_id, sender_id, ciphertext, nonce, client_message_id)
       values ($1, $2, '\\x00', '\\x00', gen_random_uuid())`,
      [matchId, senderId],
    );
  }

  async invite(matchId: string, proposedBy: string, cityId: string): Promise<void> {
    await this.pool.query(
      `insert into invites (match_id, proposed_by, type, day, time_slot, city_id)
       values ($1, $2, 'sync_coffee', current_date + 3, 'morning', $3)`,
      [matchId, proposedBy, cityId],
    );
  }

  async city(): Promise<string> {
    await this.pool.query(
      `insert into cities (id, name, province_code, region, lat, lon, population, search_name)
       values ('015146', 'Milano', 'MI', 'Lombardia', 45.46, 9.19, 1371498, 'milano')
       on conflict (id) do nothing`,
    );
    return '015146';
  }

  async block(from: string, to: string, unblockedDaysAgo?: number): Promise<void> {
    await this.pool.query(
      `insert into blocks (from_user_id, to_user_id, unblocked_at)
       values ($1, $2, case when $3::int is null then null else now() - make_interval(days => $3::int) end)`,
      [from, to, unblockedDaysAgo ?? null],
    );
  }

  async exclude(
    userId: string,
    companyId: string,
    source = 'user',
    db: Db = this.pool,
  ): Promise<void> {
    await db.query(
      'insert into excluded_companies (user_id, company_id, source) values ($1, $2, $3)',
      [userId, companyId, source],
    );
  }

  async sanction(userId: string, type = 'disciplinary_suspension'): Promise<void> {
    await this.pool.query(
      `insert into sanctions (user_id, type, explanation, ends_at)
       values ($1, $2, 'test', now() + interval '7 days')`,
      [userId, type],
    );
  }

  /**
   * Cambio di azienda come lo descrive l'architettura ("Cambio azienda", D9, D59, D176): nella
   * stessa transazione email storica e nuova email attiva, azienda dell'account, azienda lasciata
   * tra le escluse (`company_change`) e nuova azienda tolta dall'elenco, Open space spento con
   * origine `company_change`, revoca tra i nuovi colleghi. [Il modulo applicativo è da fare]
   */
  async changeCompany(
    userId: string,
    toCompanyId: string,
    options: { skipRealign?: boolean; keepNewCompanyExcluded?: boolean; db?: PoolClient } = {},
  ): Promise<void> {
    const client = options.db ?? (await this.pool.connect());
    const own = !options.db;
    try {
      if (own) await client.query('BEGIN');
      const { rows } = await client.query<{ company_id: string }>(
        'select company_id from users where id = $1 for update',
        [userId],
      );
      const from = rows[0]!.company_id;
      const domain = await this.domainOf(toCompanyId);
      await client.query(
        "update work_emails set status = 'historical', email = null where user_id = $1 and status = 'active'",
        [userId],
      );
      await client.query(
        `insert into work_emails (user_id, company_id, domain, email, email_hash, verified_at, next_reverification_at)
         values ($1, $2, $3, $4, $5, now(), now() + interval '90 days')`,
        [
          userId,
          toCompanyId,
          domain,
          `persona-${userId}-${Date.now()}@${domain}`,
          `work-${userId}-${randomUUID()}`,
        ],
      );
      await client.query('update users set company_id = $2 where id = $1', [userId, toCompanyId]);
      if (!options.keepNewCompanyExcluded) {
        await client.query(
          'delete from excluded_companies where user_id = $1 and company_id = $2',
          [userId, toCompanyId],
        );
      }
      await client.query(
        `update excluded_company_changes set status = 'cancelled', closed_at = now()
          where user_id = $1 and company_id = $2 and status = 'pending'`,
        [userId, from],
      );
      await client.query(
        `insert into excluded_companies (user_id, company_id, source) values ($1, $2, 'company_change')
         on conflict (user_id, company_id) do update set source = 'company_change', effective_at = now()`,
        [userId, from],
      );
      await client.query("select set_open_space($1, false, 'company_change', null)", [userId]);
      if (!options.skipRealign) await client.query('select realign_users($1::uuid[])', [[userId]]);
      if (own) await client.query('COMMIT');
    } catch (error) {
      if (own) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (own) client.release();
    }
  }
}
