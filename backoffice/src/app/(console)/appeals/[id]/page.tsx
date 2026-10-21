import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { Note } from '@/components/ui';
import { appealSubject } from '@/lib/labels';
import { formatDate, timeLeftLabel } from '@/lib/time';
import { t } from '@/texts';
import { AdminApiError, getAdminApi, type Appeal } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { decideAppealAction } from '../actions';

/** Ricorso: decisione contestata e testo della persona; decide chi non ha deciso la sanzione (D197). */
export default async function AppealPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireOperator('appeals');
  const { id } = await params;
  let appeal: Appeal;
  try {
    appeal = await getAdminApi().getAppeal(current.token, id);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'not_found') notFound();
    throw error;
  }
  const canOpenUser = current.operator.roles.some((role) => role === 'admin' || role === 'support');
  return (
    <ConsoleShell current={current} active="appeals">
      <Link href="/appeals" className="back-link">
        <Icon name="arrowLeft" size={16} />
        <span>{t('backoffice.appeals')}</span>
      </Link>
      <PageHeader
        title={appealSubject(appeal.subject)}
        subtitle={t('backoffice.appeals.line', {
          date: formatDate(new Date(appeal.submittedAt)),
          due: timeLeftLabel(new Date(appeal.dueAt), new Date()),
        })}
        actions={
          appeal.canDecide ? (
            <ActionDialog
              action={decideAppealAction}
              trigger={{ label: t('backoffice.appeals.decide'), variant: 'primary' }}
              title={t('backoffice.appeals.decide')}
              effects={[t('backoffice.appeals.decide.effect')]}
              hidden={{ appealId: appeal.id }}
              choice={{
                name: 'outcome',
                label: t('backoffice.appeals.outcome'),
                placeholder: t('backoffice.company.chooseTarget'),
                options: [
                  { value: 'upheld', label: t('backoffice.appeals.upheld') },
                  { value: 'rejected', label: t('backoffice.appeals.rejected') },
                ],
              }}
              submitLabel={t('backoffice.appeals.decide')}
            />
          ) : null
        }
      />
      {!appeal.canDecide ? (
        <p className="form-message form-message--error" role="status">
          {t('backoffice.appeals.sameOperator')}
        </p>
      ) : null}
      <div className="user-card">
        <section className="sheet panel" aria-labelledby="decision-title">
          <h2 id="decision-title" className="panel__title">
            {t('backoffice.appeals.decision')}
          </h2>
          <p className="list__sub">{formatDate(new Date(appeal.decidedAt))}</p>
          <p className="panel__body">{appeal.decisionExplanation ?? '—'}</p>
          {appeal.userId && canOpenUser ? (
            <Link
              href={`/users/${encodeURIComponent(appeal.userId)}`}
              className="button button--link"
            >
              {t('backoffice.moderation.openUser')}
            </Link>
          ) : null}
        </section>
        <section className="sheet panel" aria-labelledby="text-title">
          <h2 id="text-title" className="panel__title">
            {t('backoffice.appeals.text')}
          </h2>
          <p className="detail__bio">{appeal.text}</p>
          <Note icon="info">{t('backoffice.appeals.note')}</Note>
        </section>
      </div>
    </ConsoleShell>
  );
}
