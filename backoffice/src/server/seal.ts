/**
 * Cifratura autenticata (AES-256-GCM) dei cookie del backoffice. Il browser riceve solo un testo
 * opaco: il token dell'operatore non vi arriva mai in chiaro (D231) e non si può alterare.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export function seal(value: unknown, key: Buffer, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, data, tag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function unseal<T>(sealed: string, key: Buffer, purpose: string): T | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, data, tag] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv!);
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(tag!);
    const plain = Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}
