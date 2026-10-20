import { notFound } from 'next/navigation';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { SECTIONS } from '@/lib/roles';
import { t } from '@/texts';
import { requireOperator } from '@/server/auth';

/** Sezioni del menu non ancora realizzate in questa fase (utenti, moderazione, audit, …). */
export default async function PendingSection({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const section = SECTIONS.find((item) => !item.ready && item.href === `/${slug}`);
  if (!section) notFound();
  const current = await requireOperator(section.id);
  return (
    <ConsoleShell current={current} active={section.id}>
      <PageHeader title={t(section.label)} subtitle={t('backoffice.placeholder')} />
    </ConsoleShell>
  );
}
