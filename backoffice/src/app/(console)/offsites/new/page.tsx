import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { OffsiteForm } from './OffsiteForm';

/** Nuovo offsite (mockup 18d, D150): gli offsite si creano solo dal backoffice. */
export default async function NewOffsitePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const current = await requireOperator('offsites');
  const { done } = await searchParams;
  const cities = await getAdminApi().listCities(current.token);
  return (
    <ConsoleShell current={current} active="offsites">
      <PageHeader
        title={
          <span className="title-with-status">
            <span>{t('backoffice.offsiteForm.title')}</span>
            <span className="status status--demo">{t('backoffice.offsiteForm.draft')}</span>
          </span>
        }
        subtitle={t('backoffice.offsiteForm.subtitle')}
      />
      {done ? (
        <p className="form-message form-message--success" role="status">
          {t(
            done === 'published'
              ? 'backoffice.offsiteForm.published'
              : 'backoffice.offsiteForm.savedDraft',
          )}
        </p>
      ) : null}
      <OffsiteForm key={done ?? 'new'} cities={cities} />
    </ConsoleShell>
  );
}
