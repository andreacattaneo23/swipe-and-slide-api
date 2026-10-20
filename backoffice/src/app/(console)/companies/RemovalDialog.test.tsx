import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RemovalDialog } from './CompanyActions';

vi.mock('./actions', () => ({
  loadRemovalPreview: vi.fn(async () => ({
    companyId: 'c-fictional',
    name: 'Studio Fittizio',
    domains: ['studiofittizio.example', 'fittizio.example'],
    accountsCount: 37,
  })),
  startRemovalAction: vi.fn(async () => ({ status: 'idle' })),
  cancelRemovalAction: vi.fn(async () => ({ status: 'idle' })),
}));

describe('finestra di rimozione con conferma rafforzata (mockup 18b, D93)', () => {
  it('mostra anteprima ed effetti; conferma solo con il nome esatto', async () => {
    const user = userEvent.setup();
    render(
      <RemovalDialog open onClose={() => {}} companyId="c-fictional" name="Studio Fittizio" />,
    );
    expect(screen.getByRole('dialog', { name: 'Rimuovi Studio Fittizio' })).toBeInTheDocument();
    expect(await screen.findByText('37 account coinvolti')).toBeInTheDocument();
    expect(screen.getByText('studiofittizio.example · fittizio.example')).toBeInTheDocument();
    expect(screen.getByText(/Dopo 24 ore gli account si cancellano/)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: "Rimuovi l'azienda" });
    expect(confirm).toBeDisabled();
    const name = screen.getByLabelText("Per confermare, digita il nome dell'azienda");
    await user.type(name, 'studio fittizio');
    expect(confirm).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'Studio Fittizio');
    expect(confirm).toBeEnabled();
    expect(screen.getByLabelText('Codice del secondo fattore')).toBeRequired();
    expect(screen.getByLabelText(/Motivazione/)).toBeRequired();
  });
});
