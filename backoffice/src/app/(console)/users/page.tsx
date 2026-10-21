import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { t } from '@/texts';
import { requireOperator } from '@/server/auth';
import { UserSearch } from './UserSearch';

/** Utenti (D89): ricerca e accesso alla scheda. Le email restano mascherate (D90). */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string | string[] }>;
}) {
  const current = await requireOperator('users');
  const { deleted } = await searchParams;
  return (
    <ConsoleShell current={current} active="users">
      <PageHeader title={t('backoffice.users')} subtitle={t('backoffice.users.subtitle')} />
      {deleted ? (
        <p className="form-message form-message--success" role="status">
          {t('backoffice.users.delete.done')}
        </p>
      ) : null}
      <UserSearch />
    </ConsoleShell>
  );
}
