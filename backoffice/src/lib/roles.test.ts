import { canOpen, homeFor, roleLabel, sectionsFor } from './roles';

describe('ruoli e voci di menu (D88)', () => {
  it("l'Amministratore vede tutte le voci, nell'ordine dei mockup", () => {
    expect(sectionsFor(['admin']).map((section) => section.id)).toEqual([
      'companies',
      'requests',
      'users',
      'approvals',
      'moderation',
      'appeals',
      'offsites',
      'demo',
      'audit',
      'stats',
      'config',
    ]);
  });

  it('il Moderatore vede approvazioni, moderazione e ricorsi (mockup 18c, D197)', () => {
    expect(sectionsFor(['moderator']).map((section) => section.id)).toEqual([
      'approvals',
      'moderation',
      'appeals',
    ]);
    expect(canOpen(['moderator'], 'companies')).toBe(false);
    expect(canOpen(['moderator'], 'offsites')).toBe(false);
  });

  it('il Supporto vede utenti e ricorsi, non aziende, approvazioni né audit', () => {
    expect(sectionsFor(['support']).map((section) => section.id)).toEqual(['users', 'appeals']);
    expect(canOpen(['support'], 'approvals')).toBe(false);
    expect(canOpen(['support'], 'audit')).toBe(false);
  });

  it('più ruoli sommano le voci; il ruolo mostrato è il più ampio', () => {
    expect(sectionsFor(['moderator', 'support']).map((section) => section.id)).toEqual([
      'users',
      'approvals',
      'moderation',
      'appeals',
    ]);
    expect(roleLabel(['support', 'admin'])).toBe('backoffice.role');
    expect(roleLabel(['moderator'])).toBe('backoffice.moderator');
    expect(roleLabel(['support'])).toBe('backoffice.support');
  });

  it('dopo l’accesso si apre la prima sezione permessa', () => {
    expect(homeFor(['admin'])).toBe('/companies');
    expect(homeFor(['moderator'])).toBe('/approvals');
    expect(homeFor([])).toBe('/login');
  });
});
