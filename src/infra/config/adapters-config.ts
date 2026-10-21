// Configurazione dei servizi esterni (D239, D240, D241): nulla di simulato. Avvisi al team e
// Cloudflare Access davanti ad `admin-api`. Archivio S3 e controllo delle foto sono in
// `AppConfig.storage` e `AppConfig.visionCredentials`, la custodia della chiave dei messaggi in
// `FeedChatConfig` (`KEY_CUSTODY`, `MESSAGE_MASTER_KEY`).

export interface AdapterConfig {
  /** Casella del team per gli avvisi con i soli conteggi (approvazioni, moderazione). */
  teamAlertEmail: string | null;
  /**
   * Cloudflare Access davanti ad `admin-api` (D241): dominio del team e AUD dell'applicazione.
   * `null` solo con `CF_ACCESS_DISABLED=true` fuori dalla produzione.
   */
  cfAccess: { teamDomain: string; audience: string } | null;
}

export function loadAdapterConfig(
  env: NodeJS.ProcessEnv,
  _defaults: { fallbackSecret: string },
): AdapterConfig {
  const production = env.NODE_ENV === 'production';
  return {
    teamAlertEmail: env.TEAM_ALERT_EMAIL || null,
    cfAccess: loadCfAccess(env, production),
  };
}

/**
 * Identità di servizio del backoffice verso `admin-api` (D241): JWT di Cloudflare Access. La
 * verifica si spegne solo con `CF_ACCESS_DISABLED=true` e mai in produzione; senza
 * configurazione il servizio di amministrazione non parte (lo controlla `OperatorGuard`).
 */
function loadCfAccess(
  env: NodeJS.ProcessEnv,
  production: boolean,
): { teamDomain: string; audience: string } | null {
  if (env.CF_ACCESS_DISABLED === 'true') {
    if (production) throw new Error('CF_ACCESS_DISABLED non è ammesso in produzione');
    return null;
  }
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const audience = env.CF_ACCESS_AUD ?? '';
  if (!teamDomain || !audience) {
    // Configurazione mancante: si segnala all'avvio del servizio di amministrazione
    return { teamDomain: '', audience: '' };
  }
  return { teamDomain, audience };
}
