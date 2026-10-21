import { render, screen } from '@testing-library/react';
import { SignInForm } from './SignInForm';

vi.mock('./actions', () => ({
  requestCode: vi.fn(),
  verifySignIn: vi.fn(),
  restartSignIn: vi.fn(),
}));

describe("accesso dell'operatore (D88)", () => {
  it('primo passo: email con l’avviso neutro', () => {
    render(<SignInForm step="email" maskedEmail="" />);
    expect(screen.getByRole('heading', { name: 'Accesso al backoffice' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(
      screen.getByText("Se l'indirizzo è di un operatore, riceverai un codice."),
    ).toBeInTheDocument();
  });

  it('secondo passo: solo il codice all’email mascherata (D90, D244)', () => {
    render(<SignInForm step="verify" maskedEmail="a•••@swipeandslide.example" />);
    expect(screen.getByText(/a•••@swipeandslide\.example/)).toBeInTheDocument();
    expect(screen.getByLabelText('Codice di verifica')).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    );
    expect(screen.queryByLabelText('Codice del secondo fattore')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accedi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Ricomincia dall'email" })).toBeInTheDocument();
  });
});
