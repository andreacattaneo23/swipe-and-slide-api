import type { Request } from 'express';

export type SessionScope = 'full' | 'registration' | 'approval' | 'restore' | 'limited';

/** Identità della richiesta, ricavata dal token di accesso e dalla sessione nel database. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  scope: SessionScope;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
