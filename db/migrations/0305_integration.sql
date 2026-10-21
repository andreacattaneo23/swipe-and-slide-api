-- Unione dei moduli (fase 3 dell'integrazione): solo aggiunte e allineamenti dei dati di base.

-- Filtro delle parole (D73): un solo elenco in `config`, gestito dal backoffice. Di base le parole
-- del primo elenco del profilo, se l'elenco è ancora vuoto.
UPDATE config
   SET value = '["stronzo", "stronza", "troia", "puttana", "vaffanculo", "coglione", "cogliona",
                 "frocio", "negro", "ricchione"]'::jsonb
 WHERE key = 'word_filter.words' AND value = '[]'::jsonb;

-- Esito dell'approvazione deciso da `admin-api` (D142, D197): la push parte dal servizio delle
-- notifiche, che legge preferenze e dispositivi e toglie i token non più validi.
GRANT SELECT ON notification_preferences TO backoffice_role;
GRANT SELECT, DELETE ON devices TO backoffice_role;
