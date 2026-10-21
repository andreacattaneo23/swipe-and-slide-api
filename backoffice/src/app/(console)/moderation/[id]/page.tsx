import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { Photo } from '@/components/Photo';
import { Note } from '@/components/ui';
import { ACCOUNT_STATUS, CASE_DECISION, REPORT_REASON } from '@/lib/labels';
import { formatDateTime, timeLeftLabel } from '@/lib/time';
import { t } from '@/texts';
import {
  AdminApiError,
  CASE_DECISIONS,
  getAdminApi,
  type ModerationCase,
} from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { decideCaseAction } from '../actions';

/**
 * Caso di moderazione: la persona segnalata con foto e testi, le segnalazioni con il motivo e i
 * soli messaggi allegati da chi ha segnalato (D187), mai il resto della chat né chi ha segnalato
 * (D71). La decisione apre una finestra con la motivazione.
 */
export default async function ModerationCasePage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireOperator('moderation');
  const { id } = await params;
  let found: ModerationCase;
  try {
    found = await getAdminApi().getModerationCase(current.token, id);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'not_found') notFound();
    throw error;
  }
  const now = new Date();
  const title =
    found.kind === 'photo'
      ? t('backoffice.moderation.kind.photo')
      : found.reason
        ? t(REPORT_REASON[found.reason])
        : t('backoffice.moderation.kind.report');

  return (
    <ConsoleShell current={current} active="moderation">
      <Link href="/moderation" className="back-link">
        <Icon name="arrowLeft" size={16} />
        <span>{t('backoffice.moderation')}</span>
      </Link>
      <PageHeader
        title={title}
        subtitle={t('backoffice.moderation.caseLine', {
          due: timeLeftLabel(new Date(found.dueAt), now),
          severity: t(
            found.severity === 'severe'
              ? 'backoffice.moderation.severe'
              : 'backoffice.moderation.standard',
          ),
        })}
        actions={
          <ActionDialog
            action={decideCaseAction}
            trigger={{ label: t('backoffice.moderation.decide'), variant: 'primary' }}
            title={t('backoffice.moderation.decide')}
            effects={[t('backoffice.moderation.decide.effect')]}
            hidden={{ caseId: found.id }}
            choice={{
              name: 'decision',
              label: t('backoffice.moderation.decision'),
              placeholder: t('backoffice.company.chooseTarget'),
              options: CASE_DECISIONS.map((decision) => ({
                value: decision,
                label: t(CASE_DECISION[decision]),
              })),
            }}
            userText={{
              label: t('backoffice.users.sanction.userText'),
              hint: t('backoffice.moderation.userText.hint'),
            }}
            submitLabel={t('backoffice.moderation.decide')}
          />
        }
      />
      <div className="user-card">
        <section className="sheet panel" aria-labelledby="subject-title">
          <h2 id="subject-title" className="panel__title">
            {t('backoffice.moderation.subject')}
          </h2>
          <p className="panel__body">
            {found.subject.firstName ?? t('backoffice.users.noName')}
            {found.subject.ageYears ? `, ${found.subject.ageYears}` : ''} ·{' '}
            {t(ACCOUNT_STATUS[found.subject.status])} ·{' '}
            {t('backoffice.moderation.priorSanctions', { count: found.priorSanctions })}
          </p>
          {found.photo ? (
            <div className="detail__photos">
              <Photo
                photo={found.photo}
                variant="large"
                label={t('backoffice.moderation.kind.photo')}
              />
            </div>
          ) : found.subject.photos.length > 0 ? (
            <ul className="detail__photos">
              {found.subject.photos.map((photo, index) => (
                <li key={photo.id}>
                  <Photo
                    photo={photo}
                    variant="large"
                    label={t('backoffice.approvalQueue.photo', {
                      count: index + 1,
                      total: found.subject.photos.length,
                    })}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {found.subject.bio ? <p className="detail__bio">{found.subject.bio}</p> : null}
          {current.operator.roles.some((role) => role === 'admin' || role === 'support') ? (
            <Link
              href={`/users/${encodeURIComponent(found.subject.userId)}`}
              className="button button--link"
            >
              {t('backoffice.moderation.openUser')}
            </Link>
          ) : null}
        </section>

        {found.reports.length > 0 ? (
          <section className="sheet panel" aria-labelledby="reports-title">
            <h2 id="reports-title" className="panel__title">
              {t('backoffice.users.reports')}
            </h2>
            <Note icon="lock">{t('backoffice.moderation.anonymous')}</Note>
            <ul className="list">
              {found.reports.map((report, index) => (
                <li key={index} className="list__item">
                  <span className="list__main">{t(REPORT_REASON[report.reason])}</span>
                  <span className="list__sub">{formatDateTime(new Date(report.createdAt))}</span>
                  {report.note ? <span className="list__note">{report.note}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {found.flaggedMessages.length > 0 ? (
          <section className="sheet panel" aria-labelledby="messages-title">
            <h2 id="messages-title" className="panel__title">
              {t('backoffice.moderation.messages')}
            </h2>
            <Note icon="lock">{t('backoffice.moderation.messages.note')}</Note>
            <ol className="messages">
              {found.flaggedMessages.map((message) => (
                <li
                  key={message.id}
                  className={`message${message.fromReported ? ' message--reported' : ''}`}
                >
                  <span className="message__who">
                    {t(
                      message.fromReported
                        ? 'backoffice.moderation.messages.reported'
                        : 'backoffice.moderation.messages.reporter',
                    )}{' '}
                    · {formatDateTime(new Date(message.sentAt))}
                  </span>
                  <span className="message__text">{message.text}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
