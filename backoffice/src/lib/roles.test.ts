import { canOpen, homeFor, roleLabel, sectionsFor } from './roles';

describe('ruoli e voci di menu (D88)', () => {
  it("l'Amministratore vede tutte le voci, nell'ordine dei mockup", () => {
    expect(sectionsFor(['admin']).map((section) => section.id)).toEqual([
      'companies',
      'requests',
      'users',
      'approvals',
      'moderation',
      'offsites',
      'audit',
      'stats',
      'config',
    ]);
  });

  it('il Moderatore vede solo approvazioni e moderazione (mockup 18c)', () => {
    expect(sectionsFor(['moderator']).map((section) => section.id)).toEqual([
      'approvals',
      'moderation',
    ]);
    expect(canOpen(['moderator'], 'companies')).toBe(false);
    expect(canOpen(['moderator'], 'offsites')).toBe(false);
  });

  it('il Supporto vede gli utenti, non aziende, approvazioni né audit', () => {
    expect(sectionsFor(['support']).map((section) => section.id)).toEqual(['users']);
    expect(canOpen(['support'], 'approvals')).toBe(false);
    expect(canOpen(['support'], 'audit')).toBe(false);
  });

  it('più ruoli sommano le voci; il ruolo mostrato è il più ampio', () => {
    expect(sectionsFor(['moderator', 'support']).map((section) => section.id)).toEqual([
      'users',
      'approvals',
      'moderation',
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
