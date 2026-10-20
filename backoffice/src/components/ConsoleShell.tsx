import type { ReactNode } from 'react';
import { canOpen, type SectionId } from '@/lib/roles';
import { getAdminApi } from '@/server/admin-api';
import type { CurrentOperator } from '@/server/auth';
import { Sidebar } from './Sidebar';

/**
 * Impaginazione delle pagine del backoffice: barra laterale e contenuto. Il numero dei profili in
 * approvazione si chiede solo a chi apre la coda.
 */
export async function ConsoleShell({
  current,
  active,
  children,
  mainClassName,
}: {
  current: CurrentOperator;
  active: SectionId | null;
  children: ReactNode;
  mainClassName?: string;
}) {
  const counts: Partial<Record<SectionId, number>> = {};
  if (canOpen(current.operator.roles, 'approvals')) {
    try {
      counts.approvals = (await getAdminApi().getApprovalQueue(current.token)).profilesCount;
    } catch {
      // Il numero è solo un aiuto: senza, la barra laterale resta utilizzabile.
    }
  }
  return (
    <div className="console">
      <Sidebar roles={current.operator.roles} active={active} counts={counts} />
      <main className={['console__main', mainClassName].filter(Boolean).join(' ')} id="main">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
