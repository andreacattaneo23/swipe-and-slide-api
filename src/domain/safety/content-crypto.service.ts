import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Executor } from '../../infra/database/database';
import { KeyManagement } from '../../infra/kms/key-management';
import { ChatCryptoService, Sealed } from '../chat-crypto/chat-crypto.service';

/** Chiave dei dati di una segnalazione, in chiaro solo in memoria, e la sua forma cifrata. */
export interface ContentKey {
  plain: Buffer;
  wrapped: Buffer;
  keyVersion: string;
}

/**
 * Cifratura applicativa dei contenuti segnalati (D183, D241): i messaggi si decifrano con il
 * servizio della chat (chiave del match) e si ricifrano con una chiave propria della
 * segnalazione, custodita come le altre dalla chiave principale, così le copie sopravvivono alla
 * cancellazione del match e della sua chiave (D63, D99). Stesso formato: AES-256-GCM, testo più
 * tag, nonce a parte, con l'identificativo della segnalazione come dato associato.
 */
@Injectable()
export class ContentCryptoService {
  constructor(
    private readonly kms: KeyManagement,
    private readonly chats: ChatCryptoService,
  ) {}

  async newKey(): Promise<ContentKey> {
    const plain = randomBytes(32);
    const { ciphertext, keyVersion } = await this.kms.encryptDataKey(plain);
    return { plain, wrapped: ciphertext, keyVersion };
  }

  openKey(wrapped: Buffer, keyVersion: string): Promise<Buffer> {
    return this.kms.decryptDataKey(wrapped, keyVersion);
  }

  seal(key: Buffer, text: string): Sealed {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce };
  }

  open(key: Buffer, ciphertext: Buffer, nonce: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    return Buffer.concat([
      decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Testi dei messaggi di un match; `null` per quelli che non si decifrano. */
  openMessages(matchId: string, items: Sealed[], tx?: Executor): Promise<(string | null)[]> {
    return this.chats.openAll(
      matchId,
      items.map((item) => ({
        ciphertext: Buffer.from(item.ciphertext),
        nonce: Buffer.from(item.nonce),
      })),
      tx,
    );
  }
}
