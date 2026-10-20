import { maskEmail } from './mask-email';

describe('email mascherate (D90)', () => {
  it('lascia solo la prima lettera e il dominio', () => {
    expect(maskEmail('marco.rossi@esempio.example')).toBe('m•••@esempio.example');
  });

  it('non rivela nulla di un indirizzo malformato', () => {
    expect(maskEmail('senza-chiocciola')).toBe('•••');
    expect(maskEmail('@dominio.example')).toBe('•••');
  });
});
