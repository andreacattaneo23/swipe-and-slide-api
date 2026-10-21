-- Feed, swipe e distanze (team B2, D239): funzioni della query del feed dell'architettura
-- ("Feed", "Città base, distanze e fasce", "Distanze senza PostGIS"), con la regola core sempre
-- da `can_interact`. Solo aggiunte: le tabelle esistenti si cambiano con ALTER.

-- ---------------------------------------------------------------------------------------------
-- Trasferte (D50, D57): la tabella è del dominio del profilo (`0100_profile_account.sql`); il feed
-- e i suggerimenti degli inviti la leggono.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON trips TO app_role, jobs_role;

-- ---------------------------------------------------------------------------------------------
-- Distanze tra i centroidi dei comuni (D49, D109, D115)
-- ---------------------------------------------------------------------------------------------
-- Distanza in km tra due centroidi (formula dell'emisenoverso).
CREATE FUNCTION distance_km(p_lat1 float8, p_lon1 float8, p_lat2 float8, p_lon2 float8)
  RETURNS float8 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2))
           * power(sin(radians(p_lon2 - p_lon1) / 2), 2)));
$$;

-- Distanza massima in km di una preferenza: `city` vuol dire "stessa città mostrata" (0).
CREATE FUNCTION max_km(p max_distance) RETURNS float8 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p WHEN 'city' THEN 0 WHEN 'km25' THEN 25 WHEN 'km50' THEN 50 WHEN 'km100' THEN 100
                WHEN 'km200' THEN 200 ELSE 'Infinity'::float8 END;
$$;

-- Fascia mostrata (codici dell'API): mai la distanza in km (D49).
CREATE FUNCTION distance_band(p_km float8, p_same_city boolean) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_same_city THEN 'same_city'
              WHEN p_km <= 25 THEN 'within_25' WHEN p_km <= 50 THEN 'within_50'
              WHEN p_km <= 100 THEN 'within_100' WHEN p_km <= 200 THEN 'within_200'
              ELSE 'over_200' END;
$$;

-- Città mostrata di un comune (D109): la città vicina più grande per i comuni piccoli.
CREATE FUNCTION shown_city_id(p_city_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(c.display_city_id, c.id) FROM cities c WHERE c.id = p_city_id;
$$;

-- Città attive di un utente in un giorno: città base più trasferte nella finestra di visibilità,
-- da 14 giorni prima dell'inizio fino all'ultimo giorno (D57). `trip_id` vuoto per la città base.
CREATE FUNCTION active_cities(p_user_id uuid, p_day date)
  RETURNS TABLE (city_id text, trip_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.home_city_id, NULL::uuid FROM profiles p
   WHERE p.user_id = p_user_id AND p.home_city_id IS NOT NULL
  UNION ALL
  SELECT t.city_id, t.id FROM trips t
   WHERE t.user_id = p_user_id AND p_day BETWEEN t.start_date - 14 AND t.end_date;
$$;

-- "Chi ti interessa" nei due sensi (D47, D56, D109): `men` solo `man`, `women` solo `woman`,
-- `everyone` i quattro generi; "Non binario" e "Preferisco non dirlo" solo a chi cerca `everyone`.
CREATE FUNCTION interest_covers(p_interest interested_in, p_gender gender) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_interest WHEN 'everyone' THEN p_gender IS NOT NULL
                         WHEN 'men' THEN p_gender = 'man'
                         WHEN 'women' THEN p_gender = 'woman'
                         ELSE false END;
$$;

CREATE FUNCTION gender_compatible(p_a_gender gender, p_a_interest interested_in,
                                  p_b_gender gender, p_b_interest interested_in) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(interest_covers(p_a_interest, p_b_gender)
                  AND interest_covers(p_b_interest, p_a_gender), false);
$$;

-- Match attivo o chiuso da meno di 30 giorni tra due persone (D54, D61, D197).
CREATE FUNCTION recent_match(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM matches m
                  WHERE m.user_a_id = least(p_a, p_b) AND m.user_b_id = greatest(p_a, p_b)
                    AND (m.status = 'active' OR m.closed_at > now() - interval '30 days'));
$$;

-- Coefficienti del peso del feed, solo nel server (D52): mai nelle risposte.
INSERT INTO config (key, value) VALUES
  ('feed.weight.recent', '1'),
  ('feed.weight.affinity', '0.5'),
  ('feed.weight.escalation', '4'),
  ('chat.messages_per_minute', '30')
ON CONFLICT (key) DO NOTHING;

-- Peso di un candidato (D52, D53): base uguale per tutti, attività recente, stesso ambito,
-- escalation ricevuta. Sempre maggiore di zero; l'Open space non pesa (D137).
CREATE FUNCTION feed_weight(p_me uuid, p_candidate uuid) RETURNS float8
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT coalesce((SELECT (value #>> '{}')::float8 FROM config WHERE key = 'feed.weight.recent'), 1) AS recent,
           coalesce((SELECT (value #>> '{}')::float8 FROM config WHERE key = 'feed.weight.affinity'), 0.5) AS affinity,
           coalesce((SELECT (value #>> '{}')::float8 FROM config WHERE key = 'feed.weight.escalation'), 4) AS escalation,
           (now() AT TIME ZONE 'Europe/Rome')::date AS today)
  SELECT 1.0
       + CASE WHEN u.last_seen_on >= w.today - 1 THEN w.recent
              WHEN u.last_seen_on >= w.today - 7 THEN w.recent / 2 ELSE 0 END
       + CASE WHEN p.practice_area IS NOT NULL AND p.practice_area = mp.practice_area
              THEN w.affinity ELSE 0 END
       + CASE WHEN EXISTS (SELECT 1 FROM swipes s
                            WHERE s.from_user_id = p_candidate AND s.to_user_id = p_me
                              AND s.type = 'escalation' AND s.expires_at > now())
              THEN w.escalation ELSE 0 END
    FROM w, users u JOIN profiles p ON p.user_id = u.id, profiles mp
   WHERE u.id = p_candidate AND mp.user_id = p_me;
$$;

-- ---------------------------------------------------------------------------------------------
-- Query del feed (architettura, "Feed"; D31, D49–D54, D81, D109, D137, D141, D152).
-- `p_offsite_id`: swipe dell'offsite, solo tra gli iscritti e senza la distanza. `p_only`: solo
-- gli identificativi indicati (ricontrollo dei lotti in cache e degli swipe), senza ordine.
-- Restituisce solo identificativi, fascia e segni della card; la regola core è `can_interact`
-- sui candidati rimasti dopo i filtri economici, scritti in modo indipendente.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION feed_candidates(p_me uuid, p_trips_only boolean, p_offsite_id uuid,
                                p_only uuid[], p_limit integer)
  RETURNS TABLE (user_id uuid, band text, trip_id uuid, escalation boolean,
                 open_space_colleagues boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (                 -- chi chiede: visibile, profilo completo, non in OOO (D81, D109)
    SELECT u.id, u.company_id, u.is_demo, u.open_space, p.gender, p.interested_in,
           age_years(p.birth_date) AS age, p.age_min, p.age_max, p.max_distance
      FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE u.id = p_me AND p.is_complete AND p.ooo_since IS NULL AND account_visible(p_me)),
  today AS (SELECT (now() AT TIME ZONE 'Europe/Rome')::date AS d),
  mine AS (                    -- città attive di chi chiede, con la città mostrata
    SELECT a.city_id, c.lat, c.lon, coalesce(c.display_city_id, c.id) AS shown
      FROM today, active_cities(p_me, today.d) a JOIN cities c ON c.id = a.city_id),
  candidates AS (
    SELECT u.id, u.company_id, p.max_distance
      FROM me, users u JOIN profiles p ON p.user_id = u.id
     WHERE u.id <> me.id
       AND (p_only IS NULL OR u.id = ANY (p_only))
       AND u.status IN ('active', 'reverifying')           -- mai in approvazione (D141)
       AND (u.company_id <> me.company_id                   -- filtro esplicito (D2): colleghi
            OR (me.open_space AND u.open_space))            -- solo se vuoi (D137)
       AND u.is_demo = me.is_demo                           -- prove separate dai reali (D42)
       AND p.is_complete AND p.ooo_since IS NULL            -- D51, D81
       AND gender_compatible(me.gender, me.interested_in, p.gender, p.interested_in)
       AND age_years(p.birth_date) BETWEEN me.age_min AND me.age_max
       AND me.age BETWEEN p.age_min AND p.age_max           -- età nei due sensi (D51)
       AND (p_offsite_id IS NULL OR EXISTS (SELECT 1 FROM offsite_attendees oa
                                             WHERE oa.offsite_id = p_offsite_id
                                               AND oa.user_id = u.id))
       AND NOT EXISTS (SELECT 1 FROM swipes s               -- scartati e like (D54)
                        WHERE s.from_user_id = me.id AND s.to_user_id = u.id
                          AND s.expires_at > now())
       AND NOT recent_match(me.id, u.id)),                  -- attivo o chiuso da poco (D61)
  located AS (                 -- coppia di città attive più vicina e compatibile (D51, D109)
    SELECT c.id, c.company_id, pair.km, pair.same_city, pair.trip_id, pair.ok
      FROM me, today, candidates c
      LEFT JOIN LATERAL (
        SELECT x.km, x.same_city, x.trip_id,
               (x.same_city OR (x.lim > 0 AND x.km <= x.lim))
               AND (NOT p_trips_only OR (x.trip_id IS NOT NULL AND x.same_city)) AS ok
          FROM (SELECT distance_km(m.lat, m.lon, tc.lat, tc.lon) AS km,
                       m.shown = coalesce(tc.display_city_id, tc.id) AS same_city,
                       t.trip_id,
                       least(max_km(me.max_distance), max_km(c.max_distance)) AS lim
                  FROM mine m, active_cities(c.id, today.d) t
                  JOIN cities tc ON tc.id = t.city_id) x
         ORDER BY 4 DESC, x.same_city DESC, x.km ASC
         LIMIT 1) pair ON true
     WHERE p_offsite_id IS NOT NULL                         -- offsite: niente distanza (D152)
        OR (me.is_demo AND NOT p_trips_only)                -- dimostrativi: niente distanza
        OR pair.ok)
  SELECT l.id,
         CASE WHEN p_offsite_id IS NULL AND l.km IS NOT NULL
              THEN distance_band(l.km, l.same_city) END,
         CASE WHEN p_offsite_id IS NULL THEN l.trip_id END,
         EXISTS (SELECT 1 FROM swipes s                     -- escalation ricevuta (D53)
                  WHERE s.from_user_id = l.id AND s.to_user_id = p_me
                    AND s.type = 'escalation' AND s.expires_at > now()),
         (l.company_id = me.company_id AND mutual_open_space(p_me, l.id))   -- badge (D168)
    FROM located l, me
   WHERE can_interact(p_me, l.id)                           -- visibilità reciproca (D31)
   ORDER BY -ln(1 - random()) / feed_weight(p_me, l.id)     -- casuale pesato, mai ricostruibile
   LIMIT p_limit;
$$;

-- Indice per la scadenza degli swipe (processo `expire-swipes`, D54)
CREATE INDEX swipes_expires_idx ON swipes (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Bonus di chi scrive per primo (D62): nella transazione del primo messaggio, dopo il trigger
-- della regola core (che ha bloccato le righe dei due utenti e quella del match), 3 like in più
-- al mittente per il giorno corrente, al massimo 3 volte al giorno. Il blocco del match mette
-- in fila due primi messaggi simultanei: il bonus va a una sola persona.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION award_first_message_bonus() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Rome')::date;
BEGIN
  IF EXISTS (SELECT 1 FROM matches WHERE id = NEW.match_id AND chat_started_at IS NULL) THEN
    INSERT INTO daily_counters (user_id, day, bonuses_received)
         VALUES (NEW.sender_id, today, 1)
    ON CONFLICT (user_id, day) DO UPDATE
       SET bonuses_received = daily_counters.bonuses_received + 1
     WHERE daily_counters.bonuses_received < 3;
  END IF;
  RETURN NEW;
END $$;

-- Il nome segue `core_rule` in ordine alfabetico: i trigger BEFORE partono in quell'ordine
CREATE TRIGGER first_message_bonus BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION award_first_message_bonus();

-- Lunghezza del testo cifrato: il servizio controlla 1.000 caratteri prima della cifratura
ALTER TABLE messages ADD CONSTRAINT messages_ciphertext_length CHECK (octet_length(ciphertext) <= 4096);

-- Match visti da ciascuna delle due persone: "Deal Closed!" alla prima apertura e punto della
-- scheda Match (D60, D197) [Proposta]
ALTER TABLE matches ADD COLUMN user_a_seen_at timestamptz;
ALTER TABLE matches ADD COLUMN user_b_seen_at timestamptz;

-- Inviti visti da chi li riceve: punto della scheda Agenda (D145) [Proposta]
ALTER TABLE invites ADD COLUMN seen_at timestamptz;
CREATE INDEX invites_day_idx ON invites (day);

-- Promemoria del giorno prima di un offsite (processo `offsite-reminders`) [Proposta]
ALTER TABLE offsites ADD COLUMN reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Iscrizione agli offsite (D151, D152, D167): ultima difesa delle regole del servizio. Solo
-- account visibili e approvati, dello stesso tipo dell'offsite, offsite pubblicato e non
-- concluso; capienza con il blocco della riga dell'offsite.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION check_offsite_attendance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record;
BEGIN
  SELECT * INTO o FROM offsites WHERE id = NEW.offsite_id FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'published' OR o.ends_at <= now()
     OR NOT account_visible(NEW.user_id)
     OR o.is_demo IS DISTINCT FROM (SELECT is_demo FROM users WHERE id = NEW.user_id)
     OR (o.capacity IS NOT NULL
         AND (SELECT count(*) FROM offsite_attendees WHERE offsite_id = NEW.offsite_id) >= o.capacity)
  THEN
    RAISE EXCEPTION 'offsite: iscrizione non ammessa' USING ERRCODE = 'SSC13';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER offsite_attendance BEFORE INSERT ON offsite_attendees
  FOR EACH ROW EXECUTE FUNCTION check_offsite_attendance();
