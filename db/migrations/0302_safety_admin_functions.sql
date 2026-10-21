-- Team B3 (D239): funzioni con i privilegi del proprietario per le operazioni del backoffice e
-- della moderazione che toccano tabelle protette (architettura, "Limiti come vincolo tecnico").
-- Restituiscono solo conteggi o esiti, mai il contenuto delle tabelle protette; l'unica
-- eccezione è `read_chat` (D181, D187), che scrive l'audit nella stessa transazione.
-- SQLSTATE nuovi della classe `SS`:
--   SSC13 oggetto del backoffice non valido (dominio, azienda, stato non ammesso)
--   SSC14 operazione tra aziende di tipo diverso o non attive
--   SSC15 lettura della chat senza motivo o periodo validi

-- Intero dalla configurazione, con il valore di riserva
CREATE FUNCTION safety_config_int(p_key text, p_default int) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::int FROM config WHERE key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------------------------
-- Email mascherate (D90): prima lettera, dominio abbreviato, estensione
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION mask_email(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' IN p_email) = 0 THEN NULL
    ELSE left(split_part(p_email, '@', 1), 1) || '***@'
         || left(split_part(p_email, '@', 2), 1) || '***'
         || COALESCE('.' || NULLIF(substring(split_part(p_email, '@', 2) FROM '\.([^.]+)$'), ''), '')
  END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cancellazione dell'account: i dati del caso restano senza legame (D98, D112, D142). La riga
-- del terzo rifiuto sopravvive finché il ricorso è possibile; segnalazioni e sanzioni hanno già
-- le chiavi esterne che si azzerano.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION preserve_moderation_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profile_reviews SET user_id = NULL
   WHERE user_id = OLD.id AND outcome = 'rejected' AND attempt = 3
     AND appeal_deadline_at > now();
  RETURN OLD;
END $$;

CREATE TRIGGER preserve_moderation_records BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION preserve_moderation_records();

-- ---------------------------------------------------------------------------------------------
-- Sessioni `limited` subito, per sospensioni, espulsioni e aziende in rimozione (D75, D111)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION limit_user_sessions(p_user_id uuid) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed int;
BEGIN
  UPDATE sessions SET scope = 'limited'
   WHERE user_id = p_user_id AND revoked_at IS NULL AND scope IN ('full', 'approval');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Ri-verifica neutra (D72, P14, forzata dal Supporto): uguale alla periodica, 7 giorni (P5).
-- Solo per account attivi: una ri-verifica già in corso o un altro stato non cambiano.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION start_reverification(p_user_id uuid, p_reason reverification_reason)
  RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed int;
BEGIN
  UPDATE users
     SET status = 'reverifying', reverification_reason = p_reason,
         reverification_due_at = now() + interval '7 days',
         ad_hoc_reverification_at = CASE WHEN p_reason = 'ad_hoc' THEN now()
                                         ELSE ad_hoc_reverification_at END
   WHERE id = p_user_id AND status = 'active';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Sospensione cautelativa per "possibile minorenne" (D76 rivista da D113): dalla transazione
-- della segnalazione o dal Moderatore che avvia la verifica. Una sola in corso e al massimo una
-- ogni 30 giorni senza nuovi elementi. Apre anche la richiesta della verifica dell'età.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION start_precautionary_suspension(p_user_id uuid, p_report_id uuid,
                                               p_operator_id uuid DEFAULT NULL)
  RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  created uuid;
BEGIN
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO age_verifications (user_id, report_id, requested_by)
       VALUES (p_user_id, p_report_id, p_operator_id)
  ON CONFLICT (user_id) DO NOTHING;
  IF EXISTS (SELECT 1 FROM sanctions
              WHERE user_id = p_user_id AND type = 'precautionary_suspension'
                AND (revoked_at IS NULL OR starts_at > now() - interval '30 days')) THEN
    RETURN NULL;
  END IF;
  INSERT INTO sanctions (user_id, type, report_id, explanation, decided_by, appeal_deadline_at)
       VALUES (p_user_id, 'precautionary_suspension', p_report_id, 'possible_minor', p_operator_id,
               now() + make_interval(months => safety_config_int('sanctions.appeal_months', 6)))
    RETURNING id INTO created;
  PERFORM limit_user_sessions(p_user_id);
  RETURN created;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Espulsione (D75): impronte delle due email per 2 anni, legate alla sanzione per toglierle se
-- il ricorso è accolto anche dopo la cancellazione
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION block_expelled_emails(p_sanction_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
  written integer;
  years int := safety_config_int('blocked_hashes.years', 2);
BEGIN
  SELECT user_id INTO target FROM sanctions
   WHERE id = p_sanction_id AND type = 'expulsion' AND revoked_at IS NULL;
  IF target IS NULL THEN RAISE EXCEPTION 'sanzione non valida' USING ERRCODE = 'SSC13'; END IF;
  INSERT INTO blocked_hashes (hash, type, source, expires_at, sanction_id)
       SELECT email_hash, 'personal'::hash_type, 'expulsion'::blocked_hash_source,
              now() + make_interval(years => years), p_sanction_id
         FROM personal_identities WHERE user_id = target AND revoked_at IS NULL
       UNION ALL
       SELECT email_hash, 'work'::hash_type, 'expulsion'::blocked_hash_source,
              now() + make_interval(years => years), p_sanction_id
         FROM work_emails WHERE user_id = target AND status = 'active'
  ON CONFLICT (hash) DO UPDATE
     SET expires_at = EXCLUDED.expires_at, source = EXCLUDED.source,
         sanction_id = EXCLUDED.sanction_id, review_id = NULL;
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Correzione della data di nascita dal Supporto (D112): almeno 18 anni, restituisce l'età
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION correct_birth_date(p_user_id uuid, p_birth_date date) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed int;
BEGIN
  IF p_birth_date IS NULL OR age_years(p_birth_date) < 18 OR p_birth_date < date '1900-01-01' THEN
    RAISE EXCEPTION 'data di nascita: meno di 18 anni' USING ERRCODE = 'SSC12';
  END IF;
  UPDATE profiles SET birth_date = p_birth_date WHERE user_id = p_user_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed = 0 THEN RAISE EXCEPTION 'profilo inesistente' USING ERRCODE = 'SSC13'; END IF;
  RETURN age_years(p_birth_date);
END $$;

-- ---------------------------------------------------------------------------------------------
-- Rivelazione di un'email (D90): l'API scrive prima la riga `email_revealed` nella stessa
-- transazione, poi chiama la funzione
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION reveal_email(p_user_id uuid, p_kind text) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_kind
    WHEN 'personal' THEN (SELECT email FROM personal_identities
                           WHERE user_id = p_user_id AND revoked_at IS NULL)
    WHEN 'work' THEN (SELECT email FROM work_emails
                       WHERE user_id = p_user_id AND status = 'active')
  END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Moderazione: chiusura del match e rimozione di un testo del profilo (decisioni di un caso)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION moderation_close_match(p_report_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  changed int;
BEGIN
  SELECT reporter_id, reported_id, match_id INTO r FROM reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'segnalazione inesistente' USING ERRCODE = 'SSC13'; END IF;
  UPDATE matches SET status = 'closed', close_reason = 'moderation', closed_at = now()
   WHERE status = 'active'
     AND (id = r.match_id
          OR (r.reporter_id IS NOT NULL AND r.reported_id IS NOT NULL
              AND user_a_id = LEAST(r.reporter_id, r.reported_id)
              AND user_b_id = GREATEST(r.reporter_id, r.reported_id)));
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END $$;

CREATE FUNCTION moderation_remove_profile_text(p_user_id uuid, p_field text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed int;
BEGIN
  IF p_field = 'bio' THEN
    UPDATE profiles SET bio = NULL WHERE user_id = p_user_id AND bio IS NOT NULL;
  ELSIF p_field = 'looking_for' THEN
    UPDATE profiles SET looking_for = NULL WHERE user_id = p_user_id AND looking_for IS NOT NULL;
  ELSIF p_field = 'last_name' THEN
    UPDATE profiles SET last_name = NULL WHERE user_id = p_user_id AND last_name IS NOT NULL;
  ELSIF p_field = 'first_name' THEN
    UPDATE profiles SET first_name = NULL WHERE user_id = p_user_id AND first_name IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'campo non ammesso' USING ERRCODE = 'SSC13';
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Lettura motivata di una chat (D181, D187): solo un match e un periodo, con motivo e
-- riferimento; scrive `chat_read` nell'audit nella stessa transazione, senza testi (D112).
-- Restituisce solo testi cifrati: decifra l'API di amministrazione con la chiave del match.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION read_chat(p_match_id uuid, p_reason chat_read_reason, p_reference text,
                          p_from timestamptz, p_to timestamptz, p_operator_id uuid,
                          p_session_id uuid, p_explanation text)
  RETURNS TABLE (id uuid, sender_id uuid, created_at timestamptz, ciphertext bytea, nonce bytea)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_reason IS NULL OR p_reference IS NULL OR length(btrim(p_reference)) < 3
     OR p_explanation IS NULL OR length(btrim(p_explanation)) < 3
     OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days'
     OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'lettura della chat: motivo o periodo non validi' USING ERRCODE = 'SSC15';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM operators o
                  WHERE o.id = p_operator_id AND o.status = 'active' AND 'admin' = ANY (o.roles)) THEN
    RAISE EXCEPTION 'lettura della chat: solo l''Amministratore' USING ERRCODE = 'SSC15';
  END IF;
  INSERT INTO audit_log (type, action, operator_id, session_id, object_type, object_id,
                         explanation, details)
       VALUES ('action', 'chat_read', p_operator_id, p_session_id, 'match', p_match_id::text,
               p_explanation,
               jsonb_build_object('reason', p_reason, 'reference', p_reference,
                                  'from', p_from, 'to', p_to));
  RETURN QUERY
    SELECT m.id, m.sender_id, m.created_at, m.ciphertext, m.nonce
      FROM messages m
     WHERE m.match_id = p_match_id AND m.created_at >= p_from AND m.created_at < p_to
     ORDER BY m.created_at, m.id;
END $$;

-- Chiave del match cifrata dall'adattatore KMS: serve a `read_chat` e alla copia dei messaggi
CREATE FUNCTION chat_key_of(p_match_id uuid)
  RETURNS TABLE (encrypted_key bytea, key_version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.encrypted_key, k.key_version FROM chat_keys k WHERE k.match_id = p_match_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Elenco delle aziende (P14, D59, D94, D111, D175, D185, D186)
-- ---------------------------------------------------------------------------------------------

-- Spegnimento dell'Open space per chi cambia azienda per un'operazione dell'elenco, con la
-- domanda nell'app; senza il riallineamento, che il chiamante fa una volta per tutti
CREATE FUNCTION switch_off_open_space_for_company_change(p_user_ids uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO open_space_history (user_id, enabled, changed_at, source)
       SELECT id, false, now(), 'company_change' FROM users
        WHERE id = ANY (p_user_ids) AND open_space;
  UPDATE users SET open_space = false, open_space_since = NULL, open_space_prompt_at = now()
   WHERE id = ANY (p_user_ids) AND open_space;
END $$;

-- Aziende escluse uguali alla nuova azienda attuale: si tolgono, anche in attesa, con l'avviso
CREATE FUNCTION drop_current_company_exclusions(p_user_ids uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH removed AS (
    DELETE FROM excluded_companies e USING users x
     WHERE x.id = e.user_id AND e.user_id = ANY (p_user_ids) AND e.company_id = x.company_id
    RETURNING e.user_id),
  cancelled AS (
    UPDATE excluded_company_changes c SET status = 'cancelled', closed_at = now()
      FROM users x
     WHERE x.id = c.user_id AND c.user_id = ANY (p_user_ids) AND c.company_id = x.company_id
       AND c.status = 'pending'
    RETURNING c.user_id)
  UPDATE users SET excluded_companies_notice_at = now()
   WHERE id IN (SELECT user_id FROM removed UNION SELECT user_id FROM cancelled);
END $$;

-- Spostamento di un dominio verso un'altra azienda: un'unica transazione come un cambio
-- azienda, senza il ritardo di D36; non conta per D20 e non fa ripartire i 90 giorni
CREATE FUNCTION move_domain(p_domain text, p_target uuid)
  RETURNS TABLE (users_moved int, matches_revoked int, likes_deleted int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  from_company uuid;
  moved uuid[];
  result record;
BEGIN
  SELECT company_id INTO from_company FROM company_domains WHERE domain = p_domain FOR UPDATE;
  IF from_company IS NULL OR from_company = p_target THEN
    RAISE EXCEPTION 'dominio non valido' USING ERRCODE = 'SSC13';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies t, companies s
                  WHERE t.id = p_target AND s.id = from_company AND t.status = 'active'
                    AND t.is_demo = s.is_demo) THEN
    RAISE EXCEPTION 'azienda di destinazione non ammessa' USING ERRCODE = 'SSC14';
  END IF;
  PERFORM 1 FROM users x
   WHERE x.id IN (SELECT user_id FROM work_emails WHERE domain = p_domain)
   ORDER BY x.id FOR UPDATE;
  SELECT COALESCE(array_agg(w.user_id ORDER BY w.user_id), '{}') INTO moved
    FROM work_emails w JOIN users x ON x.id = w.user_id
   WHERE w.domain = p_domain AND w.status = 'active' AND x.company_id = from_company;
  UPDATE company_domains SET company_id = p_target WHERE domain = p_domain;
  UPDATE work_emails SET company_id = p_target WHERE domain = p_domain;   -- lo storico segue (D94)
  UPDATE users SET company_id = p_target WHERE id = ANY (moved);
  INSERT INTO company_changes (user_id, from_company_id, to_company_id, source)
       SELECT u, from_company, p_target, 'domain_moved' FROM unnest(moved) u;
  PERFORM drop_current_company_exclusions(moved);
  PERFORM switch_off_open_space_for_company_change(moved);
  SELECT * INTO result FROM realign_users(moved);
  UPDATE company_changes SET matches_revoked = result.matches_revoked
   WHERE user_id = ANY (moved) AND changed_at = now() AND source = 'domain_moved';
  RETURN QUERY SELECT cardinality(moved), result.matches_revoked, result.likes_deleted;
END $$;

-- Fusione dell'azienda assorbita in quella che resta (P14, D94, D175)
CREATE FUNCTION merge_companies(p_absorbed uuid, p_target uuid)
  RETURNS TABLE (users_moved int, matches_revoked int, likes_deleted int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  moved uuid[];
  result record;
BEGIN
  IF p_absorbed = p_target THEN RAISE EXCEPTION 'fusione non valida' USING ERRCODE = 'SSC13'; END IF;
  PERFORM 1 FROM companies WHERE id IN (p_absorbed, p_target) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM companies a, companies t
       WHERE a.id = p_absorbed AND t.id = p_target AND a.status = 'active'
         AND t.status = 'active' AND a.is_demo = t.is_demo) <> 1 THEN
    RAISE EXCEPTION 'aziende non ammesse alla fusione' USING ERRCODE = 'SSC14';
  END IF;
  PERFORM 1 FROM users x
   WHERE x.id IN (SELECT user_id FROM work_emails WHERE company_id = p_absorbed
                  UNION SELECT id FROM users WHERE company_id = p_absorbed
                  UNION SELECT user_id FROM excluded_companies WHERE company_id = p_absorbed
                  UNION SELECT user_id FROM excluded_company_changes
                         WHERE company_id = p_absorbed AND status = 'pending')
   ORDER BY x.id FOR UPDATE;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO moved
    FROM users WHERE company_id = p_absorbed;
  UPDATE company_domains SET company_id = p_target WHERE company_id = p_absorbed;
  UPDATE work_emails SET company_id = p_target WHERE company_id = p_absorbed;
  UPDATE users SET company_id = p_target WHERE id = ANY (moved);
  INSERT INTO company_changes (user_id, from_company_id, to_company_id, source)
       SELECT u, p_absorbed, p_target, 'merge' FROM unnest(moved) u;
  -- Le esclusioni seguono l'azienda che resta; i doppioni si fondono (D175, D186)
  CREATE TEMP TABLE merged_exclusions ON COMMIT DROP AS
    SELECT user_id, effective_at, source FROM excluded_companies WHERE company_id = p_absorbed;
  DELETE FROM excluded_companies WHERE company_id = p_absorbed;
  INSERT INTO excluded_companies (user_id, company_id, effective_at, source)
       SELECT e.user_id, p_target, e.effective_at, 'company_change'
         FROM merged_exclusions e JOIN users x ON x.id = e.user_id
        WHERE x.company_id IS DISTINCT FROM p_target
  ON CONFLICT (user_id, company_id) DO NOTHING;
  UPDATE users SET excluded_companies_notice_at = now()
   WHERE id IN (SELECT user_id FROM merged_exclusions) AND company_id = p_target;
  DROP TABLE merged_exclusions;
  UPDATE excluded_company_changes c SET status = 'cancelled', closed_at = now()
   WHERE c.company_id = p_absorbed AND c.status = 'pending'
     AND EXISTS (SELECT 1 FROM excluded_company_changes d
                  WHERE d.user_id = c.user_id AND d.company_id = p_target AND d.status = 'pending');
  UPDATE excluded_company_changes SET company_id = p_target
   WHERE company_id = p_absorbed AND status = 'pending';
  PERFORM drop_current_company_exclusions(
    ARRAY(SELECT user_id FROM excluded_company_changes
           WHERE company_id = p_target AND status = 'pending') || moved);
  UPDATE companies SET status = 'merged', merged_into_company_id = p_target
   WHERE id = p_absorbed;
  PERFORM switch_off_open_space_for_company_change(moved);
  SELECT * INTO result FROM realign_users(moved);
  RETURN QUERY SELECT cardinality(moved), result.matches_revoked, result.likes_deleted;
END $$;

-- Rimozione di un dominio (P14): gli utenti con l'email attiva su quel dominio vanno in
-- ri-verifica e restano nella stessa azienda; nessuna revoca
CREATE FUNCTION remove_domain(p_domain text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected int;
BEGIN
  DELETE FROM company_domains WHERE domain = p_domain;
  IF NOT FOUND THEN RAISE EXCEPTION 'dominio inesistente' USING ERRCODE = 'SSC13'; END IF;
  SELECT count(*) INTO affected FROM (
    SELECT start_reverification(w.user_id, 'domain_removed') AS changed
      FROM work_emails w WHERE w.domain = p_domain AND w.status = 'active'
     ORDER BY w.user_id) s
   WHERE s.changed;
  RETURN affected;
END $$;

-- Numero degli account coinvolti dalla rimozione (anteprima, D111): in qualsiasi stato
CREATE FUNCTION company_accounts_count(p_company_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM users WHERE company_id = p_company_id;
$$;

-- Utenti di un'azienda in forma aggregata (D89, D197): niente sotto la soglia
CREATE FUNCTION company_users_aggregate(p_company_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN n < safety_config_int('stats.min_count', 10) THEN NULL ELSE n END
    FROM (SELECT count(*)::int AS n FROM users
           WHERE company_id = p_company_id AND status IN ('active', 'reverifying')) c;
$$;

-- Avvio della rimozione (D85, D111, D120): utenti invisibili subito, sessioni `limited`,
-- preavviso neutro all'email personale tramite `user_notices`
CREATE FUNCTION start_company_removal(p_company_id uuid, p_hours int) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected int;
  final_at timestamptz := now() + make_interval(hours => p_hours);
BEGIN
  UPDATE companies SET status = 'removing', removal_started_at = now(), removal_final_at = final_at
   WHERE id = p_company_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'azienda non attiva' USING ERRCODE = 'SSC13'; END IF;
  PERFORM 1 FROM users WHERE company_id = p_company_id ORDER BY id FOR UPDATE;
  PERFORM limit_user_sessions(id) FROM users WHERE company_id = p_company_id;
  INSERT INTO user_notices (user_id, template, params)
       SELECT id, 'company_removal.started', jsonb_build_object('finalAt', final_at)
         FROM users WHERE company_id = p_company_id AND status <> 'registering';
  SELECT count(*) INTO affected FROM users WHERE company_id = p_company_id;
  RETURN affected;
END $$;

-- Annullamento durante l'intervallo (D120): tutto torna com'era, secondo avviso neutro
CREATE FUNCTION cancel_company_removal(p_company_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected int;
BEGIN
  UPDATE companies SET status = 'active', removal_started_at = NULL, removal_final_at = NULL
   WHERE id = p_company_id AND status = 'removing' AND removal_final_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'rimozione non annullabile' USING ERRCODE = 'SSC13'; END IF;
  DELETE FROM user_notices n USING users x
   WHERE x.id = n.user_id AND x.company_id = p_company_id
     AND n.template = 'company_removal.started';
  INSERT INTO user_notices (user_id, template)
       SELECT id, 'company_removal.cancelled' FROM users
        WHERE company_id = p_company_id AND status <> 'registering';
  SELECT count(*) INTO affected FROM users WHERE company_id = p_company_id;
  RETURN affected;
END $$;

-- Ultimo passo della rimozione (D185), dopo la cancellazione degli account a lotti: domini,
-- riferimenti negli altri dati e riga dell'azienda. Nessun riferimento anonimo.
CREATE FUNCTION finish_company_removal(p_company_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM companies WHERE id = p_company_id AND status = 'removing'
     AND removal_final_at <= now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE company_id = p_company_id) THEN RETURN false; END IF;
  UPDATE work_emails SET company_id = NULL, domain = NULL
   WHERE company_id = p_company_id AND status = 'historical';
  UPDATE company_changes SET from_company_id = NULL WHERE from_company_id = p_company_id;
  UPDATE company_changes SET to_company_id = NULL WHERE to_company_id = p_company_id;
  DELETE FROM companies WHERE id = p_company_id;   -- domini, esclusioni e avvisi in cascata
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Statistiche aggregate con soglia (D89, D197): mai sotto 10, mai per azienda per l'Open space
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION stats_threshold(p_value bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_value < safety_config_int('stats.min_count', 10) THEN NULL ELSE p_value END;
$$;

CREATE FUNCTION backoffice_stats() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'usersActive', stats_threshold((SELECT count(*) FROM users
                               WHERE NOT is_demo AND status IN ('active', 'reverifying'))),
    'usersPendingApproval', stats_threshold((SELECT count(*) FROM users
                                        WHERE NOT is_demo AND status = 'pending_approval')),
    'usersRegistering', stats_threshold((SELECT count(*) FROM users
                                    WHERE NOT is_demo AND status = 'registering')),
    'usersSuspended', stats_threshold((SELECT count(*) FROM users
                                  WHERE NOT is_demo AND status = 'suspended')),
    'openSpaceEnabled', stats_threshold((SELECT count(*) FROM users
                                    WHERE NOT is_demo AND open_space
                                      AND status IN ('active', 'reverifying'))),
    'companiesActive', (SELECT count(*) FROM companies WHERE status = 'active' AND NOT is_demo),
    'matchesActive', stats_threshold((SELECT count(*) FROM matches m JOIN users a ON a.id = m.user_a_id
                                 WHERE m.status = 'active' AND NOT a.is_demo)),
    'reportsOpen', (SELECT count(*) FROM reports WHERE status = 'open' AND NOT is_demo),
    'approvalsPending', (SELECT count(*) FROM profile_reviews WHERE outcome = 'pending'),
    'appealsPending', (SELECT count(*) FROM appeals WHERE outcome = 'pending'),
    'minCount', safety_config_int('stats.min_count', 10));
$$;

-- ---------------------------------------------------------------------------------------------
-- Pulizia dell'audit a 12 mesi (D99), con i privilegi del proprietario
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION purge_audit_log() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed int;
BEGIN
  DELETE FROM audit_log WHERE performed_at < now() - interval '12 months';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Azzeramento dei dati dimostrativi dopo una revisione (D42): solo righe di account
-- dimostrativi; se ne toccasse una reale la transazione si annulla
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION reset_demo_data() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  demo uuid[];
  touched int := 0;
  n int;
BEGIN
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO demo FROM users WHERE is_demo;
  IF EXISTS (SELECT 1 FROM swipes s JOIN users a ON a.id = s.from_user_id
                                    JOIN users b ON b.id = s.to_user_id
              WHERE a.is_demo <> b.is_demo)
  OR EXISTS (SELECT 1 FROM matches m JOIN users a ON a.id = m.user_a_id
                                     JOIN users b ON b.id = m.user_b_id
              WHERE a.is_demo <> b.is_demo)
  OR EXISTS (SELECT 1 FROM blocks k JOIN users a ON a.id = k.from_user_id
                                    JOIN users b ON b.id = k.to_user_id
              WHERE a.is_demo <> b.is_demo) THEN
    RAISE EXCEPTION 'dati dimostrativi mescolati a dati reali' USING ERRCODE = 'SSC04';
  END IF;
  DELETE FROM swipes WHERE from_user_id = ANY (demo);
  GET DIAGNOSTICS n = ROW_COUNT; touched := touched + n;
  DELETE FROM matches WHERE user_a_id = ANY (demo) OR user_b_id = ANY (demo);
  GET DIAGNOSTICS n = ROW_COUNT; touched := touched + n;
  DELETE FROM blocks WHERE from_user_id = ANY (demo);
  GET DIAGNOSTICS n = ROW_COUNT; touched := touched + n;
  DELETE FROM reports WHERE is_demo;
  GET DIAGNOSTICS n = ROW_COUNT; touched := touched + n;
  DELETE FROM sanctions WHERE user_id = ANY (demo);
  GET DIAGNOSTICS n = ROW_COUNT; touched := touched + n;
  DELETE FROM excluded_company_changes WHERE user_id = ANY (demo);
  DELETE FROM open_space_history WHERE user_id = ANY (demo) AND source <> 'registration';
  UPDATE users SET open_space = false, open_space_since = NULL, open_space_prompt_at = NULL
   WHERE id = ANY (demo) AND open_space;
  UPDATE sessions SET revoked_at = now() WHERE user_id = ANY (demo) AND revoked_at IS NULL;
  RETURN touched;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Controllo di coerenza della regola core (`check-core-rule`, RC-125): corregge dove possibile e
-- restituisce solo conteggi
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_core_rule_consistency() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  conflict_matches int;
  conflict_likes int;
  mixed int;
  blocked_matches int;
  incoherent int;
  self_excluded int;
  without_consent int;
  without_review int;
BEGIN
  WITH closed AS (
    UPDATE matches SET status = 'closed', close_reason = 'colleagues', closed_at = now()
     WHERE status = 'active' AND chat_started_at IS NULL
       AND company_conflict(user_a_id, user_b_id)
    RETURNING 1)
  SELECT count(*) INTO conflict_matches FROM closed;
  WITH deleted AS (
    DELETE FROM swipes WHERE type IN ('like', 'escalation')
       AND company_conflict(from_user_id, to_user_id)
    RETURNING 1)
  SELECT count(*) INTO conflict_likes FROM deleted;
  SELECT (SELECT count(*) FROM swipes s JOIN users a ON a.id = s.from_user_id
                                        JOIN users b ON b.id = s.to_user_id
           WHERE a.is_demo <> b.is_demo)
       + (SELECT count(*) FROM matches m JOIN users a ON a.id = m.user_a_id
                                         JOIN users b ON b.id = m.user_b_id
           WHERE a.is_demo <> b.is_demo)
    INTO mixed;
  WITH closed AS (
    UPDATE matches SET status = 'closed', close_reason = 'blocked', closed_at = now()
     WHERE status = 'active' AND block_exists(user_a_id, user_b_id)
    RETURNING 1)
  SELECT count(*) INTO blocked_matches FROM closed;
  SELECT count(*) INTO incoherent FROM users x
    LEFT JOIN work_emails w ON w.user_id = x.id AND w.status = 'active'
    LEFT JOIN companies z ON z.id = x.company_id
   WHERE (w.id IS NOT NULL AND w.company_id IS DISTINCT FROM x.company_id)
      OR (z.id IS NOT NULL AND z.is_demo <> x.is_demo);
  SELECT count(*) INTO self_excluded FROM excluded_companies e JOIN users x ON x.id = e.user_id
   WHERE e.company_id = x.company_id;
  SELECT count(*) INTO without_consent FROM users x
   WHERE account_visible(x.id) AND NOT x.is_demo
     AND NOT EXISTS (SELECT 1 FROM consents c WHERE c.user_id = x.id AND c.type = 'art9'
                                                AND c.revoked_at IS NULL);
  SELECT count(*) INTO without_review FROM users x
   WHERE x.status IN ('active', 'reverifying') AND NOT x.is_demo
     AND NOT EXISTS (SELECT 1 FROM profile_reviews r
                      WHERE r.user_id = x.id AND r.outcome = 'approved');
  RETURN jsonb_build_object(
    'conflictMatchesClosed', conflict_matches, 'conflictLikesDeleted', conflict_likes,
    'realDemoInteractions', mixed, 'blockedMatchesClosed', blocked_matches,
    'incoherentCompanies', incoherent, 'currentCompanyExcluded', self_excluded,
    'visibleWithoutConsent', without_consent, 'activeWithoutReview', without_review);
END $$;
