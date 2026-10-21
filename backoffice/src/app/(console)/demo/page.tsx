import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Note } from '@/components/ui';
import { formatDateTime } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { closeWindowAction, openWindowAction, resetDemoAction } from './actions';

const STORE = {
  apple: 'backoffice.demo.store.apple',
  google: 'backoffice.demo.store.google',
} as const;

/**
 * Account dimostrativi per la revisione degli store (D42): separati dagli utenti reali nei due
 * sensi, già approvati; il revisore entra con il codice di revisione di una finestra aperta (al
 * massimo 14 giorni, 10 tentativi), mostrato una sola volta.
 */
export default async function DemoPage() {
  const current = await requireOperator('demo');
  const review = await getAdminApi().getStoreReview(current.token);
  const open = review.windows.find((window) => !window.closedAt);

  return (
    <ConsoleShell current={current} active="demo">
      <PageHeader
        title={t('backoffice.demoAccounts')}
        subtitle={t('backoffice.demo.subtitle')}
        actions={
          open ? null : (
            <ActionDialog
              action={openWindowAction}
              trigger={{ label: t('backoffice.demo.open'), variant: 'primary', icon: 'plus' }}
              title={t('backoffice.demo.open')}
              effects={[t('backoffice.demo.open.effect1'), t('backoffice.demo.open.effect2')]}
              choice={{
                name: 'store',
                label: t('backoffice.demo.store'),
                placeholder: t('backoffice.company.chooseTarget'),
                options: [
                  { value: 'apple', label: t(STORE.apple) },
                  { value: 'google', label: t(STORE.google) },
                ],
              }}
              number={{
                name: 'days',
                label: t('backoffice.demo.days'),
                min: 1,
                max: 14,
                defaultValue: 7,
              }}
              submitLabel={t('backoffice.demo.open')}
            />
          )
        }
      />
      <Note icon="lock">{t('backoffice.demo.note')}</Note>

      <section className="sheet panel" aria-labelledby="windows-title">
        <h2 id="windows-title" className="panel__title">
          {t('backoffice.demo.windows')}
        </h2>
        {review.windows.length === 0 ? (
          <p className="empty">{t('backoffice.demo.windows.empty')}</p>
        ) : (
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.demo.store')}</th>
                <th scope="col">{t('backoffice.demo.openedAt')}</th>
                <th scope="col">{t('backoffice.demo.endsAt')}</th>
                <th scope="col">{t('backoffice.demo.failed')}</th>
                <th scope="col">{t('backoffice.column.status')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('backoffice.users.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {review.windows.map((window) => (
                <tr key={window.id}>
                  <th scope="row">{t(STORE[window.store])}</th>
                  <td className="table__number">{formatDateTime(new Date(window.openedAt))}</td>
                  <td className="table__number">
                    {formatDateTime(new Date(window.closedAt ?? window.endsAt))}
                  </td>
                  <td className="table__number">{window.failedAttempts} / 10</td>
                  <td>
                    <span className={`status status--${window.closedAt ? 'demo' : 'active'}`}>
                      {t(
                        window.closedAt
                          ? 'backoffice.demo.closedStatus'
                          : 'backoffice.demo.openStatus',
                      )}
                    </span>
                  </td>
                  <td className="table__actions">
                    {window.closedAt ? (
                      <ActionDialog
                        action={resetDemoAction}
                        trigger={{ label: t('backoffice.demo.reset'), variant: 'link' }}
                        title={t('backoffice.demo.reset')}
                        effects={[t('backoffice.demo.reset.effect')]}
                        hidden={{ windowId: window.id }}
                        destructive
                        submitLabel={t('backoffice.demo.reset')}
                      />
                    ) : (
                      <ActionDialog
                        action={closeWindowAction}
                        trigger={{ label: t('backoffice.demo.close'), variant: 'link' }}
                        title={t('backoffice.demo.close')}
                        effects={[t('backoffice.demo.close.effect')]}
                        hidden={{ windowId: window.id }}
                        submitLabel={t('backoffice.demo.close')}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sheet panel" aria-labelledby="accounts-title">
        <h2 id="accounts-title" className="panel__title">
          {t('backoffice.demo.accounts')}
        </h2>
        <ul className="list">
          {review.accounts.map((account) => (
            <li key={account.id} className="list__item">
              <span className="list__main">{account.firstName}</span>
              <span className="list__sub">{account.companyName}</span>
              <span className="mono">{account.maskedEmail}</span>
            </li>
          ))}
        </ul>
      </section>
    </ConsoleShell>
  );
}
