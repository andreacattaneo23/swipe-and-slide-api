-- Trigger del database: ultima difesa della regola core e dei vincoli del modello dati
-- (architettura, "Trigger del database" e "Vincoli e indici"). Ogni errore ha un SQLSTATE
-- dedicato della classe `SS`, che l'API traduce nella risposta neutra:
--   SSC01 regola core (swipe, match, messaggi, inviti)      SSC02 riallineamento mancante
--   SSC03 approvazione senza revisione                       SSC04 account dimostrativi
--   SSC05 aziende escluse                                    SSC06 limite dell'Open space
--   SSC07 consenso art. 9 mancante                           SSC08 azienda incoerente
--   SSC09 match chiuso non riapribile                        SSC10 audit non modificabile
--   SSC11 massimo delle foto

-- ---------------------------------------------------------------------------------------------
-- Regola core su swipe, match, messaggi e inviti (D31, D58, D59)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_core_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a uuid;
  b uuid;
  ok boolean;
BEGIN
  IF TG_TABLE_NAME = 'swipes' THEN
    a := NEW.from_user_id;  b := NEW.to_user_id;
  ELSIF TG_TABLE_NAME = 'matches' THEN
    a := NEW.user_a_id;   b := NEW.user_b_id;
  ELSE  -- messaggi e inviti: l'altra persona è l'altro partecipante del match
    IF TG_TABLE_NAME = 'messages' THEN a := NEW.sender_id; ELSE a := NEW.proposed_by; END IF;
    SELECT CASE WHEN m.user_a_id = a THEN m.user_b_id ELSE m.user_a_id END
      INTO b FROM matches m WHERE m.id = NEW.match_id;
  END IF;
  -- Prima le righe dei due utenti, in ordine di identificativo: serializza con cambi di
  -- azienda, blocchi, sanzioni e modifiche applicate. Poi la riga del match.
  PERFORM 1 FROM users WHERE id IN (a, b) ORDER BY id FOR SHARE;
  IF TG_TABLE_NAME IN ('messages', 'invites') THEN
    PERFORM 1 FROM matches WHERE id = NEW.match_id FOR UPDATE;
    ok := b IS NOT NULL AND can_write(a, NEW.match_id);   -- D59: chat avviata tra colleghi
  ELSE
    ok := a IS NOT NULL AND b IS NOT NULL AND can_interact(a, b);   -- D31, D58
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'regola core: interazione non consentita' USING ERRCODE = 'SSC01';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER core_rule BEFORE INSERT ON swipes
  FOR EACH ROW EXECUTE FUNCTION check_core_rule();
CREATE TRIGGER core_rule BEFORE INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION check_core_rule();
CREATE TRIGGER core_rule BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION check_core_rule();
CREATE TRIGGER core_rule BEFORE INSERT ON invites
  FOR EACH ROW EXECUTE FUNCTION check_core_rule();

-- Il primo messaggio avvia la chat (D59, D62): una sola volta, nella stessa transazione.
CREATE FUNCTION mark_chat_started() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE matches SET chat_started_at = NEW.created_at
   WHERE id = NEW.match_id AND chat_started_at IS NULL;
  RETURN NULL;
END $$;

CREATE TRIGGER chat_started AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION mark_chat_started();

-- Un match chiuso non torna attivo; alla chiusura si chiudono gli inviti ancora aperti.
CREATE FUNCTION check_match_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'match chiuso: non si riapre' USING ERRCODE = 'SSC09';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER match_status BEFORE UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION check_match_status();

CREATE FUNCTION close_match_invites() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'closed' THEN
    UPDATE invites SET status = 'closed'
     WHERE match_id = NEW.id
       AND (status = 'pending' OR (status = 'accepted' AND day >= current_date));
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER match_closed AFTER UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION close_match_invites();

-- ---------------------------------------------------------------------------------------------
-- Revoca tra chi diventa collega (D59, D140): trigger differito a fine transazione
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_realignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN u := NEW.id; ELSE u := NEW.user_id; END IF;
  IF EXISTS (SELECT 1 FROM matches m
              WHERE m.status = 'active' AND m.chat_started_at IS NULL
                AND u IN (m.user_a_id, m.user_b_id)
                AND company_conflict(m.user_a_id, m.user_b_id))
  OR EXISTS (SELECT 1 FROM swipes s
              WHERE s.type IN ('like', 'escalation')
                AND u IN (s.from_user_id, s.to_user_id)
                AND company_conflict(s.from_user_id, s.to_user_id)) THEN
    RAISE EXCEPTION 'regola core: riallineamento mancante' USING ERRCODE = 'SSC02';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER realignment
  AFTER UPDATE OF company_id, status, open_space ON users   -- anche lo spegnimento (D140)
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_realignment();
CREATE CONSTRAINT TRIGGER realignment
  AFTER INSERT OR UPDATE OF company_id ON work_emails
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_realignment();

-- ---------------------------------------------------------------------------------------------
-- Coerenza dell'azienda: `users.company_id` uguale all'azienda dell'email aziendale attiva
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_company_coherence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid;
  user_company uuid;
  user_status account_status;
  email_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN u := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN u := OLD.user_id;
  ELSE u := NEW.user_id;
  END IF;
  SELECT company_id, status INTO user_company, user_status FROM users WHERE id = u;
  IF NOT FOUND THEN RETURN NULL; END IF;        -- account appena cancellato
  SELECT company_id INTO email_company FROM work_emails WHERE user_id = u AND status = 'active';
  IF email_company IS NOT NULL THEN
    IF email_company IS DISTINCT FROM user_company THEN
      RAISE EXCEPTION 'azienda incoerente con l''email aziendale attiva' USING ERRCODE = 'SSC08';
    END IF;
  ELSIF user_company IS NOT NULL AND user_status NOT IN ('suspended', 'deleted') THEN
    -- Senza email attiva l'azienda resta solo per gli account in sospeso (D19, D41)
    RAISE EXCEPTION 'azienda senza email aziendale attiva' USING ERRCODE = 'SSC08';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER company_coherence
  AFTER INSERT OR UPDATE OF company_id, status ON users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_company_coherence();
CREATE CONSTRAINT TRIGGER company_coherence
  AFTER INSERT OR UPDATE OR DELETE ON work_emails
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_company_coherence();

-- Nessuna email aziendale né dominio verso un'azienda non `active` (D111)
CREATE FUNCTION check_company_active() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid := NEW.company_id;
BEGIN
  -- Le email storiche possono restare su un'azienda non attiva: si controllano solo le attive
  IF TG_TABLE_NAME = 'work_emails' THEN
    IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  END IF;
  IF target IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM companies WHERE id = target AND status = 'active') THEN
    RAISE EXCEPTION 'azienda non attiva' USING ERRCODE = 'SSC08';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER company_active BEFORE INSERT ON work_emails
  FOR EACH ROW EXECUTE FUNCTION check_company_active();
CREATE TRIGGER company_active BEFORE INSERT OR UPDATE OF company_id ON company_domains
  FOR EACH ROW EXECUTE FUNCTION check_company_active();

-- ---------------------------------------------------------------------------------------------
-- Account dimostrativi separati dai reali (D42)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_demo_accounts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    RAISE EXCEPTION 'account dimostrativo: tipo non modificabile' USING ERRCODE = 'SSC04';
  END IF;
  IF NEW.company_id IS NOT NULL AND NEW.is_demo IS DISTINCT FROM
     (SELECT z.is_demo FROM companies z WHERE z.id = NEW.company_id) THEN
    RAISE EXCEPTION 'account dimostrativo: azienda di tipo diverso' USING ERRCODE = 'SSC04';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER demo_accounts BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION check_demo_accounts();

CREATE FUNCTION check_demo_companies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    RAISE EXCEPTION 'azienda dimostrativa: tipo non modificabile' USING ERRCODE = 'SSC04';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER demo_companies BEFORE UPDATE OF is_demo ON companies
  FOR EACH ROW EXECUTE FUNCTION check_demo_companies();

-- ---------------------------------------------------------------------------------------------
-- Approvazione dei profili (D141, D144) e consenso art. 9 (D33)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'pending_approval' AND NEW.status = 'active' AND NOT NEW.is_demo
     AND NOT EXISTS (SELECT 1 FROM profile_reviews r
                      WHERE r.user_id = NEW.id AND r.outcome = 'approved'
                        AND r.decided_by IS NOT NULL) THEN
    RAISE EXCEPTION 'approvazione senza revisione approvata' USING ERRCODE = 'SSC03';
  END IF;
  IF OLD.status = 'registering' AND NEW.status = 'active' AND NOT NEW.is_demo THEN
    RAISE EXCEPTION 'approvazione senza revisione approvata' USING ERRCODE = 'SSC03';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval BEFORE UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION check_approval();

CREATE FUNCTION check_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('pending_approval', 'active') AND NOT NEW.is_demo
     AND NOT EXISTS (SELECT 1 FROM consents c
                      WHERE c.user_id = NEW.id AND c.type = 'art9' AND c.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'consenso art. 9 mancante' USING ERRCODE = 'SSC07';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER consent
  AFTER INSERT OR UPDATE OF status ON users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_consent();

-- ---------------------------------------------------------------------------------------------
-- Open space: limite delle attivazioni anche se il servizio sbagliasse (D137, D197)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_open_space_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  max_changes int := COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'open_space.max_changes'), 5);
  period interval := make_interval(days => COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'open_space.period_days'), 30));
BEGIN
  IF NEW.enabled AND NEW.source = 'user' THEN
    PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
    IF (SELECT count(*) FROM open_space_history s
         WHERE s.user_id = NEW.user_id AND s.source = 'user'
           AND s.changed_at > NEW.changed_at - period) >= max_changes THEN
      RAISE EXCEPTION 'open space: limite delle modifiche' USING ERRCODE = 'SSC06';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER open_space_limit BEFORE INSERT ON open_space_history
  FOR EACH ROW EXECUTE FUNCTION check_open_space_limit();

-- ---------------------------------------------------------------------------------------------
-- Aziende escluse (D158, D175, D176, D186): mai l'azienda attuale, solo aziende attive dello
-- stesso tipo, al massimo 15 contando le aggiunte in attesa (l'azienda lasciata entra oltre il
-- massimo), limite delle modifiche e 7 giorni prima di togliere un'azienda aggiunta
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_excluded_company_target(p_user_id uuid, p_company_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u record;
BEGIN
  SELECT company_id, is_demo INTO u FROM users WHERE id = p_user_id FOR UPDATE;
  IF u.company_id IS NOT DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'aziende escluse: azienda attuale' USING ERRCODE = 'SSC05';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies z
                  WHERE z.id = p_company_id AND z.status = 'active' AND z.is_demo = u.is_demo) THEN
    RAISE EXCEPTION 'aziende escluse: azienda non ammessa' USING ERRCODE = 'SSC05';
  END IF;
END $$;

CREATE FUNCTION excluded_companies_total(p_user_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM excluded_companies WHERE user_id = p_user_id)::int
       + (SELECT count(*) FROM excluded_company_changes
           WHERE user_id = p_user_id AND status = 'pending' AND operation = 'add')::int;
$$;

CREATE FUNCTION check_excluded_companies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  max_companies int := COALESCE((SELECT (value #>> '{}')::int FROM config
                                  WHERE key = 'excluded_companies.max'), 15);
BEGIN
  PERFORM check_excluded_company_target(NEW.user_id, NEW.company_id);
  -- L'aggiunta in attesa che diventa efficace non conta due volte
  IF NEW.source <> 'company_change'
     AND excluded_companies_total(NEW.user_id)
         - (SELECT count(*) FROM excluded_company_changes
             WHERE user_id = NEW.user_id AND company_id = NEW.company_id
               AND status = 'pending' AND operation = 'add')::int >= max_companies THEN
    RAISE EXCEPTION 'aziende escluse: massimo raggiunto' USING ERRCODE = 'SSC05';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER excluded_companies_rules BEFORE INSERT ON excluded_companies
  FOR EACH ROW EXECUTE FUNCTION check_excluded_companies();

CREATE FUNCTION check_excluded_company_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  max_companies int := COALESCE((SELECT (value #>> '{}')::int FROM config
                                  WHERE key = 'excluded_companies.max'), 15);
  max_changes int := COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'excluded_companies.max_changes'), 5);
  period interval := make_interval(days => COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'excluded_companies.period_days'), 30));
  min_days interval := make_interval(days => COALESCE((SELECT (value #>> '{}')::int FROM config
                                WHERE key = 'excluded_companies.min_days_before_removal'), 7));
  existing record;
BEGIN
  IF NEW.operation = 'add' THEN
    PERFORM check_excluded_company_target(NEW.user_id, NEW.company_id);
    IF excluded_companies_total(NEW.user_id) >= max_companies THEN
      RAISE EXCEPTION 'aziende escluse: massimo raggiunto' USING ERRCODE = 'SSC05';
    END IF;
  ELSE
    PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
    SELECT * INTO existing FROM excluded_companies
     WHERE user_id = NEW.user_id AND company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'aziende escluse: azienda non presente' USING ERRCODE = 'SSC05';
    END IF;
    IF existing.source <> 'company_change' AND existing.effective_at > NEW.requested_at - min_days THEN
      RAISE EXCEPTION 'aziende escluse: troppo presto per toglierla' USING ERRCODE = 'SSC05';
    END IF;
  END IF;
  -- Limite delle modifiche: le annullate non contano (D39)
  IF (SELECT count(*) FROM excluded_company_changes c
       WHERE c.user_id = NEW.user_id AND c.status <> 'cancelled'
         AND c.requested_at > NEW.requested_at - period) >= max_changes THEN
    RAISE EXCEPTION 'aziende escluse: limite delle modifiche' USING ERRCODE = 'SSC05';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER excluded_company_changes_rules BEFORE INSERT ON excluded_company_changes
  FOR EACH ROW EXECUTE FUNCTION check_excluded_company_changes();

-- Un cambio di azienda che dimentica di togliere la nuova azienda dall'elenco non si conferma
CREATE FUNCTION check_current_company_not_excluded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM excluded_companies e
              JOIN users x ON x.id = e.user_id
             WHERE x.id = NEW.id AND e.company_id = x.company_id) THEN
    RAISE EXCEPTION 'aziende escluse: contiene l''azienda attuale' USING ERRCODE = 'SSC05';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER current_company_not_excluded
  AFTER UPDATE OF company_id ON users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_current_company_not_excluded();

-- ---------------------------------------------------------------------------------------------
-- Completezza del profilo (D51, D109): una sola definizione
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION profile_is_complete(p profiles) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.first_name IS NOT NULL AND p.birth_date IS NOT NULL AND p.gender IS NOT NULL
     AND p.interested_in IS NOT NULL AND p.home_city_id IS NOT NULL
     AND (SELECT count(*) FROM photos f WHERE f.user_id = p.user_id AND f.status = 'approved') >= 2;
$$;

CREATE FUNCTION update_completeness() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    NEW.is_complete := profile_is_complete(NEW);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  u := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  UPDATE profiles SET is_complete = is_complete WHERE user_id = u;   -- ricalcolo nel trigger
  RETURN NULL;
END $$;

CREATE TRIGGER completeness BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_completeness();
CREATE TRIGGER completeness AFTER INSERT OR UPDATE OF status OR DELETE ON photos
  FOR EACH ROW EXECUTE FUNCTION update_completeness();

-- Al massimo 6 foto non respinte per utente
CREATE FUNCTION check_photos_max() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM photos WHERE user_id = NEW.user_id AND status <> 'rejected') >= 6 THEN
    RAISE EXCEPTION 'foto: massimo raggiunto' USING ERRCODE = 'SSC11';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER photos_max BEFORE INSERT ON photos
  FOR EACH ROW EXECUTE FUNCTION check_photos_max();

-- ---------------------------------------------------------------------------------------------
-- Audit a sola aggiunta (D99): la pulizia toglie solo le righe oltre i 12 mesi
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.performed_at > now() - interval '12 months' THEN
    RAISE EXCEPTION 'audit: registro non modificabile' USING ERRCODE = 'SSC10';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION check_audit_append_only();
