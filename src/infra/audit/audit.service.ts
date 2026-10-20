import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database, Executor } from '../database/database';
import { auditLog } from '../database/schema';

export type AuditAction = (typeof auditLog.$inferInsert)['action'];

export interface AuditEntry {
  type: 'action' | 'security';
  action: AuditAction;
  operatorId?: string | null;
  sessionId?: string | null;
  objectType?: string;
  objectId?: string;
  /** Motivazione dell'operatore (D91): codice dall'elenco più testo breve, senza dati personali. */
  explanation?: string | null;
  /** Solo conteggi, codici ed esiti (D112). */
  details?: Record<string, string | number | boolean | null>;
}

/** Scrittura dell'audit, nella transazione dell'azione quando c'è (D89, D91, D112). */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async write(entry: AuditEntry, tx: Executor = this.db): Promise<void> {
    await tx.insert(auditLog).values({
      type: entry.type,
      action: entry.action,
      operatorId: entry.operatorId ?? null,
      sessionId: entry.sessionId ?? null,
      objectType: entry.objectType ?? null,
      objectId: entry.objectId ?? null,
      explanation: entry.explanation ?? null,
      details: entry.details ?? {},
    });
  }
}
