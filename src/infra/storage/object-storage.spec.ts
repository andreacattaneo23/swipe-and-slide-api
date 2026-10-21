import { validStorageKey } from './object-storage';

describe('Chiavi dell’archivio', () => {
  it('rifiuta chiavi con percorsi relativi o caratteri speciali', () => {
    expect(validStorageKey('../etc/passwd')).toBe(false);
    expect(validStorageKey('a/../b')).toBe(false);
    expect(validStorageKey('a//b')).toBe(false);
    expect(validStorageKey('Age/x')).toBe(false);
    expect(validStorageKey('age-verifications/2f1c/doc')).toBe(true);
  });
});
