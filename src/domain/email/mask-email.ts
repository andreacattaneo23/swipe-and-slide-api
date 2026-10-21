/**
 * Email mascherata (D90), uguale alla funzione SQL `mask_email`: prima lettera, dominio
 * abbreviato ed estensione, per esempio `m***@a***.it`.
 */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '***';
  const tld = /\.([^.]+)$/.exec(domain)?.[1];
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***${tld ? `.${tld}` : ''}`;
}
