import { isDisposable, isPersonalProvider, normalizeEmail } from './email-address';

describe('normalizeEmail (RC-04)', () => {
  it('toglie maiuscole, spazi e punto finale', () => {
    expect(normalizeEmail('  Luca.Conti@Modello-Partners.IT. ')).toEqual({
      email: 'luca.conti@modello-partners.it',
      local: 'luca.conti',
      domain: 'modello-partners.it',
    });
  });

  it('converte i domini internazionali in punycode', () => {
    expect(normalizeEmail('anna@consulenzà.it')?.domain).toBe('xn--consulenz-y1a.it');
  });

  it('rifiuta gli indirizzi non validi', () => {
    for (const value of [
      '',
      'senza-chiocciola',
      '@dominio.it',
      'nome@',
      'nome@dominio',
      'a b@c.it',
    ]) {
      expect(normalizeEmail(value)).toBeNull();
    }
  });

  it('riconosce provider personali e domini usa e getta', () => {
    expect(isPersonalProvider('gmail.com')).toBe(true);
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('modello-partners.it')).toBe(false);
  });
});
