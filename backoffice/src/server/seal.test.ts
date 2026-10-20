// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { seal, unseal } from './seal';

describe('cookie cifrati', () => {
  const key = randomBytes(32);

  it('il valore torna uguale e il testo non contiene il token in chiaro', () => {
    const sealed = seal({ token: 'segreto-operatore' }, key, 'operator-session');
    expect(sealed).not.toContain('segreto-operatore');
    expect(unseal(sealed, key, 'operator-session')).toEqual({ token: 'segreto-operatore' });
  });

  it('rifiuta un cookie alterato, di un altro scopo o con un’altra chiave', () => {
    const sealed = seal({ token: 'x' }, key, 'operator-session');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(unseal(tampered, key, 'operator-session')).toBeNull();
    expect(unseal(sealed, key, 'sign-in-flow')).toBeNull();
    expect(unseal(sealed, randomBytes(32), 'operator-session')).toBeNull();
    expect(unseal('non-valido', key, 'operator-session')).toBeNull();
  });
});
