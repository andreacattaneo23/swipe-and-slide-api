-- Ruoli del database separati, niente RLS nell'MVP (D231; architettura, "Ruoli del database").
-- I ruoli sono dell'intero server PostgreSQL: si creano solo se mancano, i permessi si danno in
-- ogni database. Sono senza accesso diretto (NOLOGIN): i servizi si collegano con il loro utente
-- e impostano il ruolo all'avvio della connessione (variabile `DATABASE_ROLE`). Le funzioni della
-- regola sono SECURITY DEFINER del proprietario dello schema, quindi i ruoli le usano senza
-- leggere le tabelle protette.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backoffice_role') THEN
    CREATE ROLE backoffice_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_role') THEN
    CREATE ROLE jobs_role NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_role, backoffice_role, jobs_role;

-- ---------------------------------------------------------------------------------------------
-- app_role (`app-api`): tabelle dell'app, senza scrivere l'Open space né modificare la data di
-- nascita (D112, D137): quelle passano da `set_open_space` e `correct_birth_date`
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT UPDATE ON
  companies, company_domains, cities, personal_identities, work_emails, company_changes,
  consents, excluded_companies, excluded_company_changes, photos, offsites, offsite_attendees,
  swipes, daily_counters, matches, messages, chat_keys, invites, profile_reviews, blocks,
  reports, otp_codes, auth_nonces, sessions, waitlist_requests
  TO app_role;
GRANT UPDATE (company_id, status, open_space_prompt_at, reverification_due_at,
              reverification_reason, ad_hoc_reverification_at, deletion_scheduled_at,
              deletion_requested_at, deletion_final_at, excluded_companies_notice_at,
              last_seen_on)
  ON users TO app_role;
GRANT UPDATE (first_name, last_name, gender, interested_in, looking_for, bio, practice_area,
              home_city_id, age_min, age_max, max_distance, show_calendar, read_receipts,
              ooo_since, ooo_reminder_at, is_complete, updated_at)
  ON profiles TO app_role;
-- Il backoffice e l'audit restano fuori dalla portata dell'API dell'app
REVOKE ALL ON operators, operator_sessions, config, sanctions, blocked_hashes FROM app_role;
GRANT SELECT ON config, blocked_hashes TO app_role;
GRANT SELECT (id, type, user_id, starts_at, ends_at, revoked_at) ON sanctions TO app_role;
REVOKE DELETE ON audit_log FROM app_role;
REVOKE SELECT ON audit_log FROM app_role;

-- ---------------------------------------------------------------------------------------------
-- backoffice_role (`admin-api`): solo ciò che serve al backoffice (D90). Nessun permesso su
-- messaggi, aziende escluse, blocchi, swipe, inviti, storico dell'Open space, iscrizioni agli
-- offsite (il numero viene da `rounded_attendee_count`), `profiles.interested_in`,
-- `profiles.birth_date` e sulle colonne dell'Open space di `users`
-- ---------------------------------------------------------------------------------------------
GRANT SELECT ON companies, company_domains, cities, operators, operator_sessions,
                profile_reviews, photos, offsites, config, audit_log, waitlist_requests
  TO backoffice_role;
GRANT INSERT, UPDATE ON companies, offsites, operator_sessions, profile_reviews TO backoffice_role;
GRANT INSERT, DELETE ON company_domains TO backoffice_role;
GRANT DELETE ON companies TO backoffice_role;
GRANT UPDATE (status, checked_at) ON photos TO backoffice_role;
GRANT INSERT ON audit_log, blocked_hashes TO backoffice_role;
GRANT SELECT, INSERT, UPDATE ON otp_codes TO backoffice_role;
GRANT SELECT (id, company_id, is_demo, status, deletion_scheduled_at, created_at) ON users
  TO backoffice_role;
GRANT UPDATE (status, deletion_scheduled_at) ON users TO backoffice_role;
GRANT SELECT (user_id, first_name, gender, looking_for, bio, practice_area, is_complete)
  ON profiles TO backoffice_role;
GRANT SELECT (user_id, company_id, domain, status) ON work_emails TO backoffice_role;

-- Coda delle approvazioni (D141, D90): età al posto della data di nascita, nome dell'azienda,
-- nessun "chi ti interessa", email, aziende escluse, blocchi né Open space
CREATE VIEW backoffice_approval_queue AS
  SELECT r.id AS review_id, r.user_id, r.attempt, r.submitted_at, r.due_at, r.outcome,
         p.first_name, age_years(p.birth_date) AS age_years, p.gender, p.practice_area,
         p.looking_for, p.bio, z.name AS company_name
    FROM profile_reviews r
    JOIN users x ON x.id = r.user_id
    JOIN profiles p ON p.user_id = r.user_id
    LEFT JOIN companies z ON z.id = x.company_id;
GRANT SELECT ON backoffice_approval_queue TO backoffice_role;

-- Numero di utenti per azienda solo per bloccare la cancellazione diretta (mai mostrato)
CREATE FUNCTION company_has_users(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE company_id = p_company_id)
      OR EXISTS (SELECT 1 FROM work_emails WHERE company_id = p_company_id);
$$;

-- ---------------------------------------------------------------------------------------------
-- jobs_role (processi pianificati)
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobs_role;
REVOKE UPDATE, DELETE ON audit_log FROM jobs_role;

-- ---------------------------------------------------------------------------------------------
-- Terzo rifiuto dell'approvazione (D142): impronte delle due email bloccate per 2 anni, con i
-- privilegi del proprietario (il backoffice non legge identità né email aziendali)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION block_third_rejection(p_review_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
  written integer;
BEGIN
  SELECT user_id INTO target FROM profile_reviews
   WHERE id = p_review_id AND outcome = 'rejected' AND attempt = 3;
  IF target IS NULL THEN RAISE EXCEPTION 'revisione non valida'; END IF;
  INSERT INTO blocked_hashes (hash, type, source, expires_at, review_id)
       SELECT email_hash, 'personal'::hash_type, 'third_rejection'::blocked_hash_source,
              now() + interval '2 years', p_review_id
         FROM personal_identities WHERE user_id = target AND revoked_at IS NULL
       UNION ALL
       SELECT email_hash, 'work'::hash_type, 'third_rejection'::blocked_hash_source,
              now() + interval '2 years', p_review_id
         FROM work_emails WHERE user_id = target AND status = 'active'
  ON CONFLICT (hash) DO UPDATE SET expires_at = EXCLUDED.expires_at, review_id = EXCLUDED.review_id;
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Data di nascita (D76, D112): l'API la scrive solo durante la registrazione, con questa
-- funzione; dopo la cambia solo il Supporto (`correct_birth_date`, da fare)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION set_registration_birth_date(p_user_id uuid, p_birth_date date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = p_user_id AND status = 'registering' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data di nascita: solo in registrazione' USING ERRCODE = 'SSC12'; END IF;
  IF age_years(p_birth_date) < 18 THEN
    RAISE EXCEPTION 'data di nascita: meno di 18 anni' USING ERRCODE = 'SSC12';
  END IF;
  INSERT INTO profiles (user_id, birth_date) VALUES (p_user_id, p_birth_date)
  ON CONFLICT (user_id) DO UPDATE SET birth_date = EXCLUDED.birth_date;
END $$;
