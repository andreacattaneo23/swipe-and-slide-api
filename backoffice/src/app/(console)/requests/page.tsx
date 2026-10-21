import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Note } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { respondWaitlistAction } from './actions';

/**
 * Richieste di aggiunta (D89, D95): le richieste confermate della lista d'attesa, raggruppate per
 * dominio e mai collegate a utenti dell'app, e gli avvisi aggregati di "Lavora nella mia azienda"
 * (D72), con le sole due aziende.
 */
export default async function RequestsPage() {
  const current = await requireOperator('requests');
  const api = getAdminApi();
  const [groups, alerts] = await Promise.all([
    api.listWaitlist(current.token),
    api.listDirectoryAlerts(current.token),
  ]);

  return (
    <ConsoleShell current={current} active="requests">
      <PageHeader title={t('backoffice.requests')} subtitle={t('backoffice.requests.subtitle')} />
      <div className="sheet table-sheet">
        {groups.length === 0 ? (
          <p className="empty">{t('backoffice.requests.empty')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.company.domain')}</th>
                <th scope="col">{t('backoffice.requests.column.count')}</th>
                <th scope="col">{t('backoffice.requests.column.first')}</th>
                <th scope="col">{t('backoffice.requests.column.last')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('backoffice.requests.respond')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <th scope="row">
                    <span className="domain">{group.domain}</span>
                  </th>
                  <td className="table__number">{formatNumber(group.requestsCount)}</td>
                  <td className="table__number">{formatDate(new Date(group.firstAt))}</td>
                  <td className="table__number">{formatDate(new Date(group.lastAt))}</td>
                  <td className="table__actions">
                    <ActionDialog
                      action={respondWaitlistAction}
                      trigger={{ label: t('backoffice.requests.respond'), variant: 'link' }}
                      title={t('backoffice.requests.respond.title', { domain: group.domain })}
                      effects={[t('backoffice.requests.respond.effect')]}
                      hidden={{ groupId: group.id }}
                      choice={{
                        name: 'outcome',
                        label: t('backoffice.requests.outcome'),
                        placeholder: t('backoffice.company.chooseTarget'),
                        options: [
                          { value: 'added', label: t('backoffice.requests.outcome.added') },
                          { value: 'not_added', label: t('backoffice.requests.outcome.notAdded') },
                        ],
                      }}
                      submitLabel={t('backoffice.requests.respond')}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="sheet panel" aria-labelledby="alerts-title">
        <h2 id="alerts-title" className="panel__title">
          {t('backoffice.alerts.title')}
        </h2>
        <Note icon="lock">{t('backoffice.alerts.note')}</Note>
        {alerts.length === 0 ? (
          <p className="empty">{t('backoffice.alerts.empty')}</p>
        ) : (
          <ul className="list">
            {alerts.map((alert) => (
              <li key={alert.id} className="list__item">
                <span className="list__main">
                  {t('backoffice.alerts.pair', {
                    reporter: alert.reporterCompany,
                    reported: alert.reportedCompany,
                  })}
                </span>
                <span className="list__sub">
                  {t('backoffice.alerts.window', {
                    from: formatDate(new Date(alert.windowStartsAt)),
                    to: formatDate(new Date(alert.windowEndsAt)),
                  })}
                </span>
                <span className={`status status--${alert.status === 'open' ? 'removing' : 'demo'}`}>
                  {t(
                    alert.status === 'open' ? 'backoffice.alerts.open' : 'backoffice.alerts.closed',
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ConsoleShell>
  );
}
