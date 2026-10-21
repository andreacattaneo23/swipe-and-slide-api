-- Team B3 (D239): tabelle e colonne di sicurezza, moderazione, approvazione e amministrazione
-- (architettura, "Sicurezza e moderazione", "Approvazione dei profili", "Lista d'attesa e
-- backoffice"). Solo aggiunte: le tabelle esistenti cambiano con `ALTER`.

-- ---------------------------------------------------------------------------------------------
-- Tipi nuovi
-- ---------------------------------------------------------------------------------------------
-- Motivi del rifiuto dell'approvazione (D142, D197): un solo elenco per backend e backoffice,
-- pubblicato nel contratto OpenAPI. `non_compliant_photo` = foto che non ritrae una persona
-- ("Foto non conforme" in testi.js, `reason.photos`).
CREATE TYPE review_rejection_reason AS ENUM
  ('non_compliant_photo', 'inappropriate_photos', 'fake_profile', 'disallowed_text',
   'reveals_company_or_clients');
-- Decisioni della moderazione su una segnalazione (architettura, "Coda di moderazione")
CREATE TYPE moderation_decision AS ENUM
  ('dismissed', 'content_removed', 'match_closed', 'warning', 'disciplinary_suspension',
   'expulsion');
CREATE TYPE appeal_outcome AS ENUM ('pending', 'accepted', 'rejected');
-- Motivi della lettura di una chat da parte dell'Amministratore (D187)
CREATE TYPE chat_read_reason AS ENUM ('authority_request', 'security_investigation');
CREATE TYPE age_verification_outcome AS ENUM ('adult', 'minor');
CREATE TYPE report_content_type AS ENUM ('message', 'profile_text', 'photo');
CREATE TYPE operator_challenge_stage AS ENUM ('code', 'totp');

-- ---------------------------------------------------------------------------------------------
-- Approvazione (D142): motivo come enum, al posto del testo libero
-- ---------------------------------------------------------------------------------------------
ALTER TABLE profile_reviews
  ALTER COLUMN reason TYPE review_rejection_reason USING reason::review_rejection_reason;
-- Avviso della cancellazione dei profili rifiutati e non ripresentati (D197, 7 giorni prima)
ALTER TABLE profile_reviews ADD COLUMN deletion_notice_at timestamptz;
CREATE INDEX profile_reviews_due_idx ON profile_reviews (due_at) WHERE outcome = 'pending';

-- Foto nuove dopo l'approvazione (D143): data di arrivo nella coda "Foto nuove" e avviso a 20 ore
ALTER TABLE photos ADD COLUMN team_alert_at timestamptz;
CREATE INDEX photos_under_review_idx ON photos (uploaded_at) WHERE status = 'under_review';

-- ---------------------------------------------------------------------------------------------
-- Segnalazioni (D71, D72, D74, D113)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE reports
  -- Esito come codice della decisione (la colonna nasce testo libero e resta vuota fino ad ora)
  ALTER COLUMN outcome TYPE moderation_decision USING outcome::moderation_decision,
  ADD COLUMN match_id            uuid REFERENCES matches (id) ON DELETE SET NULL,
  -- Aziende di chi segnala e della persona segnalata, solo per "Lavora nella mia azienda" (D72)
  ADD COLUMN reporter_company_id uuid REFERENCES companies (id) ON DELETE SET NULL,
  ADD COLUMN reported_company_id uuid REFERENCES companies (id) ON DELETE SET NULL,
  ADD COLUMN contains_threats    boolean NOT NULL DEFAULT false,
  -- Segnalazioni tra account dimostrativi: nella coda con il segno "dimostrativa", senza scadenza
  ADD COLUMN is_demo             boolean NOT NULL DEFAULT false,
  ADD COLUMN decided_by          uuid REFERENCES operators (id) ON DELETE SET NULL,
  ADD COLUMN decided_at          timestamptz,
  ADD COLUMN closed_at           timestamptz,
  -- Avvisi della scadenza ai moderatori (tre quarti del tempo e scadenza, solo conteggi)
  ADD COLUMN alerted_at          timestamptz,
  -- Chiave dei contenuti copiati, cifrata dall'adattatore KMS (D183)
  ADD COLUMN content_key         bytea,
  ADD COLUMN content_key_version text,
  ADD CONSTRAINT reports_closed_check CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT reports_key_check CHECK ((content_key IS NULL) = (content_key_version IS NULL));
CREATE INDEX reports_reported_idx ON reports (reported_id, reason, status);
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at);

-- Copie dei contenuti segnalati (D63, D71): sopravvivono alla cancellazione dei messaggi e alle
-- modifiche del profilo, cifrate con la chiave della segnalazione
CREATE TABLE report_contents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  type            report_content_type NOT NULL,
  -- Messaggi: chi l'ha scritto rispetto alla segnalazione e quando; mai il mittente
  by_reported     boolean,
  source_at       timestamptz,
  -- Testi del profilo: campo di origine (es. `bio`, `first_name`)
  field           text,
  ciphertext      bytea,
  nonce           bytea,
  -- Foto: copia nell'area privata dell'archivio
  storage_key     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'photo') = (storage_key IS NOT NULL)),
  CHECK ((ciphertext IS NULL) = (nonce IS NULL)),
  CHECK (type = 'photo' OR ciphertext IS NOT NULL)
);
CREATE INDEX report_contents_report_idx ON report_contents (report_id);

-- ---------------------------------------------------------------------------------------------
-- Sanzioni e ricorsi (D75, D113)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sanctions
  ADD COLUMN notified_at     timestamptz,
  ADD COLUMN end_notified_at timestamptz,
  ADD CONSTRAINT sanctions_ends_check CHECK (ends_at IS NULL OR ends_at > starts_at);

CREATE TABLE appeals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id  uuid UNIQUE REFERENCES sanctions (id) ON DELETE CASCADE,
  review_id    uuid UNIQUE REFERENCES profile_reviews (id) ON DELETE CASCADE,
  text         text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 1000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,
  reviewed_by  uuid REFERENCES operators (id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  outcome      appeal_outcome NOT NULL DEFAULT 'pending',
  -- Risposta motivata per l'utente (D75, DSA art. 20)
  explanation  text CHECK (length(explanation) <= 1000),
  CHECK ((sanction_id IS NULL) <> (review_id IS NULL)),
  CHECK (outcome = 'pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX appeals_queue_idx ON appeals (outcome, due_at);

-- ---------------------------------------------------------------------------------------------
-- Verifica dell'età (D113): nessun dato del documento, la riga si cancella con l'esito
-- ---------------------------------------------------------------------------------------------
CREATE TABLE age_verifications (
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  report_id    uuid REFERENCES reports (id) ON DELETE SET NULL,
  requested_by uuid REFERENCES operators (id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  storage_key  text,
  uploaded_at  timestamptz,
  CHECK ((storage_key IS NULL) = (uploaded_at IS NULL))
);

-- ---------------------------------------------------------------------------------------------
-- Avvisi aggregati di "Lavora nella mia azienda" (D72): solo la coppia di aziende
-- ---------------------------------------------------------------------------------------------
CREATE TABLE directory_alerts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  reported_company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  closed_by           uuid REFERENCES operators (id) ON DELETE SET NULL,
  CHECK (reporter_company_id <> reported_company_id)
);
CREATE UNIQUE INDEX directory_alerts_open_key
  ON directory_alerts (reporter_company_id, reported_company_id) WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Finestre di revisione degli store (D42): codice solo come impronta, 10 tentativi, 14 giorni
-- ---------------------------------------------------------------------------------------------
CREATE TABLE store_review_windows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by       uuid REFERENCES operators (id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closes_at       timestamptz NOT NULL,
  code_hash       text NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 10),
  closed_at       timestamptz,
  CHECK (closes_at > opened_at AND closes_at <= opened_at + interval '14 days')
);
CREATE UNIQUE INDEX store_review_windows_open_key
  ON store_review_windows ((true)) WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Accesso degli operatori in due passi (codice, poi TOTP): sfida a uso singolo [Proposta]
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operator_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash    text NOT NULL,
  -- Indirizzo digitato dall'operatore, già mascherato per la risposta (D90)
  masked_email  text NOT NULL,
  operator_id   uuid REFERENCES operators (id) ON DELETE CASCADE,
  stage         operator_challenge_stage NOT NULL DEFAULT 'code',
  totp_attempts smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  CHECK (stage = 'code' OR operator_id IS NOT NULL)
);
CREATE INDEX operator_challenges_expiry_idx ON operator_challenges (expires_at);
-- Rifiuto del riuso dello stesso codice TOTP (passo di 30 secondi già usato)
ALTER TABLE operators ADD COLUMN last_totp_step bigint;

-- ---------------------------------------------------------------------------------------------
-- Avvisi email agli utenti dalle API di amministrazione e dai processi: l'API di
-- amministrazione non legge mai l'indirizzo (D90); il processo `send-notices` lo invia
-- all'email personale con un testo neutro e cancella la riga
-- ---------------------------------------------------------------------------------------------
CREATE TABLE user_notices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  template   text NOT NULL CHECK (template ~ '^[a-z][a-z_.]*$'),
  params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts   smallint NOT NULL DEFAULT 0
);
CREATE INDEX user_notices_created_idx ON user_notices (created_at);

-- Risposte alla lista d'attesa (D95): email di contatto, senza legami con gli utenti
CREATE TABLE waitlist_notices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  attempts      smallint NOT NULL DEFAULT 0
);

-- Avvisi al team (approvazioni, moderazione, processi): solo conteggi, mai persone
CREATE TABLE team_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind ~ '^[a-z][a-z_.-]*$'),
  counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

-- ---------------------------------------------------------------------------------------------
-- Configurazione: valori di partenza confermati dalle decisioni (D74, D75, D89, D95, D111,
-- D113, D142, D144, D197) [Proposta per quelli senza decisione]
-- ---------------------------------------------------------------------------------------------
INSERT INTO config (key, value) VALUES
  ('moderation.severe_hours', '24'),
  ('moderation.standard_hours', '72'),
  ('reports.daily_max', '10'),
  ('sanctions.suspension_days', '7'),
  ('sanctions.appeal_months', '6'),
  ('appeals.response_days', '7'),
  ('expulsion.deletion_days', '7'),
  ('blocked_hashes.years', '2'),
  ('age_verification.document_hours', '72'),
  ('works_at_my_company.reverification_days', '30'),
  ('works_at_my_company.outcome_days', '7'),
  ('directory_alerts.threshold', '3'),
  ('directory_alerts.period_days', '30'),
  ('approval.rejected_deletion_days', '30'),
  ('approval.rejected_notice_days', '7'),
  ('company_removal.interval_hours', '24'),
  ('stats.min_count', '10'),
  ('review_window.max_days', '14'),
  ('review_window.max_attempts', '10'),
  ('word_filter.words', '[]'),
  ('photo_check.reject', '["LIKELY", "VERY_LIKELY"]'),
  ('photo_check.review', '["POSSIBLE"]')
ON CONFLICT (key) DO NOTHING;
