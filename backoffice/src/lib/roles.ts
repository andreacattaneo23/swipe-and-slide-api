/**
 * Ruoli degli operatori e voci di menu permesse (D88, matrice dei permessi dell'architettura,
 * D197). Il backoffice usa i ruoli solo per mostrare le voci: chi decide è `admin-api`, che legge
 * il ruolo dal database a ogni richiesta (D231).
 */
import type { TextKey } from '@/texts';

export const OPERATOR_ROLES = ['admin', 'moderator', 'support'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export type SectionId =
  | 'companies'
  | 'requests'
  | 'users'
  | 'approvals'
  | 'moderation'
  | 'appeals'
  | 'offsites'
  | 'demo'
  | 'audit'
  | 'stats'
  | 'config';

export type IconName =
  | 'building'
  | 'list'
  | 'users'
  | 'shieldCheck'
  | 'shield'
  | 'scale'
  | 'ticket'
  | 'smartphone'
  | 'lock'
  | 'chart'
  | 'settings';

export interface Section {
  id: SectionId;
  href: string;
  label: TextKey;
  icon: IconName;
  roles: readonly OperatorRole[];
}

/** Ordine della barra laterale dei mockup 18a–18d, con le voci nuove della fase 2 (D239). */
export const SECTIONS: readonly Section[] = [
  {
    id: 'companies',
    href: '/companies',
    label: 'backoffice.companies',
    icon: 'building',
    roles: ['admin'],
  },
  {
    id: 'requests',
    href: '/requests',
    label: 'backoffice.requests',
    icon: 'list',
    roles: ['admin'],
  },
  {
    id: 'users',
    href: '/users',
    label: 'backoffice.users',
    icon: 'users',
    roles: ['admin', 'support'],
  },
  {
    id: 'approvals',
    href: '/approvals',
    label: 'backoffice.approvals',
    icon: 'shieldCheck',
    roles: ['admin', 'moderator'],
  },
  {
    id: 'moderation',
    href: '/moderation',
    label: 'backoffice.moderation',
    icon: 'shield',
    roles: ['admin', 'moderator'],
  },
  {
    id: 'appeals',
    href: '/appeals',
    label: 'backoffice.appeals',
    icon: 'scale',
    // Il Supporto esamina i ricorsi (D88); il Moderatore quelli delle sanzioni decise da altri.
    roles: ['admin', 'moderator', 'support'],
  },
  {
    id: 'offsites',
    href: '/offsites',
    label: 'backoffice.offsite',
    icon: 'ticket',
    roles: ['admin'],
  },
  {
    id: 'demo',
    href: '/demo',
    label: 'backoffice.demoAccounts',
    icon: 'smartphone',
    roles: ['admin'],
  },
  {
    id: 'audit',
    href: '/audit',
    label: 'backoffice.audit',
    icon: 'lock',
    roles: ['admin'],
  },
  {
    id: 'stats',
    href: '/stats',
    label: 'backoffice.stats',
    icon: 'chart',
    roles: ['admin'],
  },
  {
    id: 'config',
    href: '/config',
    label: 'backoffice.config',
    icon: 'settings',
    roles: ['admin'],
  },
];

/** Vero se almeno uno dei ruoli dell'operatore apre la sezione. */
export function canOpen(roles: readonly OperatorRole[], section: SectionId): boolean {
  const found = SECTIONS.find((item) => item.id === section);
  return !!found && found.roles.some((role) => roles.includes(role));
}

/** Voci di menu dell'operatore, nell'ordine dei mockup. */
export function sectionsFor(roles: readonly OperatorRole[]): Section[] {
  return SECTIONS.filter((section) => section.roles.some((role) => roles.includes(role)));
}

/** Prima sezione da aprire dopo l'accesso. */
export function homeFor(roles: readonly OperatorRole[]): string {
  return sectionsFor(roles)[0]?.href ?? '/login';
}

/** Ruolo mostrato in fondo alla barra laterale: il più ampio tra quelli dell'operatore. */
export function roleLabel(roles: readonly OperatorRole[]): TextKey {
  if (roles.includes('admin')) return 'backoffice.role';
  if (roles.includes('moderator')) return 'backoffice.moderator';
  return 'backoffice.support';
}
