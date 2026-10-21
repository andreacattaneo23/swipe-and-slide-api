import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Note } from '@/components/ui';
import { STAT } from '@/lib/labels';
import { formatDateTime, formatNumber } from '@/lib/time';
import { t } from '@/texts';
import { STAT_KEYS, getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';

/**
 * Statistiche solo aggregate (D89, D197): admin-api applica la soglia e non manda nessun valore
 * sotto le 10 persone, che qui si legge "meno di 10". Nessuna statistica scende alle persone.
 */
export default async function StatsPage() {
  const current = await requireOperator('stats');
  const stats = await getAdminApi().getStats(current.token);
  return (
    <ConsoleShell current={current} active="stats">
      <PageHeader
        title={t('backoffice.stats')}
        subtitle={t('backoffice.stats.subtitle', {
          date: formatDateTime(new Date(stats.generatedAt)),
        })}
      />
      <ul className="stats">
        {STAT_KEYS.map((key) => {
          const value = stats.values[key];
          return (
            <li key={key} className="sheet stat">
              <span className="stat__label">{t(STAT[key])}</span>
              <span className={`stat__value${value === null ? ' stat__value--under' : ''}`}>
                {value === null ? t('backoffice.under10') : formatNumber(value)}
              </span>
            </li>
          );
        })}
      </ul>
      <Note icon="lock">{t('backoffice.stats.note')}</Note>
    </ConsoleShell>
  );
}
