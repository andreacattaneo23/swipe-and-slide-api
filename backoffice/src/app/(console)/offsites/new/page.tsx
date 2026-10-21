import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { t } from '@/texts';
import { requireOperator } from '@/server/auth';
import { loadCities } from '../cities';
import { OffsiteForm } from '../OffsiteForm';

/** Nuovo offsite (mockup 18d, D150): gli offsite si creano solo dal backoffice. */
export default async function NewOffsitePage() {
  const current = await requireOperator('offsites');
  const cities = await loadCities(current.token);
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
      <OffsiteForm cities={cities} />
    </ConsoleShell>
  );
}
