import Link from 'next/link';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { appealSubject } from '@/lib/labels';
import { formatDate, timeLeftLabel } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';

/** Ricorsi (D75, D142): uno per sanzione o per il blocco dopo il terzo rifiuto, risposta in 7 giorni. */
export default async function AppealsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string | string[] }>;
}) {
  const current = await requireOperator('appeals');
  const { done } = await searchParams;
  const appeals = await getAdminApi().listAppeals(current.token);
  const now = new Date();
  return (
    <ConsoleShell current={current} active="appeals">
      <PageHeader title={t('backoffice.appeals')} subtitle={t('backoffice.appeals.subtitle')} />
      {done ? (
        <p className="form-message form-message--success" role="status">
          {t('backoffice.appeals.decided')}
        </p>
      ) : null}
      <div className="sheet table-sheet">
        {appeals.length === 0 ? (
          <p className="empty">{t('backoffice.appeals.empty')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.appeals.column.subject')}</th>
                <th scope="col">{t('backoffice.appeals.column.submitted')}</th>
                <th scope="col">{t('backoffice.moderation.column.due')}</th>
              </tr>
            </thead>
            <tbody>
              {appeals.map((appeal) => (
                <tr key={appeal.id}>
                  <th scope="row" className="table__name">
                    <Link href={`/appeals/${encodeURIComponent(appeal.id)}`}>
                      {appealSubject(appeal.subject)}
                    </Link>
                  </th>
                  <td className="table__number">{formatDate(new Date(appeal.submittedAt))}</td>
                  <td>
                    <span className="queue__due">
                      <Icon name="clock" size={15} />
                      <span>{timeLeftLabel(new Date(appeal.dueAt), now)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ConsoleShell>
  );
}
