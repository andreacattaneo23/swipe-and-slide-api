import { matches, normalizeForFilter } from './word-filter.service';

describe('Filtro delle parole (D73)', () => {
  it('normalizza accenti, cifre al posto delle lettere e lettere ripetute', () => {
    expect(normalizeForFilter('Càaaasa 1d10ta!')).toBe('casa idiota');
  });

  it('confronta parole intere, senza falsi positivi dentro parole innocue', () => {
    const words = ['idiota', 'brutta parola'];
    expect(matches(normalizeForFilter('Sei un 1d1ota'), words)).toBe(true);
    expect(matches(normalizeForFilter('Una BRUTTA   parola qui'), words)).toBe(true);
    expect(matches(normalizeForFilter('idiotamente no'), words)).toBe(false);
    expect(matches(normalizeForFilter('Slide pulite e caffè forte'), words)).toBe(false);
  });
});
