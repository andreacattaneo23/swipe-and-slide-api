/**
 * Maschera un indirizzo email (D90): resta la prima lettera della parte locale e il dominio.
 * Il backoffice non mostra mai un'email in chiaro; la rivelazione passa da `admin-api` con
 * motivazione e audit.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}•••@${domain}`;
}
