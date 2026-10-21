import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { t } from '@/texts';
import { AdminApiError, getAdminApi, type Offsite } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { loadCities } from '../cities';
import { cancelOffsiteAction } from '../actions';
import { OffsiteForm } from '../OffsiteForm';
import { OffsiteStatus, attendees } from '../OffsiteStatus';

const DONE = {
  draft: 'backoffice.offsiteForm.savedDraft',
  saved: 'common.saved',
  published: 'backoffice.offsiteForm.published',
} as const;

/** Offsite salvato: modifica, pubblicazione, copertina e annullamento con l'avviso agli iscritti. */
export default async function OffsitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string | string[] }>;
}) {
  const current = await requireOperator('offsites');
  const { id } = await params;
  const { done } = await searchParams;
  const api = getAdminApi();
  let offsite: Offsite;
  try {
    offsite = await api.getOffsite(current.token, id);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'not_found') notFound();
    throw error;
  }
  const cities = await loadCities(current.token);
  const editable = offsite.status === 'draft' || offsite.status === 'published';
  const doneKey = typeof done === 'string' && done in DONE ? DONE[done as keyof typeof DONE] : null;

  return (
    <ConsoleShell current={current} active="offsites">
      <Link href="/offsites" className="back-link">
        <Icon name="arrowLeft" size={16} />
        <span>{t('backoffice.offsite')}</span>
      </Link>
      <PageHeader
        title={
          <span className="title-with-status">
            <span>{offsite.title}</span>
            <OffsiteStatus offsite={offsite} />
          </span>
        }
        subtitle={`${t('offsite.attendees.label')}: ${attendees(offsite)}`}
        actions={
          editable ? (
            <ActionDialog
              action={cancelOffsiteAction}
              trigger={{ label: t('backoffice.offsites.cancel'), variant: 'outline' }}
              title={t('backoffice.offsites.cancel.title', { title: offsite.title })}
              eyebrow={t('backoffice.removalModal.eyebrow')}
              destructive
              effects={[t('backoffice.offsiteForm.notice'), t('backoffice.offsites.cancel.effect')]}
              hidden={{ offsiteId: offsite.id }}
              submitLabel={t('backoffice.offsites.cancel')}
            />
          ) : null
        }
      />
      {doneKey ? (
        <p className="form-message form-message--success" role="status">
          {t(doneKey)}
        </p>
      ) : null}
      {editable ? (
        <OffsiteForm key={offsite.updatedAt} cities={cities} offsite={offsite} />
      ) : (
        <p className="sheet empty">{t('backoffice.offsites.readOnly')}</p>
      )}
    </ConsoleShell>
  );
}
