import { cleanMessage } from './chat.service';

describe('Testo della chat (D63)', () => {
  it('toglie i caratteri di controllo e invisibili, tiene emoji e a capo', () => {
    expect(cleanMessage('  Ciao\u0007 📊\n\n\n​A te‮  ')).toBe('Ciao 📊\n\nA te');
  });
});
