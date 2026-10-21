import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Custodia della chiave principale della cifratura a busta dei messaggi (D183, rivista da D241):
 * cifra e decifra solo le chiavi dei dati dei match, mai i messaggi. In produzione OpenBao con il
 * motore transit; in sviluppo una chiave da variabile d'ambiente (D240). Stessa interfaccia, stessa
 * cifratura dei messaggi: cambia solo dove sta la chiave principale.
 */
export abstract class KeyManagement {
  abstract encryptDataKey(plain: Buffer): Promise<{ ciphertext: Buffer; keyVersion: string }>;
  abstract decryptDataKey(ciphertext: Buffer, keyVersion: string): Promise<Buffer>;
}

/** Chiave principale da `MESSAGE_MASTER_KEY`, AES-256-GCM: `iv(12) | tag(16) | testo cifrato`. */
export class EnvKeyManagement extends KeyManagement {
  static readonly VERSION = 'env-v1';

  constructor(private readonly key: Buffer) {
    super();
  }

  encryptDataKey(plain: Buffer): Promise<{ ciphertext: Buffer; keyVersion: string }> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Promise.resolve({
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]),
      keyVersion: EnvKeyManagement.VERSION,
    });
  }

  decryptDataKey(ciphertext: Buffer, keyVersion: string): Promise<Buffer> {
    if (keyVersion !== EnvKeyManagement.VERSION) {
      return Promise.reject(new Error('Versione della chiave principale sconosciuta'));
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, ciphertext.subarray(0, 12));
    decipher.setAuthTag(ciphertext.subarray(12, 28));
    return Promise.resolve(
      Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]),
    );
  }
}

/**
 * OpenBao, motore transit (D241): `POST /v1/transit/encrypt/<chiave>` e `/decrypt/<chiave>` con il
 * token del servizio. La chiave principale non esce mai da OpenBao; nel database resta il testo
 * cifrato di transit (`vault:vN:…`), con la versione della chiave per la rotazione.
 * [Proposta] Policy del token: solo encrypt e decrypt sulla chiave dei messaggi, per `app-api`, le
 * esportazioni e `admin-api`; mai per `realtime` e il backoffice.
 */
export class OpenBaoKeyManagement extends KeyManagement {
  private readonly logger = new Logger('OpenBao');

  constructor(
    private readonly address: string,
    private readonly token: string,
    private readonly keyName: string,
  ) {
    super();
  }

  async encryptDataKey(plain: Buffer): Promise<{ ciphertext: Buffer; keyVersion: string }> {
    const result = await this.call<{ ciphertext: string; key_version?: number }>('encrypt', {
      plaintext: plain.toString('base64'),
    });
    const version =
      result.key_version ?? Number(/^vault:v(\d+):/.exec(result.ciphertext)?.[1] ?? 0);
    return {
      ciphertext: Buffer.from(result.ciphertext, 'utf8'),
      keyVersion: `openbao:${this.keyName}:v${version}`,
    };
  }

  async decryptDataKey(ciphertext: Buffer, _keyVersion: string): Promise<Buffer> {
    const result = await this.call<{ plaintext: string }>('decrypt', {
      ciphertext: ciphertext.toString('utf8'),
    });
    return Buffer.from(result.plaintext, 'base64');
  }

  private async call<T>(operation: 'encrypt' | 'decrypt', body: object): Promise<T> {
    const response = await fetch(
      `${this.address.replace(/\/$/, '')}/v1/transit/${operation}/${encodeURIComponent(this.keyName)}`,
      {
        method: 'POST',
        headers: { 'X-Vault-Token': this.token, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      this.logger.error(`OpenBao ${operation}: stato ${response.status}`);
      throw new Error('Custodia della chiave principale non disponibile');
    }
    const json = (await response.json()) as { data: T };
    return json.data;
  }
}
