import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { Icon } from '@/components/Icon';
import { roleLabel, sectionsFor, type SectionId } from '@/lib/roles';
import type { OperatorRole } from '@/lib/roles';
import { t } from '@/texts';
import { signOut } from '@/app/login/actions';

interface SidebarProps {
  roles: OperatorRole[];
  active: SectionId | null;
  /** Numeri accanto alle voci (per esempio i profili in approvazione). */
  counts?: Partial<Record<SectionId, number>>;
}

/** Barra laterale dei mockup 18a–18d: solo le voci permesse dal ruolo (D88). */
export function Sidebar({ roles, active, counts = {} }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <BrandMark />
      </div>
      <span className="pill pill--sand sidebar__name">{t('backoffice.name')}</span>
      <nav aria-label={t('backoffice.nav.label')} className="sidebar__nav">
        <ul>
          {sectionsFor(roles).map((section) => {
            const isActive = section.id === active;
            const count = counts[section.id];
            return (
              <li key={section.id}>
                <Link
                  href={section.href}
                  className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon name={section.icon} size={20} />
                  <span>{t(section.label)}</span>
                  {count ? <span className="nav-item__count">{count}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="sidebar__who">
        <div className="sidebar__role">{t(roleLabel(roles))}</div>
        <form action={signOut}>
          <button type="submit" className="sidebar__sign-out">
            <Icon name="logOut" size={16} />
            <span>{t('backoffice.signOut')}</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
