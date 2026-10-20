import { render, screen, within } from '@testing-library/react';
import { Sidebar } from './Sidebar';

vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('barra laterale', () => {
  it("l'Amministratore vede tutte le voci e la voce attiva è annunciata", () => {
    render(<Sidebar roles={['admin']} active="companies" counts={{ approvals: 12 }} />);
    const nav = screen.getByRole('navigation', { name: 'Sezioni del backoffice' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Aziende',
      'Richieste di aggiunta',
      'Utenti',
      'Approvazioni12',
      'Moderazione',
      'Offsite',
      'Audit',
      'Statistiche',
      'Configurazione',
    ]);
    expect(within(nav).getByRole('link', { name: 'Aziende' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Amministratore')).toBeInTheDocument();
    expect(screen.getByText('Secondo fattore attivo')).toBeInTheDocument();
  });

  it('il Moderatore vede solo le sue voci (mockup 18c)', () => {
    render(<Sidebar roles={['moderator']} active="approvals" />);
    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/approvals', '/moderation']);
    expect(screen.getByText('Moderatore')).toBeInTheDocument();
  });
});
