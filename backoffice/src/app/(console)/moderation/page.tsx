import Link from 'next/link';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { REPORT_REASON } from '@/lib/labels';
import { formatDateTime, timeLeftLabel } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';

/**
 * Coda della moderazione (D74): segnalazioni e foto da rivedere, prima le scadenze più vicine;
 * 24 ore per i casi gravi (minori, minacce, contenuti illegali), 72 per gli altri.
 */
export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string | string[] }>;
}) {
  const current = await requireOperator('moderation');
  const { done } = await searchParams;
  const cases = await getAdminApi().getModerationQueue(current.token);
  const now = new Date();
  return (
    <ConsoleShell current={current} active="moderation">
      <PageHeader
        title={t('backoffice.moderation')}
        subtitle={t('backoffice.moderation.subtitle')}
      />
      {done ? (
        <p className="form-message form-message--success" role="status">
          {t('backoffice.moderation.decided')}
        </p>
      ) : null}
      <div className="sheet table-sheet">
        {cases.length === 0 ? (
          <p className="empty">{t('backoffice.moderation.empty')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.moderation.column.case')}</th>
                <th scope="col">{t('backoffice.moderation.column.severity')}</th>
                <th scope="col">{t('backoffice.moderation.column.reports')}</th>
                <th scope="col">{t('backoffice.moderation.column.created')}</th>
                <th scope="col">{t('backoffice.moderation.column.due')}</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((item) => {
                const left = Date.parse(item.dueAt) - now.getTime();
                return (
                  <tr key={item.id}>
                    <th scope="row" className="table__name">
                      <Link href={`/moderation/${encodeURIComponent(item.id)}`}>
                        {item.kind === 'photo'
                          ? t('backoffice.moderation.kind.photo')
                          : item.reason
                            ? t(REPORT_REASON[item.reason])
                            : t('backoffice.moderation.kind.report')}
                      </Link>
                    </th>
                    <td>
                      <span
                        className={`status status--${item.severity === 'severe' ? 'removing' : 'demo'}`}
                      >
                        {t(
                          item.severity === 'severe'
                            ? 'backoffice.moderation.severe'
                            : 'backoffice.moderation.standard',
                        )}
                      </span>
                    </td>
                    <td className="table__number">{item.reportsCount}</td>
                    <td className="table__number">{formatDateTime(new Date(item.createdAt))}</td>
                    <td>
                      <span
                        className={`queue__due${left < 6 * 3_600_000 ? ' queue__due--near' : ''}`}
                      >
                        <Icon name="clock" size={15} />
                        <span>{timeLeftLabel(new Date(item.dueAt), now)}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ConsoleShell>
  );
}
