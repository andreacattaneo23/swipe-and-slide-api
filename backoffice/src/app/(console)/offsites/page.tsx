import Link from 'next/link';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { formatDateTime } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { loadCities } from './cities';
import { OffsiteStatus, attendees } from './OffsiteStatus';

/**
 * Offsite (D150, D197): elenco con stato e numero di iscritti arrotondato (D153, D167), mai chi è
 * iscritto. Da qui si crea un offsite nuovo o si apre quello da modificare o annullare.
 */
export default async function OffsitesPage() {
  const current = await requireOperator('offsites');
  const api = getAdminApi();
  const [offsites, cities] = await Promise.all([
    api.listOffsites(current.token),
    loadCities(current.token),
  ]);
  const cityName = (id: string) => cities.find((city) => city.id === id)?.name ?? '—';
  return (
    <ConsoleShell current={current} active="offsites">
      <PageHeader
        title={t('backoffice.offsite')}
        subtitle={t('backoffice.offsiteForm.subtitle')}
        actions={
          <Link href="/offsites/new" className="button button--primary">
            <Icon name="plus" />
            <span>{t('backoffice.offsiteForm.title')}</span>
          </Link>
        }
      />
      <div className="sheet table-sheet">
        {offsites.length === 0 ? (
          <p className="empty">{t('backoffice.offsites.empty')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.offsiteForm.field.title')}</th>
                <th scope="col">{t('backoffice.offsiteForm.field.city')}</th>
                <th scope="col">{t('backoffice.offsiteForm.field.date')}</th>
                <th scope="col">{t('backoffice.column.status')}</th>
                <th scope="col">{t('offsite.attendees.label')}</th>
              </tr>
            </thead>
            <tbody>
              {offsites.map((offsite) => (
                <tr key={offsite.id}>
                  <th scope="row" className="table__name">
                    <Link href={`/offsites/${encodeURIComponent(offsite.id)}`}>
                      {offsite.title}
                    </Link>
                    {offsite.isDemo ? (
                      <span className="status status--demo">{t('backoffice.demo')}</span>
                    ) : null}
                  </th>
                  <td>{cityName(offsite.cityId)}</td>
                  <td className="table__number">{formatDateTime(new Date(offsite.startsAt))}</td>
                  <td>
                    <OffsiteStatus offsite={offsite} />
                  </td>
                  <td>{attendees(offsite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ConsoleShell>
  );
}
