import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';

/**
 * Impronte, codici e cifratura locale.
 * - Impronte HMAC con il segreto del server e la sua versione (`v1:...`): email, codici OTP,
 *   token di rinnovo, nonce (README, "Impronte"). Mai valori in chiaro nel database.
 * - Cifratura AES-256-GCM con una chiave locale per i token dei fornitori.
 *   La chiave viene da variabile d'ambiente, in locale e in produzione da un segreto del
 *   server; [Proposta] la custodia in OpenBao come la chiave dei messaggi (D241) con la stessa
 *   interfaccia.
 */
@Injectable()
export class CryptoService {
  private readonly tokenKey: Buffer;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.tokenKey = createHash('sha256').update(config.tokenEncryptionKey).digest();
  }

  /** Impronta HMAC versionata di un valore già normalizzato, con un contesto che la separa. */
  hash(context: string, value: string): string {
    const digest = createHmac('sha256', this.config.hmacSecret)
      .update(`${context}\u0000${value}`)
      .digest('base64url');
    return `${this.config.hmacSecretVersion}:${digest}`;
  }

  /** Confronto a tempo costante tra due impronte. */
  equalHashes(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  /** Codice OTP di 6 cifre da un generatore crittografico (D136). */
  otpCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** Valore casuale opaco (token di rinnovo, nonce, ticket). */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  encryptToken(plain: string): { ciphertext: string; keyVersion: string } {
    return { ciphertext: this.encrypt(this.tokenKey, plain), keyVersion: 'local-v1' };
  }

  decryptToken(ciphertext: string): string {
    return this.decrypt(this.tokenKey, ciphertext);
  }

  private encrypt(key: Buffer, plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
  }

  private decrypt(key: Buffer, ciphertext: string): string {
    const [iv, tag, body] = ciphertext.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !body) throw new Error('Testo cifrato non valido');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }
}

/** Impronta SHA-256 in esadecimale (nonce passato ad Apple, D224). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
