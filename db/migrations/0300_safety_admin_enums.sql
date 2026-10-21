-- Team B3 (D239): sicurezza, moderazione, approvazione e amministrazione. Valori nuovi degli enum
-- esistenti, in una migrazione a parte: PostgreSQL non permette di usare un valore aggiunto con
-- `ALTER TYPE ... ADD VALUE` nella stessa transazione in cui nasce.

-- Azioni dell'audit delle API di amministrazione e degli eventi dei domini di B3 (D89, D91)
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'report_decided';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'sanction_revoked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'account_reactivated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'age_verification_requested';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'precautionary_suspension_started';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'audit_exported';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'waitlist_answered';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'directory_alert_closed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'operator_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'operator_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'review_window_closed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'demo_data_reset';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'content_removed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'removal_completed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'job_completed';
