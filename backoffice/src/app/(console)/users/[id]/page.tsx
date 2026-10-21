import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { Photo } from '@/components/Photo';
import { Note } from '@/components/ui';
import { ACCOUNT_STATUS, REPORT_REASON, SANCTION } from '@/lib/labels';
import { formatDate } from '@/lib/time';
import { t } from '@/texts';
import { AdminApiError, getAdminApi, type UserDetail } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import {
  deleteUserAction,
  reactivateAction,
  revealEmailAction,
  reverifyAction,
  sanctionAction,
} from '../actions';

/**
 * Scheda dell'utente (D89): stato, azienda, date, foto e testi, segnalazioni e sanzioni, con le
 * email mascherate (D90). Mai "chi ti interessa", aziende escluse, blocchi né Open space (D197).
 * Le azioni seguono i ruoli (D88): Supporto per account e cancellazioni, Amministratore anche per
 * le sanzioni.
 */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireOperator('users');
  const { id } = await params;
  let user: UserDetail;
  try {
    user = await getAdminApi().getUser(current.token, id);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'not_found') notFound();
    throw error;
  }
  const roles = current.operator.roles;
  const now = new Date();
  const canSanction = roles.includes('admin') || roles.includes('moderator');
  const activeSanction = user.sanctions.find(
    (item) =>
      !item.revokedAt && item.type !== 'warning' && (!item.endsAt || new Date(item.endsAt) > now),
  );
  const hidden = { userId: user.id };

  return (
    <ConsoleShell current={current} active="users">
      <Link href="/users" className="back-link">
        <Icon name="arrowLeft" size={16} />
        <span>{t('backoffice.users')}</span>
      </Link>
      <PageHeader
        title={user.firstName ?? t('backoffice.users.noName')}
        subtitle={t('backoffice.users.idLine', { id: user.id })}
      />
      <div className="user-card">
        <section className="sheet panel" aria-labelledby="account-title">
          <h2 id="account-title" className="panel__title">
            {t('backoffice.users.account')}
          </h2>
          <dl className="facts">
            <Fact label={t('backoffice.column.status')}>
              <span className="status status--demo">{t(ACCOUNT_STATUS[user.status])}</span>
              {user.isDemo ? (
                <span className="status status--demo">{t('backoffice.demo')}</span>
              ) : null}
              {activeSanction ? (
                <span className="status status--removing">
                  {t(SANCTION[activeSanction.type])}
                  {activeSanction.endsAt ? (
                    <span className="status__detail">
                      {t('backoffice.users.until', {
                        date: formatDate(new Date(activeSanction.endsAt)),
                      })}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Fact>
            <Fact label={t('backoffice.column.company')}>{user.companyName ?? '—'}</Fact>
            <Fact label={t('backoffice.users.age')}>{user.ageYears ?? '—'}</Fact>
            <Fact label={t('backoffice.users.workEmail')}>
              <span className="mono">{user.maskedWorkEmail ?? '—'}</span>
              {user.maskedWorkEmail ? <RevealButton userId={user.id} kind="work" /> : null}
            </Fact>
            <Fact label={t('backoffice.users.personalEmail')}>
              <span className="mono">{user.maskedPersonalEmail ?? '—'}</span>
              {user.maskedPersonalEmail ? <RevealButton userId={user.id} kind="personal" /> : null}
            </Fact>
            <Fact label={t('backoffice.users.column.created')}>
              {formatDate(new Date(user.createdAt))}
            </Fact>
            <Fact label={t('backoffice.users.approvedAt')}>
              {user.approvedAt ? formatDate(new Date(user.approvedAt)) : '—'}
            </Fact>
            <Fact label={t('backoffice.users.lastActiveAt')}>
              {user.lastActiveAt ? formatDate(new Date(user.lastActiveAt)) : '—'}
            </Fact>
          </dl>
          <Note icon="lock">{t('backoffice.users.limits')}</Note>
        </section>

        <section className="sheet panel" aria-labelledby="profile-title">
          <h2 id="profile-title" className="panel__title">
            {t('backoffice.users.profile')}
          </h2>
          {user.photos.length > 0 ? (
            <ul className="detail__photos">
              {user.photos.map((photo, index) => (
                <li key={photo.id}>
                  <Photo
                    photo={photo}
                    variant="large"
                    label={t('backoffice.approvalQueue.photo', {
                      count: index + 1,
                      total: user.photos.length,
                    })}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="facts">
            <Fact label={t('backoffice.approvalQueue.practiceArea')}>
              {user.practiceArea ?? '—'}
            </Fact>
            <Fact label={t('backoffice.approvalQueue.lookingFor')}>{user.lookingFor ?? '—'}</Fact>
            <Fact label={t('deck.bio')}>{user.bio ?? '—'}</Fact>
          </dl>
        </section>

        <section className="sheet panel" aria-labelledby="reports-title">
          <h2 id="reports-title" className="panel__title">
            {t('backoffice.users.reports')}
          </h2>
          {user.reports.length === 0 ? (
            <p className="empty">{t('backoffice.users.reports.empty')}</p>
          ) : (
            <ul className="list">
              {user.reports.map((report) => (
                <li key={report.id} className="list__item">
                  <span className="list__main">{t(REPORT_REASON[report.reason])}</span>
                  <span className="list__sub">{formatDate(new Date(report.createdAt))}</span>
                  <span
                    className={`status status--${report.status === 'open' ? 'removing' : 'demo'}`}
                  >
                    {t(
                      report.status === 'open'
                        ? 'backoffice.alerts.open'
                        : 'backoffice.alerts.closed',
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="panel__title">{t('backoffice.users.sanctions')}</h2>
          {user.sanctions.length === 0 ? (
            <p className="empty">{t('backoffice.users.sanctions.empty')}</p>
          ) : (
            <ul className="list">
              {user.sanctions.map((sanction) => (
                <li key={sanction.id} className="list__item">
                  <span className="list__main">{t(SANCTION[sanction.type])}</span>
                  <span className="list__sub">
                    {formatDate(new Date(sanction.startsAt))}
                    {sanction.endsAt ? ` – ${formatDate(new Date(sanction.endsAt))}` : ''}
                  </span>
                  {sanction.revokedAt ? (
                    <span className="status status--demo">{t('backoffice.users.revoked')}</span>
                  ) : null}
                  {sanction.appealStatus === 'pending' ? (
                    <span className="status status--removing">
                      {t('backoffice.users.appealPending')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sheet panel" aria-labelledby="actions-title">
          <h2 id="actions-title" className="panel__title">
            {t('backoffice.users.actions')}
          </h2>
          <div className="action-grid">
            {user.status === 'active' ? (
              <ActionDialog
                action={reverifyAction}
                trigger={{ label: t('backoffice.users.reverify') }}
                title={t('backoffice.users.reverify')}
                effects={[t('backoffice.users.reverify.effect')]}
                hidden={hidden}
                submitLabel={t('backoffice.users.reverify')}
              />
            ) : null}
            {activeSanction || user.status === 'suspended' ? (
              <ActionDialog
                action={reactivateAction}
                trigger={{ label: t('backoffice.users.reactivate') }}
                title={t('backoffice.users.reactivate')}
                effects={[t('backoffice.users.reactivate.effect')]}
                hidden={hidden}
                submitLabel={t('backoffice.users.reactivate')}
              />
            ) : null}
            {canSanction ? (
              <ActionDialog
                action={sanctionAction}
                trigger={{ label: t('backoffice.users.sanction') }}
                title={t('backoffice.users.sanction')}
                effects={[t('backoffice.users.sanction.effect')]}
                hidden={hidden}
                choice={{
                  name: 'type',
                  label: t('backoffice.users.sanction.type'),
                  placeholder: t('backoffice.company.chooseTarget'),
                  options: (['warning', 'disciplinary_suspension', 'expulsion'] as const).map(
                    (type) => ({ value: type, label: t(SANCTION[type]) }),
                  ),
                }}
                userText={{
                  label: t('backoffice.users.sanction.userText'),
                  hint: t('backoffice.users.sanction.userText.hint'),
                }}
                destructive
                submitLabel={t('backoffice.users.sanction')}
              />
            ) : null}
            <ActionDialog
              action={deleteUserAction}
              trigger={{
                label: t('backoffice.users.delete'),
                variant: 'destructive',
                icon: 'trash',
              }}
              title={t('backoffice.users.delete.title')}
              eyebrow={t('backoffice.removalModal.eyebrow')}
              destructive
              effects={[t('backoffice.users.delete.effect1'), t('backoffice.users.delete.effect2')]}
              hidden={hidden}
              confirmName={{ label: t('backoffice.users.delete.confirm'), expected: user.id }}
              submitLabel={t('backoffice.users.delete')}
            />
          </div>
        </section>
      </div>
    </ConsoleShell>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="facts__item">
      <dt className="label-caps">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Rivelazione dell'email con motivazione, registrata nell'audit prima di mostrarla (D90). */
function RevealButton({ userId, kind }: { userId: string; kind: 'personal' | 'work' }) {
  return (
    <ActionDialog
      action={revealEmailAction}
      trigger={{ label: t('backoffice.users.reveal'), variant: 'link', icon: 'eye' }}
      title={t(
        kind === 'work' ? 'backoffice.users.reveal.work' : 'backoffice.users.reveal.personal',
      )}
      effects={[t('backoffice.users.reveal.effect')]}
      hidden={{ userId, kind }}
      submitLabel={t('backoffice.users.reveal')}
    />
  );
}
