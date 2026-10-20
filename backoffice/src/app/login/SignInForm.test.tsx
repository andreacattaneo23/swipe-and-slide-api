import { render, screen } from '@testing-library/react';
import { SignInForm } from './SignInForm';

vi.mock('./actions', () => ({
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  verifyTotp: vi.fn(),
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

  it('secondo passo: il codice con l’email mascherata (D90)', () => {
    render(<SignInForm step="code" maskedEmail="a•••@swipeandslide.example" />);
    expect(
      screen.getByText('Abbiamo inviato un codice di 6 cifre a a•••@swipeandslide.example.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Codice di verifica, 6 cifre' })).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    );
  });

  it('terzo passo: il secondo fattore', () => {
    render(<SignInForm step="totp" maskedEmail="" />);
    expect(screen.getByLabelText('Codice del secondo fattore')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Accedi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Ricomincia dall'email" })).toBeInTheDocument();
  });
});
