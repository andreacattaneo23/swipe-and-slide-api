import { texts } from './it';
import { proposedTexts } from './proposed';
import { t, tCount } from './index';

describe('testi del backoffice', () => {
  it('le proposte non duplicano chiavi già approvate in testi.js', () => {
    const duplicated = Object.keys(proposedTexts).filter((key) => key in texts);
    expect(duplicated).toEqual([]);
  });

  it('sostituisce i valori tra parentesi graffe', () => {
    expect(t('backoffice.removalModal.title.value', { name: 'Studio Fittizio' })).toBe(
      'Rimuovi Studio Fittizio',
    );
  });

  it('sceglie la forma singolare', () => {
    expect(tCount('code.wrong', 1)).toBe('Codice non valido. Ti resta 1 tentativo.');
    expect(tCount('code.wrong', 3)).toBe('Codice non valido. Ti restano 3 tentativi.');
  });

  it('nessun punto esclamativo nei testi del backoffice (testi.js)', () => {
    const all = [...Object.values(texts), ...Object.values(proposedTexts)];
    expect(all.filter((text) => text.includes('!'))).toEqual([]);
  });
});
