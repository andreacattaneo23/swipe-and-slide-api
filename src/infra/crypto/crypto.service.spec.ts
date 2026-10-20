import { loadConfig } from '../config/config';
import { CryptoService, sha256Hex } from './crypto.service';

const secret = 'k'.repeat(40);
const config = loadConfig({
  DATABASE_URL: 'postgres://x@localhost/x',
  JWT_ACCESS_SIGNING_KEY: secret,
  JWT_ADMIN_SIGNING_KEY: secret,
  HMAC_SECRET: secret,
  TOKEN_ENCRYPTION_KEY: secret,
  TOTP_ENCRYPTION_KEY: `${secret}t`,
});
const crypto = new CryptoService(config);

describe('CryptoService', () => {
  it('impronte HMAC versionate, diverse per contesto e mai uguali al valore', () => {
    const a = crypto.hash('email', 'luca@personale.example');
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain('luca');
    expect(crypto.hash('email', 'luca@personale.example')).toBe(a);
    expect(crypto.hash('otp-recipient', 'luca@personale.example')).not.toBe(a);
    expect(crypto.equalHashes(a, a)).toBe(true);
    expect(crypto.equalHashes(a, `${a}x`)).toBe(false);
  });

  it('codici OTP di 6 cifre', () => {
    for (let i = 0; i < 50; i++) expect(crypto.otpCode()).toMatch(/^\d{6}$/);
  });

  it('cifratura dei token e dei segreti TOTP con chiavi separate', () => {
    const { ciphertext } = crypto.encryptToken('refresh-token-del-fornitore');
    expect(ciphertext).not.toContain('refresh');
    expect(crypto.decryptToken(ciphertext)).toBe('refresh-token-del-fornitore');
    const totp = crypto.encryptTotpSecret('JBSWY3DPEHPK3PXP');
    expect(() => crypto.decryptToken(totp)).toThrow();
    expect(crypto.decryptTotpSecret(totp)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('impronta SHA-256 del nonce per Apple', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
