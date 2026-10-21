import { maskEmail } from './mask-email';

describe('maskEmail (D90)', () => {
  it('lascia la prima lettera, il dominio abbreviato e l’estensione', () => {
    expect(maskEmail('mario.rossi@azienda.it')).toBe('m***@a***.it');
    expect(maskEmail('a@b.example')).toBe('a***@b***.example');
  });

  it('non rivela nulla di un indirizzo non valido', () => {
    expect(maskEmail('senza-chiocciola')).toBe('***');
  });
});
