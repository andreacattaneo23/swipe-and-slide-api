import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor } from '../../infra/database/database';
import { KeyManagement } from '../../infra/kms/key-management';

/** Testo cifrato con la chiave del match: `ciphertext` contiene anche il tag di GCM. */
export interface Sealed {
  ciphertext: Buffer;
  nonce: Buffer;
}

const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 2_000;

/**
 * Cifratura applicativa dei messaggi e del luogo degli inviti (D183, parte di `EncryptionModule`):
 * una chiave dei dati AES-256-GCM per match, salvata solo cifrata dalla chiave principale in
 * `chat_keys`; le chiavi decifrate restano in memoria per pochi minuti. Il database non vede mai
 * il testo in chiaro. Non è cifratura end-to-end: il servizio decifra (D181).
 */
@Injectable()
export class ChatCryptoService {
  private readonly cache = new Map<string, { key: Buffer; until: number }>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kms: KeyManagement,
  ) {}

  /** Cifra un testo per il match, creando la chiave del match se non c'è ancora. */
  async seal(matchId: string, plain: string, tx: Executor = this.db): Promise<Sealed> {
    const key = await this.keyFor(matchId, tx, true);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(matchId));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce };
  }

  /** Decifra un testo del match; `null` se la chiave non c'è più o il testo non è valido. */
  async open(matchId: string, sealed: Sealed, tx: Executor = this.db): Promise<string | null> {
    const key = await this.keyFor(matchId, tx, false).catch(() => null);
    if (!key) return null;
    return ChatCryptoService.openWith(key, matchId, sealed);
  }

  /** Decifra più testi dello stesso match con una sola lettura della chiave. */
  async openAll(
    matchId: string,
    items: Sealed[],
    tx: Executor = this.db,
  ): Promise<(string | null)[]> {
    if (items.length === 0) return [];
    const key = await this.keyFor(matchId, tx, false).catch(() => null);
    return items.map((item) => (key ? ChatCryptoService.openWith(key, matchId, item) : null));
  }

  private static openWith(key: Buffer, matchId: string, sealed: Sealed): string | null {
    try {
      const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - 16);
      const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
      decipher.setAAD(Buffer.from(matchId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  private async keyFor(matchId: string, tx: Executor, create: boolean): Promise<Buffer> {
    const cached = this.cache.get(matchId);
    if (cached && cached.until > Date.now()) return cached.key;
    let row = await this.read(matchId, tx);
    if (!row) {
      if (!create) throw new Error('Chiave del match assente');
      const plain = randomBytes(32);
      const wrapped = await this.kms.encryptDataKey(plain);
      // Due primi messaggi simultanei: vince la prima chiave scritta, l'altra si rilegge
      await tx.execute(sql`
        insert into chat_keys (match_id, encrypted_key, key_version)
        values (${matchId}::uuid, ${wrapped.ciphertext}, ${wrapped.keyVersion})
        on conflict (match_id) do nothing`);
      row = await this.read(matchId, tx);
      if (!row) throw new Error('Chiave del match non scritta');
    }
    const key = await this.kms.decryptDataKey(row.encrypted_key, row.key_version);
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(matchId, { key, until: Date.now() + CACHE_MS });
    return key;
  }

  private async read(
    matchId: string,
    tx: Executor,
  ): Promise<{ encrypted_key: Buffer; key_version: string } | null> {
    const result = await tx.execute<{ encrypted_key: Buffer; key_version: string }>(
      sql`select encrypted_key, key_version from chat_keys where match_id = ${matchId}::uuid`,
    );
    return result.rows[0] ?? null;
  }
}
