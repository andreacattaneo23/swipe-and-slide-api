-- Team B3 (D239): allineamento al contratto del backoffice. Store della finestra di revisione e
-- statistiche con le chiavi del backoffice, sempre con la soglia minima (D89, D197).

CREATE TYPE review_store AS ENUM ('apple', 'google');
ALTER TABLE store_review_windows ADD COLUMN store review_store NOT NULL DEFAULT 'apple';

CREATE OR REPLACE FUNCTION backoffice_stats() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'activeUsers', stats_threshold((SELECT count(*) FROM users
                                     WHERE NOT is_demo AND status IN ('active', 'reverifying'))),
    'pendingApprovals', (SELECT count(*) FROM profile_reviews WHERE outcome = 'pending'),
    'registrations7d', stats_threshold((SELECT count(*) FROM users
                                         WHERE NOT is_demo
                                           AND created_at > now() - interval '7 days')),
    'matches7d', stats_threshold((SELECT count(*) FROM matches m
                                    JOIN users a ON a.id = m.user_a_id
                                   WHERE NOT a.is_demo AND m.created_at > now() - interval '7 days')),
    'reports7d', stats_threshold((SELECT count(*) FROM reports
                                   WHERE NOT is_demo AND created_at > now() - interval '7 days')),
    -- Solo il totale della piattaforma, mai per azienda (D197)
    'openSpaceActive', stats_threshold((SELECT count(*) FROM users
                                         WHERE NOT is_demo AND open_space
                                           AND status IN ('active', 'reverifying'))),
    'companies', (SELECT count(*) FROM companies WHERE status = 'active' AND NOT is_demo),
    'offsitesPublished', (SELECT count(*) FROM offsites WHERE status = 'published' AND NOT is_demo));
$$;

-- Account dimostrativi per la pagina delle finestre di revisione: solo nome, azienda ed email
-- mascherata (D42)
CREATE VIEW backoffice_demo_accounts AS
  SELECT x.id, p.first_name, z.name AS company_name, mask_email(i.email) AS masked_email
    FROM users x
    JOIN companies z ON z.id = x.company_id
    LEFT JOIN profiles p ON p.user_id = x.id
    LEFT JOIN personal_identities i ON i.user_id = x.id AND i.revoked_at IS NULL
   WHERE x.is_demo;
GRANT SELECT ON backoffice_demo_accounts TO backoffice_role;

-- Lettura motivata e copie dei messaggi segnalati (D187): `admin-api` decifra con la custodia della
-- chiave principale (D241); le chiavi dei match restano cifrate, i messaggi non sono leggibili
GRANT SELECT ON chat_keys TO backoffice_role;
