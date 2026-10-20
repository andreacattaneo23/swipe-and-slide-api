import { render, screen } from '@testing-library/react';
import { DecisionForm } from './DecisionForm';

vi.mock('./actions', () => ({ decideApproval: vi.fn(async () => ({ status: 'idle' })) }));

describe('esito della revisione (mockup 18c)', () => {
  it('motivo dall’elenco, motivazione obbligatoria e i due pulsanti', () => {
    render(<DecisionForm reviewId="r-marco" />);
    const reason = screen.getByLabelText('Motivo del rifiuto');
    expect(Array.from((reason as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      'Scegli un motivo',
      'Foto non conforme',
      'Foto inappropriate',
      'Profilo falso',
      'Testi non ammessi',
      "Dati che rivelano l'azienda o i clienti",
    ]);
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
  });
});
