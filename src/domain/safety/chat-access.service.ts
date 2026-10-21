import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAction } from '../companies/companies.service';
import { ContentCryptoService } from './content-crypto.service';

export const CHAT_READ_REASONS = ['authority_request', 'security_investigation'] as const;
export type ChatReadReason = (typeof CHAT_READ_REASONS)[number];

export interface ChatReadMessage {
  id: string;
  senderId: string;
  sentAt: Date;
  /** `null` se il messaggio non si decifra con la chiave del match. */
  text: string | null;
}

/**
 * Lettura motivata di una chat da parte dell'Amministratore (D181, D187): richiesta delle
 * autorità o indagine di sicurezza, con riferimento, periodo e identificativo del match digitato
 * (verificati dal controller, D244). Passa da `read_chat`, che scrive `chat_read` nell'audit nella stessa transazione e
 * restituisce solo testi cifrati; decifra l'API di amministrazione con la chiave del match.
 */
@Injectable()
export class ChatAccessService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: ContentCryptoService,
  ) {}

  async read(
    matchId: string,
    input: { reason: ChatReadReason; reference: string; from: Date; to: Date },
    by: OperatorAction,
  ): Promise<ChatReadMessage[]> {
    return this.db.transaction(async (tx) => {
      const match = await tx.execute<{ id: string }>(
        sql`select id from matches where id = ${matchId}::uuid`,
      );
      if (!match.rows.length) throw ApiError.notFound();
      const rows = await tx.execute<{
        id: string;
        sender_id: string;
        created_at: Date;
        ciphertext: Buffer;
        nonce: Buffer;
      }>(sql`
        select * from read_chat(${matchId}::uuid, ${input.reason}::chat_read_reason,
                                ${input.reference}, ${input.from.toISOString()}::timestamptz,
                                ${input.to.toISOString()}::timestamptz, ${by.operatorId}::uuid,
                                ${by.sessionId}::uuid, ${by.explanation})`);
      const texts = await this.crypto.openMessages(
        matchId,
        rows.rows.map((row) => ({ ciphertext: row.ciphertext, nonce: row.nonce })),
        tx,
      );
      return rows.rows.map((row, index) => ({
        id: row.id,
        senderId: row.sender_id,
        sentAt: new Date(row.created_at),
        text: texts[index] ?? null,
      }));
    });
  }
}
