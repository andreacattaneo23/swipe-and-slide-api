-- Schema MVP di Swipe & Slide: tipi, tabelle, vincoli e indici del modello dati
-- dell'architettura (capitolo "Modello dati"). Nomi dal glossario (D215): tabelle al plurale in
-- snake_case, date con `_at` / `_since`, chiavi uuid, valori a scelta chiusa come enum.
-- Funzioni della regola core e trigger sono nelle migrazioni successive.

-- ---------------------------------------------------------------------------------------------
-- Tipi enum
-- ---------------------------------------------------------------------------------------------
CREATE TYPE account_status AS ENUM
  ('registering', 'pending_approval', 'active', 'reverifying', 'suspended', 'deleted');
CREATE TYPE company_status AS ENUM ('active', 'merged', 'removing');
CREATE TYPE work_email_status AS ENUM ('active', 'historical');
CREATE TYPE reverification_reason AS ENUM ('expiry', 'ad_hoc', 'email_bounced', 'domain_removed');
CREATE TYPE company_change_source AS ENUM
  ('user', 'restore', 'domain_removed', 'domain_moved', 'merge');
CREATE TYPE consent_type AS ENUM ('art9', 'terms', 'p7_declaration');
CREATE TYPE identity_provider AS ENUM ('apple', 'google', 'email');
CREATE TYPE sign_in_method AS ENUM
  ('apple', 'google', 'personal_email', 'work_email', 'review_code');
CREATE TYPE session_scope AS ENUM ('full', 'registration', 'approval', 'restore', 'limited');
CREATE TYPE open_space_source AS ENUM ('registration', 'approval', 'user', 'company_change');
CREATE TYPE exclusion_source AS ENUM ('registration', 'approval', 'user', 'company_change');
CREATE TYPE exclusion_operation AS ENUM ('add', 'remove');
CREATE TYPE exclusion_change_status AS ENUM ('pending', 'applied', 'cancelled');
CREATE TYPE gender AS ENUM ('woman', 'man', 'non_binary', 'undisclosed');
CREATE TYPE interested_in AS ENUM ('men', 'women', 'everyone');
CREATE TYPE max_distance AS ENUM ('city', 'km25', 'km50', 'km100', 'km200', 'italy');
CREATE TYPE photo_status AS ENUM
  ('uploading', 'checking', 'pending_approval', 'approved', 'under_review', 'rejected');
CREATE TYPE photo_result_reason AS ENUM ('explicit_content', 'violence');
CREATE TYPE swipe_type AS ENUM ('like', 'pass', 'escalation');
CREATE TYPE match_status AS ENUM ('active', 'closed');
CREATE TYPE match_close_reason AS ENUM
  ('closed_by_user', 'blocked', 'expired', 'colleagues', 'moderation', 'account_deleted');
CREATE TYPE invite_type AS ENUM
  ('sync_coffee', 'post_review_drinks', 'kickoff_dinner', 'walk_and_talk');
CREATE TYPE time_slot AS ENUM ('morning', 'lunch', 'afternoon', 'evening');
CREATE TYPE invite_status AS ENUM
  ('pending', 'accepted', 'declined', 'replaced', 'cancelled', 'expired', 'completed', 'closed');
CREATE TYPE offsite_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE review_outcome AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE report_reason AS ENUM
  ('fake_profile', 'inappropriate_photos', 'harassment', 'spam_scam', 'possible_minor',
   'works_at_my_company', 'other');
CREATE TYPE report_source AS ENUM ('feed', 'match', 'chat');
CREATE TYPE report_severity AS ENUM ('severe', 'standard');
CREATE TYPE sanction_type AS ENUM
  ('warning', 'disciplinary_suspension', 'precautionary_suspension', 'expulsion');
CREATE TYPE severe_case AS ENUM
  ('threats_violence', 'minor_content', 'fraud', 'stalking', 'colleague_rule_evasion',
   'false_statements');
CREATE TYPE hash_type AS ENUM ('personal', 'work');
CREATE TYPE blocked_hash_source AS ENUM ('expulsion', 'third_rejection');
CREATE TYPE operator_role AS ENUM ('admin', 'moderator', 'support');
CREATE TYPE audit_type AS ENUM ('action', 'security');
CREATE TYPE audit_action AS ENUM
  ('company_created', 'company_updated', 'domain_added', 'domain_moved', 'domain_removed',
   'companies_merged', 'removal_started', 'removal_cancelled', 'company_deleted',
   'email_revealed', 'sanction_decided', 'appeal_decided', 'reverification_forced',
   'birth_date_corrected', 'age_verification_recorded', 'profile_approved', 'profile_rejected',
   'photo_approved', 'photo_rejected', 'third_rejection_block', 'chat_read', 'offsite_created',
   'offsite_published', 'offsite_updated', 'offsite_cancelled', 'account_deleted',
   'config_changed', 'review_window_opened', 'operator_login', 'core_rule_trigger',
   'consistency_anomaly', 'operator_login_failed', 'review_code_wrong',
   'provider_token_rejected', 'refresh_token_reused');
CREATE TYPE otp_purpose AS ENUM
  ('login', 'registration', 'company_change', 'reverification', 'personal_email', 'deletion',
   'waitlist', 'operator');

-- ---------------------------------------------------------------------------------------------
-- Operatori del backoffice (distinti dagli utenti, nessun legame con `users`)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operators (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE CHECK (email = lower(email)),
  name                  text NOT NULL,
  roles                 operator_role[] NOT NULL CHECK (cardinality(roles) > 0),
  encrypted_totp_secret text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operator_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_totp_at timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX operator_sessions_operator_idx ON operator_sessions (operator_id);

-- ---------------------------------------------------------------------------------------------
-- Elenco delle aziende (D23, D35, D84, D111, D185)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE companies (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  status                 company_status NOT NULL DEFAULT 'active',
  merged_into_company_id uuid REFERENCES companies (id) ON DELETE SET NULL,
  removal_started_at     timestamptz,
  removal_final_at       timestamptz,
  is_demo                boolean NOT NULL DEFAULT false,
  created_by             uuid REFERENCES operators (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((removal_started_at IS NULL) = (removal_final_at IS NULL))
);
-- Nomi unici senza distinguere maiuscole e minuscole [Proposta]
CREATE UNIQUE INDEX companies_name_key ON companies (lower(name));

CREATE TABLE company_domains (
  domain     text PRIMARY KEY CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9.-]+\.[a-z0-9-]+$'),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_domains_company_idx ON company_domains (company_id);

-- ---------------------------------------------------------------------------------------------
-- Comuni ISTAT (D49, D115): solo le colonne usate dalla città base
-- ---------------------------------------------------------------------------------------------
CREATE TABLE cities (
  id              text PRIMARY KEY CHECK (id ~ '^[0-9]{6}$'),
  name            text NOT NULL,
  province_code   text NOT NULL,
  region          text NOT NULL,
  lat             double precision NOT NULL,
  lon             double precision NOT NULL,
  population      integer NOT NULL DEFAULT 0,
  display_city_id text REFERENCES cities (id),
  search_name     text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  replaced_by     text REFERENCES cities (id)
);
CREATE INDEX cities_search_idx ON cities (search_name text_pattern_ops);

-- ---------------------------------------------------------------------------------------------
-- Utenti, identità personali, email aziendali, cambi di azienda, Open space, consensi
-- ---------------------------------------------------------------------------------------------
CREATE TABLE users (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid REFERENCES companies (id),
  is_demo                      boolean NOT NULL DEFAULT false,
  status                       account_status NOT NULL DEFAULT 'registering',
  open_space                   boolean NOT NULL DEFAULT false,
  open_space_since             timestamptz,
  open_space_prompt_at         timestamptz,
  reverification_due_at        timestamptz,
  reverification_reason        reverification_reason,
  ad_hoc_reverification_at     timestamptz,
  deletion_scheduled_at        timestamptz,
  deletion_requested_at        timestamptz,
  deletion_final_at            timestamptz,
  excluded_companies_notice_at timestamptz,
  last_seen_on                 date,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  -- Azienda vuota solo in registrazione, prima del passo 3 (D224), e nello stato di passaggio
  CHECK (company_id IS NOT NULL OR status IN ('registering', 'deleted')),
  -- Stato e data dell'Open space coerenti (D137)
  CHECK ((open_space_since IS NOT NULL) = open_space)
);
CREATE INDEX users_feed_idx ON users (company_id, is_demo, status);

CREATE TABLE personal_identities (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider                  identity_provider NOT NULL,
  subject                   text NOT NULL,
  email                     text NOT NULL CHECK (email = lower(email)),
  email_hash                text NOT NULL,
  email_verified_at         timestamptz NOT NULL,
  is_private_relay          boolean NOT NULL DEFAULT false,
  refresh_token_ciphertext  text,
  refresh_token_key_version text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at           timestamptz,
  revoked_at                timestamptz,
  UNIQUE (provider, subject),
  UNIQUE (email_hash),
  -- Nessun token né email nascosta per l'identità `email` (D224)
  CHECK (provider <> 'email'
         OR (refresh_token_ciphertext IS NULL AND NOT is_private_relay AND subject = email_hash)),
  CHECK ((refresh_token_ciphertext IS NULL) = (refresh_token_key_version IS NULL))
);
-- Una sola identità attiva per account
CREATE UNIQUE INDEX personal_identities_active_key
  ON personal_identities (user_id) WHERE revoked_at IS NULL;

CREATE TABLE work_emails (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id             uuid REFERENCES companies (id) ON DELETE SET NULL,
  domain                 text,
  email                  text CHECK (email = lower(email)),
  email_hash             text NOT NULL UNIQUE,
  status                 work_email_status NOT NULL DEFAULT 'active',
  verified_at            timestamptz NOT NULL,
  next_reverification_at timestamptz NOT NULL,
  bounced_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Nessun indirizzo storico in chiaro
  CHECK ((email IS NOT NULL) = (status = 'active')),
  CHECK (status = 'historical' OR company_id IS NOT NULL)
);
CREATE UNIQUE INDEX work_emails_active_key ON work_emails (user_id) WHERE status = 'active';

CREATE TABLE company_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_company_id uuid REFERENCES companies (id) ON DELETE SET NULL,
  to_company_id   uuid REFERENCES companies (id) ON DELETE SET NULL,
  source          company_change_source NOT NULL,
  matches_revoked integer NOT NULL DEFAULT 0,
  likes_deleted   integer NOT NULL DEFAULT 0,
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_changes_user_idx ON company_changes (user_id, changed_at);

CREATE TABLE open_space_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  enabled      boolean NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  source       open_space_source NOT NULL,
  text_version text
);
-- Limite delle 5 modifiche ogni 30 giorni (solo origine `user`)
CREATE INDEX open_space_history_user_idx
  ON open_space_history (user_id, changed_at) WHERE source = 'user';
CREATE INDEX open_space_history_registration_idx
  ON open_space_history (user_id) WHERE source = 'registration';

-- Prova del consenso: `user_id` senza chiave esterna, resta dopo la cancellazione (D98)
CREATE TABLE consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid,
  type         consent_type NOT NULL,
  text_version text NOT NULL,
  given_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  email_hash   text,
  CHECK (type = 'art9' OR revoked_at IS NULL)
);
CREATE INDEX consents_user_idx ON consents (user_id, type);

-- ---------------------------------------------------------------------------------------------
-- Aziende escluse (D175, D176, D186) e modifiche in attesa (D36, D39)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE excluded_companies (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  effective_at timestamptz NOT NULL DEFAULT now(),
  source       exclusion_source NOT NULL,
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX excluded_companies_reverse_idx ON excluded_companies (company_id, user_id);

CREATE TABLE excluded_company_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  operation    exclusion_operation NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz NOT NULL,
  status       exclusion_change_status NOT NULL DEFAULT 'pending',
  closed_at    timestamptz,
  CHECK (effective_at BETWEEN requested_at + interval '24 hours'
                          AND requested_at + interval '47 hours'),
  CHECK ((status = 'pending') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX excluded_company_changes_pending_key
  ON excluded_company_changes (user_id, company_id) WHERE status = 'pending';
CREATE INDEX excluded_company_changes_due_idx
  ON excluded_company_changes (effective_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------------------------
-- Profilo e foto (D46, D47, D48, D51, D112, D143)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE profiles (
  user_id         uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  first_name      text CHECK (length(first_name) BETWEEN 1 AND 30),
  last_name       text CHECK (length(last_name) BETWEEN 1 AND 40),
  birth_date      date NOT NULL,
  gender          gender,
  interested_in   interested_in,
  looking_for     text,
  bio             text CHECK (length(bio) <= 300),
  practice_area   text,
  home_city_id    text REFERENCES cities (id),
  age_min         smallint NOT NULL DEFAULT 18 CHECK (age_min BETWEEN 18 AND 99),
  age_max         smallint NOT NULL DEFAULT 99 CHECK (age_max BETWEEN 18 AND 99),
  max_distance    max_distance NOT NULL DEFAULT 'km50',
  show_calendar   boolean NOT NULL DEFAULT true,
  read_receipts   boolean NOT NULL DEFAULT false,
  ooo_since       timestamptz,
  ooo_reminder_at timestamptz,
  is_complete     boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (age_min <= age_max)
);
CREATE INDEX profiles_home_city_idx ON profiles (home_city_id);
CREATE INDEX profiles_feed_idx ON profiles (home_city_id) WHERE is_complete AND ooo_since IS NULL;

CREATE TABLE photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key   text NOT NULL UNIQUE,
  position      smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  status        photo_status NOT NULL DEFAULT 'uploading',
  result_reason photo_result_reason,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  checked_at    timestamptz,
  CONSTRAINT photos_position_key UNIQUE (user_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX photos_pending_idx ON photos (uploaded_at) WHERE status = 'pending_approval';

-- ---------------------------------------------------------------------------------------------
-- Offsite (D150–D154, D167)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE offsites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  description   text NOT NULL CHECK (length(description) <= 4000),
  cover_key     text,
  venue_name    text NOT NULL CHECK (length(venue_name) <= 120),
  venue_address text NOT NULL CHECK (length(venue_address) <= 240),
  city_id       text NOT NULL REFERENCES cities (id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  capacity      integer CHECK (capacity > 0),
  status        offsite_status NOT NULL DEFAULT 'draft',
  is_demo       boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES operators (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX offsites_starts_idx ON offsites (status, starts_at);

CREATE TABLE offsite_attendees (
  offsite_id      uuid NOT NULL REFERENCES offsites (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  show_on_profile boolean NOT NULL DEFAULT false,
  PRIMARY KEY (offsite_id, user_id)
);
CREATE INDEX offsite_attendees_user_idx ON offsite_attendees (user_id);

-- ---------------------------------------------------------------------------------------------
-- Swipe, contatori, match, messaggi e inviti (D53, D54, D58, D59, D62, D63, D64, D183)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE swipes (
  from_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type         swipe_type NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days',
  offsite_id   uuid REFERENCES offsites (id) ON DELETE SET NULL,
  PRIMARY KEY (from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX swipes_received_idx ON swipes (to_user_id, type);

CREATE TABLE daily_counters (
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day                  date NOT NULL,
  likes_used           smallint NOT NULL DEFAULT 0,
  escalations_used     smallint NOT NULL DEFAULT 0,
  bonuses_received     smallint NOT NULL DEFAULT 0 CHECK (bonuses_received <= 3),
  last_swipe_target_id uuid,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id          uuid REFERENCES users (id) ON DELETE SET NULL,
  user_b_id          uuid REFERENCES users (id) ON DELETE SET NULL,
  status             match_status NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  chat_started_at    timestamptz,
  expiry_reminder_at timestamptz,
  closed_at          timestamptz,
  close_reason       match_close_reason,
  offsite_id         uuid REFERENCES offsites (id) ON DELETE SET NULL,
  CHECK (user_a_id < user_b_id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK ((status = 'closed') = (close_reason IS NOT NULL)),
  CHECK (status = 'closed' OR (user_a_id IS NOT NULL AND user_b_id IS NOT NULL))
);
CREATE UNIQUE INDEX matches_active_pair_key ON matches (user_a_id, user_b_id) WHERE status = 'active';
CREATE INDEX matches_user_b_idx ON matches (user_b_id) WHERE status = 'active';
CREATE INDEX matches_without_messages_idx
  ON matches (created_at) WHERE status = 'active' AND chat_started_at IS NULL;

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ciphertext        bytea NOT NULL,
  nonce             bytea NOT NULL,
  client_message_id uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,
  UNIQUE (match_id, sender_id, client_message_id)
);
CREATE INDEX messages_cursor_idx ON messages (match_id, created_at, id);

CREATE TABLE chat_keys (
  match_id      uuid PRIMARY KEY REFERENCES matches (id) ON DELETE CASCADE,
  encrypted_key bytea NOT NULL,
  key_version   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        invite_type NOT NULL,
  day         date NOT NULL,
  time_slot   time_slot NOT NULL,
  time        time,
  venue       bytea,
  venue_nonce bytea,
  city_id     text NOT NULL REFERENCES cities (id),
  status      invite_status NOT NULL DEFAULT 'pending',
  replaces_id uuid REFERENCES invites (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  reminder_at timestamptz,
  CHECK ((venue IS NULL) = (venue_nonce IS NULL))
);
-- Una sola proposta in sospeso per match (D147)
CREATE UNIQUE INDEX invites_pending_key ON invites (match_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------------------------
-- Approvazione dei profili (D141–D144, D165)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE profile_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users (id) ON DELETE CASCADE,
  attempt            smallint NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  due_at             timestamptz NOT NULL,
  team_alert_at      timestamptz,
  outcome            review_outcome NOT NULL DEFAULT 'pending',
  decided_by         uuid REFERENCES operators (id) ON DELETE SET NULL,
  decided_at         timestamptz,
  reason             text,
  explanation        text CHECK (length(explanation) <= 1000),
  appeal_deadline_at timestamptz,
  appeal_code_hash   text,
  UNIQUE (user_id, attempt),
  -- Nessuna decisione senza un operatore (D144) e nessun rifiuto senza motivazione (D142)
  CHECK (outcome = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (outcome <> 'rejected' OR (reason IS NOT NULL AND length(btrim(explanation)) > 0))
);
CREATE UNIQUE INDEX profile_reviews_pending_key ON profile_reviews (user_id) WHERE outcome = 'pending';
CREATE INDEX profile_reviews_queue_idx ON profile_reviews (outcome, submitted_at);

-- ---------------------------------------------------------------------------------------------
-- Sicurezza e moderazione (D70–D76, D108, D113)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE blocks (
  from_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  unblocked_at timestamptz,
  PRIMARY KEY (from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX blocks_reverse_idx ON blocks (to_user_id, from_user_id);

CREATE TABLE reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  reported_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  reason             report_reason NOT NULL,
  text               text CHECK (length(text) <= 1000),
  source             report_source NOT NULL,
  from_match         boolean NOT NULL DEFAULT false,
  severity           report_severity NOT NULL DEFAULT 'standard',
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  due_at             timestamptz NOT NULL,
  outcome            text,
  generic_outcome_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue_idx ON reports (status, due_at);

CREATE TABLE sanctions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  type               sanction_type NOT NULL,
  severe_case        severe_case,
  report_id          uuid REFERENCES reports (id) ON DELETE SET NULL,
  explanation        text NOT NULL,
  decided_by         uuid REFERENCES operators (id) ON DELETE SET NULL,
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  appeal_deadline_at timestamptz,
  appeal_code_hash   text,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sanctions_current_idx ON sanctions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE blocked_hashes (
  hash        text PRIMARY KEY,
  type        hash_type NOT NULL,
  source      blocked_hash_source NOT NULL,
  expires_at  timestamptz NOT NULL,
  sanction_id uuid REFERENCES sanctions (id) ON DELETE SET NULL,
  review_id   uuid REFERENCES profile_reviews (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------------------------
-- Accesso: codici OTP, nonce, sessioni, coda della revoca dei token dei fornitori
-- ---------------------------------------------------------------------------------------------
CREATE TABLE otp_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users (id) ON DELETE CASCADE,
  recipient_hash text NOT NULL,
  purpose        otp_purpose NOT NULL,
  code_hash      text NOT NULL,
  ip_hash        text,
  attempts       smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  cancelled_at   timestamptz
);
CREATE INDEX otp_codes_recipient_idx ON otp_codes (recipient_hash, purpose);
CREATE INDEX otp_codes_ip_idx ON otp_codes (ip_hash, created_at);

-- Nonce a uso singolo emessi da `POST /auth/nonce` (D236) [Proposta: tabella dedicata]
CREATE TABLE auth_nonces (
  nonce_hash  text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_hash      text NOT NULL UNIQUE,
  scope             session_scope NOT NULL,
  sign_in_method    sign_in_method NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Nessun `user_id` né email: solo il token cifrato da revocare (D224)
CREATE TABLE provider_token_revocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         identity_provider NOT NULL CHECK (provider <> 'email'),
  token_ciphertext text NOT NULL,
  key_version      text NOT NULL,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  attempts         smallint NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz
);

-- ---------------------------------------------------------------------------------------------
-- Lista d'attesa, audit, configurazione
-- ---------------------------------------------------------------------------------------------
CREATE TABLE waitlist_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain               text NOT NULL,
  suggested_name       text,
  contact_email        text NOT NULL,
  contact_confirmed_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  UNIQUE (domain, contact_email)
);

-- Registro a sola aggiunta, senza dati personali (D91, D99, D112)
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         audit_type NOT NULL,
  action       audit_action NOT NULL,
  operator_id  uuid REFERENCES operators (id) ON DELETE SET NULL,
  session_id   uuid,
  object_type  text,
  object_id    text,
  explanation  text CHECK (length(explanation) <= 500),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_performed_idx ON audit_log (performed_at);

CREATE TABLE config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES operators (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Valori di partenza confermati dalle decisioni (D39, D54, D141, D144, D186)
INSERT INTO config (key, value) VALUES
  ('open_space.max_changes', '5'),
  ('open_space.period_days', '30'),
  ('excluded_companies.max', '15'),
  ('excluded_companies.max_changes', '5'),
  ('excluded_companies.period_days', '30'),
  ('excluded_companies.min_days_before_removal', '7'),
  ('approval.due_hours', '24'),
  ('approval.team_alert_hours', '20'),
  ('swipes.daily_likes', '25'),
  ('swipes.daily_escalations', '1');
