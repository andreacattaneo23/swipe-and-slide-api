import Link from 'next/link';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { Photo } from '@/components/Photo';
import { alertKey, dueLabel, isNearDue, waitingLabel } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi, type ApprovalDetail, type ApprovalSummary } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { DecisionForm } from './DecisionForm';

type Params = { review?: string | string[]; tab?: string | string[]; done?: string | string[] };
const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

/** Coda delle approvazioni dei profili (mockup 18c, D141–D144): prima i più vecchi. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const current = await requireOperator('approvals');
  const params = await searchParams;
  const tab = first(params.tab) === 'photos' ? 'photos' : 'profiles';
  const done = first(params.done);
  const api = getAdminApi();
  const queue = await api.getApprovalQueue(current.token);
  const selectedId = first(params.review) ?? queue.profiles[0]?.id;
  const selected =
    tab === 'profiles' && selectedId ? await loadDetail(current.token, selectedId) : null;
  const now = new Date();

  return (
    <ConsoleShell current={current} active="approvals" mainClassName="console__main--approvals">
      <PageHeader
        title={t('backoffice.approvalQueue.title')}
        subtitle={t('backoffice.approvalQueue.subtitle')}
      />
      <div className="toolbar toolbar--spread">
        <nav className="tabs" aria-label={t('backoffice.approvalQueue.title')}>
          <Link
            href="/approvals"
            className={`tabs__tab${tab === 'profiles' ? ' tabs__tab--active' : ''}`}
            aria-current={tab === 'profiles' ? 'page' : undefined}
          >
            <span>{t('backoffice.approvalQueue.profiles')}</span>
            <b>{queue.profilesCount}</b>
          </Link>
          <Link
            href="/approvals?tab=photos"
            className={`tabs__tab${tab === 'photos' ? ' tabs__tab--active' : ''}`}
            aria-current={tab === 'photos' ? 'page' : undefined}
          >
            <span>{t('backoffice.approvalQueue.photos')}</span>
            <b>{queue.photosCount}</b>
          </Link>
        </nav>
        <p className="toolbar__order">
          <Icon name="list" />
          <span>{t('backoffice.approvalQueue.order')}</span>
        </p>
      </div>
      {done ? (
        <p className="form-message form-message--success" role="status">
          {t(
            done === 'approved'
              ? 'backoffice.approvalQueue.approved'
              : 'backoffice.approvalQueue.rejected',
          )}
        </p>
      ) : null}
      {tab === 'photos' ? (
        <p className="sheet empty">{t('backoffice.placeholder')}</p>
      ) : queue.profiles.length === 0 ? (
        <p className="sheet empty">{t('backoffice.approvalQueue.empty')}</p>
      ) : (
        <div className="approvals">
          <ul className="sheet queue">
            {queue.profiles.map((item) => (
              <QueueItem key={item.id} item={item} now={now} selected={item.id === selected?.id} />
            ))}
          </ul>
          {selected ? (
            <Detail detail={selected} now={now} />
          ) : (
            <p className="sheet empty">{t('backoffice.approvalQueue.select')}</p>
          )}
        </div>
      )}
    </ConsoleShell>
  );
}

async function loadDetail(token: string, id: string): Promise<ApprovalDetail | null> {
  try {
    return await getAdminApi().getApproval(token, id);
  } catch {
    return null;
  }
}

function QueueItem({
  item,
  now,
  selected,
}: {
  item: ApprovalSummary;
  now: Date;
  selected: boolean;
}) {
  const submitted = new Date(item.submittedAt);
  return (
    <li>
      <Link
        href={`/approvals?review=${encodeURIComponent(item.id)}`}
        className={`queue__item${selected ? ' queue__item--selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
      >
        <Photo photo={item.photo} variant="avatar" />
        <span className="queue__text">
          <span className="queue__line">
            <span className="queue__name">
              {t('backoffice.approvalQueue.nameAge', { name: item.name, age: item.age })}
            </span>
            <span className={`queue__due${isNearDue(submitted, now) ? ' queue__due--near' : ''}`}>
              <Icon name="clock" size={15} />
              <span>{dueLabel(new Date(item.dueAt), now)}</span>
            </span>
          </span>
          <span className="queue__sub">
            {waitingLabel(submitted, now)} ·{' '}
            {t('backoffice.approvalQueue.attemptOf', {
              attempt: item.attempt,
              total: item.maxAttempts,
            })}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Detail({ detail, now }: { detail: ApprovalDetail; now: Date }) {
  const alert = alertKey(new Date(detail.submittedAt), now);
  return (
    <section className="sheet detail" aria-labelledby="detail-name">
      <div className="detail__head">
        <div className="detail__who">
          <h2 id="detail-name" className="detail__name">
            {t('backoffice.approvalQueue.nameAge', { name: detail.name, age: detail.age })}
          </h2>
          <span className="pill pill--sand">
            {t('backoffice.approvalQueue.attemptOf.title', {
              attempt: detail.attempt,
              total: detail.maxAttempts,
            })}
          </span>
        </div>
        {alert ? (
          <p className="detail__alert">
            <Icon name="bell" size={16} />
            <span>{t(alert)}</span>
          </p>
        ) : null}
      </div>
      <h3 className="label-caps">{t('backoffice.approvalQueue.photos.label')}</h3>
      <ul className="detail__photos">
        {detail.photos.map((photo, index) => (
          <li key={photo.id}>
            <Photo
              photo={photo}
              variant="large"
              label={t('backoffice.approvalQueue.photo', {
                count: index + 1,
                total: detail.photos.length,
              })}
            />
          </li>
        ))}
      </ul>
      <dl className="detail__fields">
        {detail.practiceArea ? (
          <div>
            <dt className="label-caps">{t('backoffice.approvalQueue.practiceArea')}</dt>
            <dd>{detail.practiceArea}</dd>
          </div>
        ) : null}
        {detail.lookingFor ? (
          <div>
            <dt className="label-caps">{t('backoffice.approvalQueue.lookingFor')}</dt>
            <dd>{detail.lookingFor}</dd>
          </div>
        ) : null}
        {detail.bio ? (
          <div className="detail__wide">
            <dt className="label-caps">{t('deck.bio')}</dt>
            <dd className="detail__bio">{detail.bio}</dd>
          </div>
        ) : null}
      </dl>
      <p className="note">
        <Icon name="lock" size={16} />
        <span>{t('backoffice.approvalQueue.limits')}</span>
      </p>
      <DecisionForm key={detail.id} reviewId={detail.id} />
    </section>
  );
}
