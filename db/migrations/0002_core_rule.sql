-- Regola core "colleghi, solo se vuoi": un'unica definizione in SQL, usata da tutti gli strati
-- (architettura, "Le funzioni della regola"). Nel dubbio la regola nega (fail closed).
-- Le funzioni sono SECURITY DEFINER con search_path fisso: i ruoli dell'API e del backoffice le
-- usano senza avere i permessi sulle tabelle protette (blocchi, aziende escluse, swipe, ...).
-- Sono VOLATILE: dentro i trigger ogni chiamata legge i dati confermati dopo l'attesa dei blocchi
-- (architettura, "Concorrenza").

-- Età in anni dalla data di nascita, nel calendario italiano (`age_years`, non `age`).
CREATE FUNCTION age_years(p_birth_date date) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT extract(year FROM age((now() AT TIME ZONE 'Europe/Rome')::date, p_birth_date))::int;
$$;

-- Account visibile (D19, D75, D76, D83, D111, D141). Nel dubbio: no.
CREATE FUNCTION account_visible(p_user_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT x.status IN ('active', 'reverifying')
       AND x.deletion_requested_at IS NULL                   -- ripensamento (D83)
       AND z.status = 'active'                               -- azienda in rimozione (D111)
       AND NOT EXISTS (SELECT 1 FROM sanctions s             -- sospensioni ed espulsione
                        WHERE s.user_id = p_user_id AND s.revoked_at IS NULL
                          AND s.type IN ('disciplinary_suspension',
                                         'precautionary_suspension', 'expulsion')
                          AND s.starts_at <= now()
                          AND (s.ends_at IS NULL OR s.ends_at > now()))
    FROM users x JOIN companies z ON z.id = x.company_id   -- senza azienda: nessuna riga
    WHERE x.id = p_user_id
  ), false);
$$;

-- Blocco in uno dei due sensi (D70), compresi gli sblocchi degli ultimi 30 giorni: la riga
-- sbloccata resta efficace per 30 giorni e poi la cancella il processo di pulizia (D108).
CREATE FUNCTION block_exists(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM blocks k
                  WHERE ((k.from_user_id = p_a AND k.to_user_id = p_b)
                      OR (k.from_user_id = p_b AND k.to_user_id = p_a))
                    AND (k.unblocked_at IS NULL OR k.unblocked_at > now() - interval '30 days'));
$$;

-- Open space reciproco: entrambi l'hanno attivo (D137, D139). Nel dubbio: no.
-- Conta solo tra colleghi: per aziende diverse non cambia nulla.
CREATE FUNCTION mutual_open_space(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p_a <> p_b AND ua.open_space AND ub.open_space
    FROM users ua, users ub
    WHERE ua.id = p_a AND ub.id = p_b
  ), false);
$$;

-- Aziende escluse (D175): uno dei due ha escluso l'azienda attuale dell'altro.
-- Reciproca e simmetrica; excluded_companies contiene solo righe già efficaci (D36) e mai
-- l'azienda attuale del suo utente (D158). Nel dubbio: sì.
CREATE FUNCTION exclusion_active(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT EXISTS (SELECT 1 FROM excluded_companies e
                    WHERE e.user_id = p_a AND e.company_id = ub.company_id)
        OR EXISTS (SELECT 1 FROM excluded_companies e
                    WHERE e.user_id = p_b AND e.company_id = ua.company_id)
    FROM users ua, users ub
    WHERE ua.id = p_a AND ub.id = p_b
  ), true);
$$;

-- Visibilità: a vede b (P8, D137, D158, D175). Nel dubbio: no. Simmetrica con D175.
-- Colleghi della stessa azienda: decidono l'Open space reciproco e i vincoli di sempre.
CREATE FUNCTION can_see(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p_a <> p_b
       AND account_visible(p_a) AND account_visible(p_b)
       AND ua.company_id IS NOT NULL AND ub.company_id IS NOT NULL
       AND (ua.company_id <> ub.company_id              -- regola core (D2): colleghi della
            OR mutual_open_space(p_a, p_b))             -- stessa azienda solo se vuoi (D137)
       AND ua.is_demo = ub.is_demo                      -- prove separate dai reali (D42)
       AND NOT block_exists(p_a, p_b)                   -- sempre: blocchi (D70)
       AND NOT exclusion_active(p_a, p_b)               -- aziende escluse, nei due sensi
                                                        -- (D175); mai tra colleghi (D158)
    FROM users ua, users ub
    WHERE ua.id = p_a AND ub.id = p_b
  ), false);
$$;

-- Visibilità reciproca: feed (D31), profilo dal feed, nuovi like e nuovi match (D58).
CREATE FUNCTION can_interact(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT can_see(p_a, p_b) AND can_see(p_b, p_a);
$$;

-- Conflitto aziendale: colleghi senza Open space reciproco, azienda non nota o tipi di
-- account diversi (D2, D42, D59, D137, D140). Non considera stati, esclusioni né blocchi: i
-- match congelati restano congelati (D41).
CREATE FUNCTION company_conflict(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT ua.company_id IS NULL OR ub.company_id IS NULL   -- nel dubbio: conflitto
        OR (ua.company_id = ub.company_id                    -- colleghi senza
            AND NOT mutual_open_space(p_a, p_b))             -- Open space reciproco
        OR ua.is_demo <> ub.is_demo                          -- reale e dimostrativo
    FROM users ua, users ub
    WHERE ua.id = p_a AND ub.id = p_b
  ), true);
$$;

-- Nuovo messaggio o invito di `p_sender_id` nel match `p_match_id` (D59, D63, D64, D82, D107).
CREATE FUNCTION can_write(p_sender_id uuid, p_match_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p_sender_id IN (x.user_a_id, x.user_b_id)
       AND x.status = 'active'
       AND account_visible(x.user_a_id)                    -- altrimenti la conversazione
       AND account_visible(x.user_b_id)                    -- è momentaneamente sospesa
       AND NOT block_exists(x.user_a_id, x.user_b_id)
       AND ua.is_demo = ub.is_demo
       AND (NOT company_conflict(x.user_a_id, x.user_b_id)
            OR x.chat_started_at IS NOT NULL)              -- chat avviata (D59, D107, D140)
    FROM matches x
    JOIN users ua ON ua.id = x.user_a_id
    JOIN users ub ON ub.id = x.user_b_id
    WHERE x.id = p_match_id
  ), false);
$$;

-- Revoca dei match senza messaggi e cancellazione dei like in attesa tra chi è in
-- conflitto aziendale (D9, D58, D59), compreso lo spegnimento dell'Open space (D140).
-- Unica procedura per tutte le cause: la logica non cambia con l'Open space.
CREATE FUNCTION realign_users(p_user_ids uuid[])
  RETURNS TABLE (matches_revoked int, likes_deleted int)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH revoked AS (
    UPDATE matches
       SET status = 'closed', close_reason = 'colleagues', closed_at = now()
     WHERE status = 'active'
       AND chat_started_at IS NULL                      -- le chat avviate restano (D59)
       AND (user_a_id = ANY (p_user_ids) OR user_b_id = ANY (p_user_ids))
       AND company_conflict(user_a_id, user_b_id)
    RETURNING 1),
  deleted AS (
    DELETE FROM swipes
     WHERE type IN ('like', 'escalation')               -- like in attesa (D9)
       AND (from_user_id = ANY (p_user_ids) OR to_user_id = ANY (p_user_ids))
       AND company_conflict(from_user_id, to_user_id)
    RETURNING 1)
  SELECT (SELECT count(*) FROM revoked)::int, (SELECT count(*) FROM deleted)::int;
$$;

-- Unico punto di scrittura dell'Open space (D137, D139, D140, D156, D166). Limiti in `config`.
-- Restituisce solo l'esito per l'utente stesso: mai nulla sui colleghi.
CREATE FUNCTION set_open_space(p_user_id uuid, p_enabled boolean, p_source open_space_source,
                               p_text_version text DEFAULT NULL)
  RETURNS TABLE (result boolean, changeable_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_value boolean;
  max_changes int := COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'open_space.max_changes'), 5);
  period interval := make_interval(days => COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'open_space.period_days'), 30));
  changes int;
BEGIN
  SELECT x.open_space INTO current_value FROM users x WHERE x.id = p_user_id FOR UPDATE;
  IF current_value IS NULL THEN RAISE EXCEPTION 'utente inesistente'; END IF;
  IF current_value = p_enabled AND p_source <> 'registration' THEN
    IF p_source = 'user' THEN                  -- "Lascialo spento" chiude la domanda
      UPDATE users SET open_space_prompt_at = NULL WHERE id = p_user_id;
    END IF;
    RETURN QUERY SELECT current_value, NULL::timestamptz; RETURN;
  END IF;                                      -- in registrazione si registra sempre (D156)
  IF p_enabled AND p_source = 'user' THEN      -- il limite vale solo per le attivazioni
    SELECT count(*) INTO changes FROM open_space_history s
     WHERE s.user_id = p_user_id AND s.source = 'user' AND s.changed_at > now() - period;
    IF changes >= max_changes THEN             -- oltre il limite: data della prossima modifica
      RETURN QUERY SELECT current_value, s.changed_at + period
        FROM open_space_history s
       WHERE s.user_id = p_user_id AND s.source = 'user' AND s.changed_at > now() - period
       ORDER BY s.changed_at OFFSET changes - max_changes LIMIT 1;
      RETURN;
    END IF;
  END IF;
  UPDATE users SET open_space = p_enabled,
         open_space_since = CASE WHEN p_enabled THEN now() END,
         open_space_prompt_at = CASE WHEN p_source = 'company_change' THEN now() END
   WHERE id = p_user_id;
  INSERT INTO open_space_history (user_id, enabled, changed_at, source, text_version)
       VALUES (p_user_id, p_enabled, now(), p_source,
               CASE WHEN p_enabled OR p_source = 'registration' THEN p_text_version END);
  IF NOT p_enabled THEN
    PERFORM realign_users(ARRAY[p_user_id]);   -- spegnimento: effetto immediato (D140)
  END IF;
  RETURN QUERY SELECT p_enabled, NULL::timestamptz;
END $$;

-- Numero di iscritti a un offsite, arrotondato (D153, D167): 0 vuol dire "meno di 10", altrimenti
-- la decina per difetto. Il numero esatto non esce mai dal database.
CREATE FUNCTION rounded_attendee_count(p_offsite_id uuid) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN n < 10 THEN 0 ELSE (n / 10) * 10 END
    FROM (SELECT count(*)::int AS n FROM offsite_attendees WHERE offsite_id = p_offsite_id) c;
$$;

-- Cancellazione definitiva di un account (D98, D112), versione minima dell'MVP: chiude i match
-- con `account_deleted`, accoda la revoca dei token dei fornitori e cancella la riga
-- dell'utente (cascata su identità, email, profilo, foto, swipe, messaggi scritti, sessioni).
-- Le prove del consenso restano senza legame, con l'impronta dell'email personale.
CREATE FUNCTION delete_account(p_user_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  UPDATE matches SET status = 'closed', close_reason = 'account_deleted', closed_at = now()
   WHERE status = 'active' AND p_user_id IN (user_a_id, user_b_id);
  UPDATE consents c SET email_hash = i.email_hash
    FROM personal_identities i
   WHERE c.user_id = p_user_id AND i.user_id = p_user_id AND i.revoked_at IS NULL;
  INSERT INTO provider_token_revocations (provider, token_ciphertext, key_version)
       SELECT provider, refresh_token_ciphertext, refresh_token_key_version
         FROM personal_identities
        WHERE user_id = p_user_id AND refresh_token_ciphertext IS NOT NULL;
  DELETE FROM users WHERE id = p_user_id;
END $$;
