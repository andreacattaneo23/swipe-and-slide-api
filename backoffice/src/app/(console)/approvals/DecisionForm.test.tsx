import { render, screen } from '@testing-library/react';
import { DecisionForm } from './DecisionForm';

vi.mock('./actions', () => ({ decideApproval: vi.fn(async () => ({ status: 'idle' })) }));

describe('esito della revisione (mockup 18c)', () => {
  it('motivo dall’elenco del contratto, testo per l’utente, motivazione e i due pulsanti', () => {
    render(<DecisionForm reviewId="r-marco" lastAttempt={false} />);
    const reason = screen.getByLabelText('Motivo del rifiuto');
    expect(Array.from((reason as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      'Scegli un motivo',
      'Foto inappropriate',
      'Foto non conforme',
      'Profilo falso',
      'Testi non ammessi',
      "Dati che rivelano l'azienda o i clienti",
      'Altro',
    ]);
    expect(screen.getByLabelText(/Cosa correggere/)).toHaveAttribute('maxlength', '1000');
    expect(screen.getByLabelText(/Motivazione/)).toBeRequired();
    expect(screen.getByRole('button', { name: 'Rifiuta il profilo' })).toHaveAttribute(
      'value',
      'reject',
    );
    expect(screen.getByRole('button', { name: 'Approva il profilo' })).toHaveAttribute(
      'value',
      'approve',
    );
    expect(
      screen.getByText("L'utente vede la motivazione solo nell'app, mai in email o notifiche."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ultimo tentativo/)).not.toBeInTheDocument();
  });

  it('all’ultimo tentativo avvisa del blocco delle email (D142)', () => {
    render(<DecisionForm reviewId="r-davide" lastAttempt />);
    expect(screen.getByText(/Ultimo tentativo/)).toBeInTheDocument();
  });
});
