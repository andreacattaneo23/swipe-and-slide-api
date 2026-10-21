-- D244: il backoffice non ha più il codice del secondo fattore. L'operatore accede con l'email e il
-- codice ricevuto per email; le azioni distruttive e la lettura delle chat chiedono il nome o
-- l'identificativo esatto e la motivazione. In produzione il secondo livello resta Cloudflare
-- Access davanti al backoffice e ad `admin-api` (D241). Si tolgono segreti TOTP, passo dell'ultimo
-- TOTP, ora dell'ultimo TOTP della sessione e la sfida in più passi, non più usata.

REVOKE UPDATE (last_totp_step, encrypted_totp_secret) ON operators FROM backoffice_role;
ALTER TABLE operators DROP COLUMN encrypted_totp_secret;
ALTER TABLE operators DROP COLUMN last_totp_step;
ALTER TABLE operator_sessions DROP COLUMN last_totp_at;

DROP TABLE operator_challenges;
DROP TYPE operator_challenge_stage;
