-- Team B3 (D239): viste e permessi dei ruoli del database per sicurezza, moderazione e
-- amministrazione (architettura, "Ruoli del database", D90, D231). Le tabelle nuove non sono
-- coperte dai `GRANT ... ON ALL TABLES` della 0004: i permessi si danno qui, uno per uno.

-- ---------------------------------------------------------------------------------------------
-- Scheda dell'utente per il backoffice (D89, D90): email già mascherate, età al posto della data
-- di nascita; mai "chi ti interessa", Open space, aziende escluse, blocchi né città base
-- ---------------------------------------------------------------------------------------------
CREATE VIEW backoffice_user_cards AS
  SELECT x.id AS user_id, x.status, x.is_demo, x.created_at, x.last_seen_on,
         x.reverification_due_at, x.deletion_scheduled_at, x.deletion_requested_at,
         x.company_id, z.name AS company_name, z.status AS company_status,
         i.provider AS sign_in_method, mask_email(i.email) AS personal_email_masked,
         mask_email(w.email) AS work_email_masked, w.verified_at AS work_email_verified_at,
         w.next_reverification_at,
         p.first_name, age_years(p.birth_date) AS age_years, p.gender, p.practice_area,
         p.looking_for, p.bio, account_visible(x.id) AS visible
    FROM users x
    LEFT JOIN companies z ON z.id = x.company_id
    LEFT JOIN personal_identities i ON i.user_id = x.id AND i.revoked_at IS NULL
    LEFT JOIN work_emails w ON w.user_id = x.id AND w.status = 'active'
    LEFT JOIN profiles p ON p.user_id = x.id;
GRANT SELECT ON backoffice_user_cards TO backoffice_role;

-- ---------------------------------------------------------------------------------------------
-- backoffice_role
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, UPDATE ON reports TO backoffice_role;
GRANT SELECT ON report_contents TO backoffice_role;
GRANT SELECT, INSERT ON sanctions TO backoffice_role;
GRANT UPDATE (revoked_at, notified_at, ends_at) ON sanctions TO backoffice_role;
GRANT SELECT ON appeals TO backoffice_role;
GRANT UPDATE (reviewed_by, reviewed_at, outcome, explanation) ON appeals TO backoffice_role;
GRANT SELECT, INSERT, DELETE ON age_verifications TO backoffice_role;
GRANT SELECT, UPDATE ON directory_alerts TO backoffice_role;
GRANT SELECT, INSERT ON store_review_windows TO backoffice_role;
GRANT UPDATE (closed_at) ON store_review_windows TO backoffice_role;
GRANT SELECT, INSERT, UPDATE ON operator_challenges TO backoffice_role;
GRANT INSERT ON operators TO backoffice_role;
GRANT UPDATE (name, roles, status, last_totp_step, encrypted_totp_secret) ON operators
  TO backoffice_role;
GRANT INSERT ON user_notices, waitlist_notices, team_alerts TO backoffice_role;
GRANT DELETE ON waitlist_requests TO backoffice_role;
GRANT INSERT, UPDATE ON config TO backoffice_role;
GRANT SELECT, DELETE ON blocked_hashes TO backoffice_role;
-- Ricerca per email esatta (architettura, "Funzioni"): solo impronte, mai indirizzi
GRANT SELECT (user_id, email_hash, provider, revoked_at) ON personal_identities TO backoffice_role;
GRANT SELECT (email_hash, verified_at, next_reverification_at) ON work_emails TO backoffice_role;
GRANT SELECT (status, close_reason, closed_at, user_a_id, user_b_id, id) ON matches
  TO backoffice_role;
-- Approvazione dei profili (D141): la revisione accolta in un ricorso dopo il terzo rifiuto
GRANT UPDATE (team_alert_at) ON photos TO backoffice_role;

-- ---------------------------------------------------------------------------------------------
-- app_role
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT ON report_contents, appeals TO app_role;
GRANT SELECT ON age_verifications TO app_role;
GRANT UPDATE (storage_key, uploaded_at) ON age_verifications TO app_role;
GRANT SELECT ON store_review_windows TO app_role;
GRANT UPDATE (failed_attempts, closed_at) ON store_review_windows TO app_role;
GRANT SELECT (explanation, severe_case, appeal_deadline_at, appeal_code_hash, report_id,
              created_at) ON sanctions TO app_role;
GRANT INSERT ON user_notices, waitlist_notices TO app_role;

-- ---------------------------------------------------------------------------------------------
-- jobs_role
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  report_contents, appeals, age_verifications, directory_alerts, store_review_windows,
  operator_challenges, user_notices, waitlist_notices, team_alerts
  TO jobs_role;
GRANT SELECT ON backoffice_user_cards TO jobs_role;

-- ---------------------------------------------------------------------------------------------
-- Funzioni con i privilegi del proprietario: solo i ruoli che le usano (le funzioni nascono
-- eseguibili da tutti)
-- ---------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  read_chat(uuid, chat_read_reason, text, timestamptz, timestamptz, uuid, uuid, text),
  chat_key_of(uuid), reveal_email(uuid, text), correct_birth_date(uuid, date),
  moderation_close_match(uuid), moderation_remove_profile_text(uuid, text),
  move_domain(text, uuid), merge_companies(uuid, uuid), remove_domain(text),
  start_company_removal(uuid, int), cancel_company_removal(uuid), finish_company_removal(uuid),
  block_expelled_emails(uuid), reset_demo_data(), purge_audit_log(),
  check_core_rule_consistency(), switch_off_open_space_for_company_change(uuid[]),
  drop_current_company_exclusions(uuid[]), limit_user_sessions(uuid),
  start_reverification(uuid, reverification_reason),
  start_precautionary_suspension(uuid, uuid, uuid), company_accounts_count(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  read_chat(uuid, chat_read_reason, text, timestamptz, timestamptz, uuid, uuid, text),
  reveal_email(uuid, text), correct_birth_date(uuid, date), moderation_close_match(uuid),
  moderation_remove_profile_text(uuid, text), move_domain(text, uuid),
  merge_companies(uuid, uuid), remove_domain(text), start_company_removal(uuid, int),
  cancel_company_removal(uuid), company_accounts_count(uuid)
  TO backoffice_role;
GRANT EXECUTE ON FUNCTION
  chat_key_of(uuid), block_expelled_emails(uuid), reset_demo_data(), limit_user_sessions(uuid),
  start_reverification(uuid, reverification_reason),
  start_precautionary_suspension(uuid, uuid, uuid)
  TO backoffice_role, jobs_role;
GRANT EXECUTE ON FUNCTION
  chat_key_of(uuid), limit_user_sessions(uuid), start_reverification(uuid, reverification_reason),
  start_precautionary_suspension(uuid, uuid, uuid)
  TO app_role;
GRANT EXECUTE ON FUNCTION
  finish_company_removal(uuid), purge_audit_log(), check_core_rule_consistency(),
  company_accounts_count(uuid)
  TO jobs_role;
