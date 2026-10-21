-- Profilo, impostazioni, privacy e account (team B1, D239): tassonomie a tema, interessi e
-- domande del profilo, trasferte, limiti di frequenza, esportazioni
-- dei dati e colonne nuove dell'account. Solo aggiunte: le tabelle esistenti cambiano con ALTER.
-- Errori dei trigger nella classe `SSP` (profilo e account), tradotti dall'API in risposte neutre:
--   SSP01 massimo degli interessi      SSP02 massimo delle domande a tema
--   SSP03 limiti delle trasferte

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------------------------
-- Colonne nuove dell'account e della sessione
-- ---------------------------------------------------------------------------------------------
-- Accesso con l'email aziendale attiva (D233): falso se la persona sceglie di non usarlo più
ALTER TABLE users ADD COLUMN work_email_sign_in boolean NOT NULL DEFAULT true;
-- Avviso dei 7 giorni prima della cancellazione di un account in sospeso già inviato (P6)
ALTER TABLE users ADD COLUMN deletion_notice_at timestamptz;
-- Conferma dell'identità con un codice all'email personale, legata alla sessione e a uno scopo
-- (cambio azienda, modo di accesso): vale pochi minuti [Proposta]
-- Avviso una volta sola dopo un cambio azienda (D176, D197): l'azienda lasciata è entrata nelle
-- aziende escluse, la nuova ne è uscita; la colonna `users.excluded_companies_notice_at` dice
-- se l'avviso è ancora da mostrare, queste due cosa dice
ALTER TABLE company_changes ADD COLUMN left_company_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE company_changes ADD COLUMN new_company_unexcluded boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN identity_confirmed_at timestamptz;
ALTER TABLE sessions ADD COLUMN identity_confirmed_for text
  CHECK (identity_confirmed_for IN ('company_change', 'access_change'));

-- ---------------------------------------------------------------------------------------------
-- Tassonomie a tema come dati (D45, D48, D56, D130): codice stabile, etichetta modificabile dal
-- backoffice, ordine e voce attiva. Le frasi di apertura della chat restano al modulo della chat.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE looking_for_intent AS ENUM ('long_term', 'dating', 'unsure');
CREATE TYPE interest_section AS ENUM ('classic', 'consultant');

CREATE TABLE looking_for_options (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label     text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  position  smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  intent    looking_for_intent NOT NULL
);

CREATE TABLE interests (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label     text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  position  smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  section   interest_section NOT NULL
);

CREATE TABLE practice_areas (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label     text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  position  smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE profile_questions (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label     text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  position  smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  text      text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 160)
);

-- Voci definitive dell'analisi funzionale, capitolo "Tassonomie e testi a tema" (D130)
INSERT INTO looking_for_options (code, label, position, intent) VALUES
  ('gantt', 'Un Gantt di pianificazione per una relazione seria', 1, 'long_term'),
  ('permanent_contract', 'Un contratto a tempo indeterminato', 2, 'long_term'),
  ('pptx', 'Un pptx insieme', 3, 'dating'),
  ('pilot_project', 'Un progetto pilota', 4, 'dating'),
  ('discovery', 'Una fase di discovery', 5, 'unsure'),
  ('coffee', 'Un caffè di allineamento, poi vediamo', 6, 'unsure');

INSERT INTO interests (code, label, position, section) VALUES
  ('travel', 'Viaggi', 1, 'classic'), ('mountains', 'Montagna', 2, 'classic'),
  ('sea', 'Mare', 3, 'classic'), ('trekking', 'Trekking', 4, 'classic'),
  ('running', 'Corsa', 5, 'classic'), ('cycling', 'Ciclismo', 6, 'classic'),
  ('swimming', 'Nuoto', 7, 'classic'), ('gym', 'Palestra', 8, 'classic'),
  ('yoga', 'Yoga', 9, 'classic'), ('skiing', 'Sci', 10, 'classic'),
  ('padel', 'Padel', 11, 'classic'), ('tennis', 'Tennis', 12, 'classic'),
  ('football', 'Calcio', 13, 'classic'), ('cooking', 'Cucina', 14, 'classic'),
  ('restaurants', 'Ristoranti', 15, 'classic'), ('cinema', 'Cinema', 16, 'classic'),
  ('tv_series', 'Serie TV', 17, 'classic'), ('theatre', 'Teatro', 18, 'classic'),
  ('concerts', 'Concerti', 19, 'classic'), ('reading', 'Lettura', 20, 'classic'),
  ('podcasts', 'Podcast', 21, 'classic'), ('photography', 'Fotografia', 22, 'classic'),
  ('art', 'Arte e mostre', 23, 'classic'), ('videogames', 'Videogiochi', 24, 'classic'),
  ('board_games', 'Giochi da tavolo', 25, 'classic'),
  ('pivot', 'Tabelle pivot', 26, 'consultant'),
  ('pixel_slides', 'Slide impaginate al pixel', 27, 'consultant'),
  ('matrices', 'Matrici 2x2', 28, 'consultant'), ('gantt', 'Gantt ben fatti', 29, 'consultant'),
  ('post_it', 'Post-it e lavagne', 30, 'consultant'),
  ('problem_solving', 'Problem solving', 31, 'consultant'),
  ('public_speaking', 'Public speaking', 32, 'consultant'),
  ('brainstorming', 'Brainstorming', 33, 'consultant'),
  ('networking', 'Networking', 34, 'consultant'),
  ('miles', 'Raccolta miglia', 35, 'consultant'),
  ('lounge', 'Lounge degli aeroporti', 36, 'consultant'),
  ('quick_packing', 'Valigia pronta in 10 minuti', 37, 'consultant'),
  ('trains', 'Treni ad alta velocità', 38, 'consultant'),
  ('hotel_breakfast', 'Colazioni in hotel', 39, 'consultant'),
  ('new_cities', 'Città nuove', 40, 'consultant'),
  ('remote_work', 'Smart working da ovunque', 41, 'consultant'),
  ('offline_weekends', 'Weekend offline', 42, 'consultant'),
  ('certifications', 'Certificazioni', 43, 'consultant'),
  ('business_podcasts', 'Podcast di business', 44, 'consultant'),
  ('startups', 'Innovazione e startup', 45, 'consultant');

INSERT INTO practice_areas (code, label, position) VALUES
  ('strategy', 'Strategia', 1),
  ('technology', 'Tecnologia e sistemi informativi', 2),
  ('organization_hr', 'Organizzazione e risorse umane', 3),
  ('data_ai', 'Dati e intelligenza artificiale', 4),
  ('finance', 'Finanza e controllo di gestione', 5),
  ('cybersecurity', 'Cybersecurity', 6),
  ('audit', 'Revisione contabile', 7),
  ('operations', 'Operations e supply chain', 8),
  ('tax_legal', 'Fiscale e legale', 9),
  ('marketing_sales', 'Marketing, vendite e customer experience', 10),
  ('risk_compliance', 'Rischi e compliance', 11),
  ('sustainability', 'Sostenibilità', 12);

INSERT INTO profile_questions (code, label, position, text) VALUES
  ('kpi', 'KPI del primo appuntamento', 1, 'Il mio KPI per un primo appuntamento è…'),
  ('superpower', 'Superpotere da consulente', 2, 'Il mio superpotere da consulente…'),
  ('scope', 'Scope del primo meeting', 3, 'Il mio scope ideale per il primo meeting…'),
  ('offline_weekend', 'Weekend offline', 4, 'Nel mio weekend offline…'),
  ('ideal_trip', 'Trasferta ideale', 5, 'La mia trasferta ideale…'),
  ('monday_ritual', 'Rituale del lunedì', 6, 'Il mio rituale del lunedì mattina…'),
  ('lesson_learned', 'Lesson learned', 7, 'Una lesson learned fuori dal lavoro…'),
  ('favourite_slide', 'La slide da rifare', 8, 'La slide che rifarei all''infinito…'),
  ('suitcase', 'In valigia', 9, 'Cosa non manca mai nella mia valigia…'),
  ('perfect_sunday', 'Domenica perfetta', 10, 'Il piano di progetto per una domenica perfetta…'),
  ('trip_vice', 'Vizio in trasferta', 11, 'Il mio piccolo vizio in trasferta…'),
  ('convince_me', 'Mi faccio convincere', 12, 'Mi faccio convincere con…'),
  ('quarter_goal', 'Obiettivo del trimestre', 13, 'Un obiettivo per il prossimo trimestre…');

-- I campi a scelta singola del profilo indicano un codice della loro tassonomia
ALTER TABLE profiles ADD CONSTRAINT profiles_looking_for_fkey
  FOREIGN KEY (looking_for) REFERENCES looking_for_options (code);
ALTER TABLE profiles ADD CONSTRAINT profiles_practice_area_fkey
  FOREIGN KEY (practice_area) REFERENCES practice_areas (code);

-- ---------------------------------------------------------------------------------------------
-- Interessi scelti (al massimo 5 in tutto) e risposte alle domande a tema (al massimo 3, fino a
-- 150 caratteri) (D48, D56): i massimi valgono anche con un errore nel servizio
-- ---------------------------------------------------------------------------------------------
CREATE TABLE user_interests (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  interest text NOT NULL REFERENCES interests (code),
  PRIMARY KEY (user_id, interest)
);

CREATE TABLE profile_answers (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question text NOT NULL REFERENCES profile_questions (code),
  answer   text NOT NULL CHECK (length(btrim(answer)) BETWEEN 1 AND 150),
  position smallint NOT NULL DEFAULT 1 CHECK (position BETWEEN 1 AND 3),
  PRIMARY KEY (user_id, question)
);

CREATE FUNCTION check_profile_lists_max() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF TG_TABLE_NAME = 'user_interests' THEN
    IF (SELECT count(*) FROM user_interests WHERE user_id = NEW.user_id) >= 5 THEN
      RAISE EXCEPTION 'interessi: massimo raggiunto' USING ERRCODE = 'SSP01';
    END IF;
  ELSIF (SELECT count(*) FROM profile_answers WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'domande a tema: massimo raggiunto' USING ERRCODE = 'SSP02';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_interests_max BEFORE INSERT ON user_interests
  FOR EACH ROW EXECUTE FUNCTION check_profile_lists_max();
CREATE TRIGGER profile_answers_max BEFORE INSERT ON profile_answers
  FOR EACH ROW EXECUTE FUNCTION check_profile_lists_max();

-- ---------------------------------------------------------------------------------------------
-- Trasferte (D50, D57, D109): al massimo 8 settimane, nessuna sovrapposizione; gli altri limiti
-- (5 pianificate, inizio entro 3 mesi, città diversa dalla base) li controlla il servizio
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  city_id    text NOT NULL REFERENCES cities (id),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date AND end_date - start_date <= 55)
);
-- Unica definizione: il feed e gli inviti (0200) la leggono soltanto
CREATE INDEX IF NOT EXISTS trips_user_idx ON trips (user_id, start_date);
CREATE INDEX IF NOT EXISTS trips_city_idx ON trips (city_id, start_date, end_date);
-- Trasferte dello stesso utente che non si sovrappongono (architettura, [Proposta])
ALTER TABLE trips ADD CONSTRAINT trips_no_overlap EXCLUDE USING gist
  (user_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

-- Al massimo 5 trasferte pianificate (in corso o future), anche con richieste in parallelo
CREATE FUNCTION check_trips_max() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF (SELECT count(*) FROM trips
       WHERE user_id = NEW.user_id AND end_date >= (now() AT TIME ZONE 'Europe/Rome')::date
         AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'trasferte: massimo raggiunto' USING ERRCODE = 'SSP03';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trips_max BEFORE INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION check_trips_max();

-- Eventi per i limiti di frequenza dei cambi della città base e della creazione delle trasferte:
-- nessuna città né data, così una trasferta cancellata non lascia traccia (architettura)
CREATE TYPE rate_limit_event_type AS ENUM ('home_city', 'trip');

CREATE TABLE rate_limit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        rate_limit_event_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_events_user_idx ON rate_limit_events (user_id, type, occurred_at);

-- ---------------------------------------------------------------------------------------------
-- "Scarica i miei dati" (D83): una richiesta in corso e una ogni 7 giorni, file per 7 giorni
-- ---------------------------------------------------------------------------------------------
CREATE TYPE data_export_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE data_exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       data_export_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  ready_at     timestamptz,
  expires_at   timestamptz,
  storage_key  text UNIQUE,
  attempts     smallint NOT NULL DEFAULT 0,
  CHECK ((status = 'ready') = (ready_at IS NOT NULL AND expires_at IS NOT NULL
                               AND storage_key IS NOT NULL))
);
CREATE UNIQUE INDEX data_exports_pending_key ON data_exports (user_id) WHERE status = 'pending';
CREATE INDEX data_exports_user_idx ON data_exports (user_id, requested_at);

-- ---------------------------------------------------------------------------------------------
-- Parametri in `config` (valori di partenza; i limiti di frequenza della città base e delle
-- trasferte sono [Proposta] fino al deploy)
-- ---------------------------------------------------------------------------------------------
INSERT INTO config (key, value) VALUES
  ('trips.max_planned', '5'),
  ('trips.horizon_days', '92'),
  ('trips.visibility_days_before', '14'),
  ('rate_limits.home_city.max', '3'),
  ('rate_limits.home_city.period_days', '30'),
  ('rate_limits.trip.max', '10'),
  ('rate_limits.trip.period_days', '30'),
  ('company_change.min_days', '30'),
  ('reverification.days', '90'),
  ('reverification.grace_days', '7'),
  ('suspension.deletion_days', '30'),
  ('deletion.grace_days', '7'),
  ('data_exports.min_days', '7'),
  ('data_exports.retention_days', '7'),
  ('ooo.reminder_days', '30')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Permessi dei ruoli sulle tabelle nuove (D231)
-- ---------------------------------------------------------------------------------------------
GRANT SELECT ON looking_for_options, interests, practice_areas, profile_questions
  TO app_role, backoffice_role, jobs_role;
-- Il backoffice corregge etichette, ordine e voci attive (D89), mai i codici
GRANT INSERT ON looking_for_options, interests, practice_areas, profile_questions TO backoffice_role;
GRANT UPDATE (label, position, is_active) ON looking_for_options, interests, practice_areas,
  profile_questions TO backoffice_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_interests, profile_answers, trips, rate_limit_events,
  data_exports TO app_role, jobs_role;
GRANT UPDATE (work_email_sign_in, deletion_notice_at) ON users TO app_role;
