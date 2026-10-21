import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { CryptoService } from '../infra/crypto/crypto.service';
import { EnvKeyManagement } from '../infra/kms/key-management';

/**
 * Dati di sviluppo di sicurezza e amministrazione (team B3, D240): segnalazioni vere con le copie
 * cifrate dei testi, una sanzione con il ricorso in attesa, una richiesta della lista d'attesa
 * confermata e un account dimostrativo con il profilo completo. Mai in produzione.
 */
export async function seedSafety(client: PoolClient, crypto: CryptoService): Promise<string[]> {
  const master = process.env.MESSAGE_MASTER_KEY;
  if (!master || master.length < 32) {
    throw new Error('MESSAGE_MASTER_KEY mancante: serve alle copie cifrate delle segnalazioni');
  }
  const kms = new EnvKeyManagement(createHash('sha256').update(master).digest());
  const { rows: people } = await client.query<{ id: string; bio: string | null }>(
    `select x.id, p.bio from users x join profiles p on p.user_id = x.id
      where x.status = 'active' and not x.is_demo order by p.first_name`,
  );
  const [luca, giulia, marco, sara] = people;
  if (!luca || !giulia || !marco || !sara) return [];
  const report = async (
    reporter: string,
    reported: { id: string; bio: string | null },
    reason: string,
    severe: boolean,
    text: string | null,
  ) => {
    const key = randomBytes(32);
    const wrapped = await kms.encryptDataKey(key);
    const { rows } = await client.query<{ id: string }>(
      `insert into reports (reporter_id, reported_id, reason, text, source, severity, due_at,
                            content_key, content_key_version)
       values ($1, $2, $3, $4, 'feed', $5, now() + make_interval(hours => $6), $7, $8) returning id`,
      [
        reporter,
        reported.id,
        reason,
        text,
        severe ? 'severe' : 'standard',
        severe ? 24 : 72,
        wrapped.ciphertext,
        wrapped.keyVersion,
      ],
    );
    await client.query(
      `insert into blocks (from_user_id, to_user_id) values ($1, $2) on conflict do nothing`,
      [reporter, reported.id],
    );
    if (reported.bio) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const body = Buffer.concat([cipher.update(reported.bio, 'utf8'), cipher.final()]);
      await client.query(
        `insert into report_contents (report_id, type, field, ciphertext, nonce)
         values ($1, 'profile_text', 'bio', $2, $3)`,
        [rows[0]!.id, Buffer.concat([body, cipher.getAuthTag()]), nonce],
      );
    }
  };
  await report(luca.id, marco, 'spam_scam', false, null);
  await report(giulia.id, marco, 'harassment', true, 'Messaggi insistenti dopo il rifiuto');
  await report(sara.id, giulia, 'other', false, 'Profilo con dati di un cliente');
  // Avviso già deciso, con il ricorso da esaminare
  const { rows: sanction } = await client.query<{ id: string }>(
    `insert into sanctions (user_id, type, explanation, appeal_deadline_at, notified_at)
     values ($1, 'warning', 'Linguaggio offensivo nella bio', now() + interval '6 months', now())
     returning id`,
    [sara.id],
  );
  await client.query(
    `insert into appeals (sanction_id, text, due_at) values ($1, 'Era una citazione, la tolgo subito.', now() + interval '7 days')`,
    [sanction[0]!.id],
  );
  await client.query(
    `insert into waitlist_requests (domain, suggested_name, contact_email, contact_confirmed_at, expires_at)
     values ('studio-nuovo.example', 'Studio Nuovo', 'contatto@personale.example', now(), now() + interval '90 days')`,
  );
  // Account del revisore degli store nell'azienda dimostrativa (D42): entra con il codice
  const { rows: demoCompany } = await client.query<{ id: string }>(
    'select id from companies where is_demo order by name limit 1',
  );
  if (!demoCompany[0]) return [];
  const email = 'revisore@personale.example';
  const hash = crypto.hash('email', email);
  const { rows: demo } = await client.query<{ id: string }>(
    "insert into users (company_id, is_demo, status) values ($1, true, 'registering') returning id",
    [demoCompany[0].id],
  );
  const demoId = demo[0]!.id;
  await client.query(
    `insert into personal_identities (user_id, provider, subject, email, email_hash, email_verified_at)
     values ($1, 'email', $2, $3, $2, now())`,
    [demoId, hash, email],
  );
  await client.query(
    `insert into work_emails (user_id, company_id, domain, email, email_hash, verified_at, next_reverification_at)
     values ($1, $2, 'demo-consulenza.example', 'revisore@demo-consulenza.example', $3, now(), now() + interval '90 days')`,
    [demoId, demoCompany[0].id, crypto.hash('email', 'revisore@demo-consulenza.example')],
  );
  await client.query(
    `insert into profiles (user_id, first_name, birth_date, gender, interested_in, bio, home_city_id)
     values ($1, 'Revisore', '1990-01-01', 'undisclosed', 'everyone', 'Account dimostrativo', '015146')`,
    [demoId],
  );
  await client.query("select set_open_space($1, false, 'registration', 'seed')", [demoId]);
  await client.query("update users set status = 'active' where id = $1", [demoId]);
  return [email];
}
