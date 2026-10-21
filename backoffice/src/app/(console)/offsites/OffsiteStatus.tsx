import { OFFSITE_STATUS } from '@/lib/labels';
import { t } from '@/texts';
import type { Offsite } from '@/server/admin-api/types';

/** Stato dell'offsite: bozza, pubblicato, annullato, concluso (D197). */
export function OffsiteStatus({ offsite }: { offsite: Offsite }) {
  const tone =
    offsite.status === 'published'
      ? 'active'
      : offsite.status === 'cancelled'
        ? 'removing'
        : 'demo';
  return <span className={`status status--${tone}`}>{t(OFFSITE_STATUS[offsite.status])}</span>;
}

/** Iscritti arrotondati come nell'app: "meno di 10" o "più di 30" (D167, D197). */
export function attendees(offsite: Offsite): string {
  return offsite.attendeesRounded
    ? t('offsite.attendees.over', { count: offsite.attendeesRounded })
    : t('offsite.under10');
}
