-- Notifiche push (team B2, D239): token dei dispositivi e preferenze (D65, D66, D114, D230),
-- architettura "Notifiche ed esportazioni" e "Notifiche push". Le preferenze compaiono anche
-- nelle impostazioni del team B1: le tabelle si creano solo se mancano. [Proposta] All'unione dei
-- rami resta una sola definizione.

-- Token di Expo Push: uno per installazione dell'app; si cancellano all'uscita, alla
-- cancellazione e quando Expo li segnala non validi.
CREATE TABLE IF NOT EXISTS devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  installation_id text NOT NULL CHECK (length(installation_id) BETWEEN 8 AND 100),
  push_token      text NOT NULL CHECK (length(push_token) BETWEEN 10 AND 200),
  platform        text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id),
  UNIQUE (push_token)
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id);

-- Una riga per utente; senza riga valgono i valori di base: tutti i tipi accesi, anteprime spente
-- (D197), nessuna fascia della "Modalità in riunione".
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  disabled_types text[] NOT NULL DEFAULT '{}'
                 CHECK (disabled_types <@ ARRAY['new_match', 'new_message', 'escalation', 'invite',
                                                'match_expiry', 'reverification', 'ooo_reminder',
                                                'offsite']::text[]),
  previews       boolean NOT NULL DEFAULT false,
  -- Fasce di ogni giorno in ora italiana, anche oltre la mezzanotte (D233):
  -- [{"start": "22:00", "end": "07:00"}]
  quiet_hours    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quiet_hours) = 'array'),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON devices, notification_preferences TO app_role, jobs_role;

-- Avvisi agli iscritti di un offsite modificato o annullato dal backoffice (D197): il backoffice
-- non legge le iscrizioni (D90, RC-117), quindi accoda solo l'avviso; il processo
-- `offsite-notices` lo consegna agli iscritti con l'evento `offsite` e la notifica a tema.
CREATE TABLE offsite_notices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offsite_id uuid NOT NULL REFERENCES offsites (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('updated', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
CREATE INDEX offsite_notices_pending_idx ON offsite_notices (created_at) WHERE sent_at IS NULL;
GRANT INSERT ON offsite_notices TO backoffice_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON offsite_notices TO jobs_role;
