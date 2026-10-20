/**
 * Adattatore `http` delle API di amministrazione, verso ADMIN_API_URL (servizio privato
 * `admin-api`). Rotte dell'architettura (`/backoffice/*`); quelle dell'accesso sono indicate solo
 * come `POST /backoffice/auth/...` e i loro nomi qui sono [Proposta]. Quando esiste
 * `openapi/admin.json` le chiamate passano al client generato, dietro la stessa interfaccia.
 *
 * Identità (D231): il chiamante si presenta a Cloud Run IAM con il token d'identità dell'account
 * di servizio del backoffice (`Authorization`), l'operatore con il token della sua sessione in
 * un'intestazione dedicata (`X-Operator-Token`, nome [Proposta]). Nessuna risposta si mette in
 * cache.
 */
import 'server-only';
import {
  AdminApiError,
  type AdminApi,
  type AdminApiErrorCode,
  type ApprovalDecision,
  type ApprovalDetail,
  type ApprovalQueue,
  type City,
  type Company,
  type CompanyInput,
  type Offsite,
  type OffsiteInput,
  type Operator,
  type OperatorSession,
  type RejectionDecision,
  type RemovalConfirmation,
  type RemovalPreview,
  type SignInChallenge,
} from './types';

export const OPERATOR_TOKEN_HEADER = 'X-Operator-Token';

export interface HttpOptions {
  baseUrl: string;
  /** Token d'identità del chiamante per Cloud Run IAM; assente in locale. */
  callerToken?: () => Promise<string | null>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const KNOWN_CODES: readonly AdminApiErrorCode[] = [
  'unauthorized',
  'forbidden',
  'invalid_code',
  'code_expired',
  'too_many_attempts',
  'invalid_totp',
  'validation',
  'not_found',
  'conflict',
  'unavailable',
];

export class HttpAdminApi implements AdminApi {
  private readonly baseUrl: string;
  private readonly callerToken: () => Promise<string | null>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.callerToken = options.callerToken ?? (async () => null);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  requestSignInCode(email: string) {
    return this.call<SignInChallenge>('POST', '/backoffice/auth/code', null, { email });
  }

  verifySignInCode(challengeId: string, code: string) {
    return this.call<SignInChallenge>('POST', '/backoffice/auth/code/verification', null, {
      challengeId,
      code,
    });
  }

  verifyTotp(challengeId: string, totpCode: string) {
    return this.call<OperatorSession>('POST', '/backoffice/auth/totp', null, {
      challengeId,
      totpCode,
    });
  }

  getCurrentOperator(token: string) {
    return this.call<Operator>('GET', '/backoffice/auth/me', token);
  }

  async signOut(token: string) {
    await this.call<void>('DELETE', '/backoffice/auth/session', token);
  }

  listCompanies(token: string, search?: string) {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.call<Company[]>('GET', `/backoffice/companies${query}`, token);
  }

  createCompany(token: string, input: CompanyInput) {
    return this.call<Company>('POST', '/backoffice/companies', token, input);
  }

  getRemovalPreview(token: string, companyId: string) {
    return this.call<RemovalPreview>(
      'GET',
      `/backoffice/companies/${id(companyId)}/removal/preview`,
      token,
    );
  }

  startRemoval(token: string, companyId: string, input: RemovalConfirmation) {
    return this.call<Company>(
      'POST',
      `/backoffice/companies/${id(companyId)}/removal`,
      token,
      input,
    );
  }

  cancelRemoval(token: string, companyId: string, input: ApprovalDecision) {
    return this.call<Company>(
      'DELETE',
      `/backoffice/companies/${id(companyId)}/removal`,
      token,
      input,
    );
  }

  getApprovalQueue(token: string) {
    return this.call<ApprovalQueue>('GET', '/backoffice/approvals/queue', token);
  }

  getApproval(token: string, reviewId: string) {
    return this.call<ApprovalDetail>('GET', `/backoffice/approvals/${id(reviewId)}`, token);
  }

  async approveProfile(token: string, reviewId: string, input: ApprovalDecision) {
    await this.call<void>('POST', `/backoffice/approvals/${id(reviewId)}/approval`, token, input);
  }

  async rejectProfile(token: string, reviewId: string, input: RejectionDecision) {
    await this.call<void>('POST', `/backoffice/approvals/${id(reviewId)}/rejection`, token, input);
  }

  listCities(token: string) {
    return this.call<City[]>('GET', '/backoffice/config/cities', token);
  }

  createOffsite(token: string, input: OffsiteInput) {
    return this.call<Offsite>('POST', '/backoffice/offsites', token, input);
  }

  publishOffsite(token: string, offsiteId: string) {
    return this.call<Offsite>('POST', `/backoffice/offsites/${id(offsiteId)}/publication`, token);
  }

  private async call<T>(
    method: string,
    path: string,
    operatorToken: string | null,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const caller = await this.callerToken();
    if (caller) headers.Authorization = `Bearer ${caller}`;
    if (operatorToken) headers[OPERATOR_TOKEN_HEADER] = operatorToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AdminApiError('unavailable');
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    throw await toError(response);
  }
}

/** Traduce una risposta d'errore nel codice del contratto, senza esporre dettagli al browser. */
async function toError(response: Response): Promise<AdminApiError> {
  let payload: { code?: string; remainingAttempts?: number; field?: string } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // corpo assente o non JSON: vale lo stato HTTP
  }
  const details = {
    ...(typeof payload.remainingAttempts === 'number'
      ? { remainingAttempts: payload.remainingAttempts }
      : {}),
    ...(typeof payload.field === 'string' ? { field: payload.field } : {}),
  };
  if (payload.code && (KNOWN_CODES as readonly string[]).includes(payload.code)) {
    return new AdminApiError(payload.code as AdminApiErrorCode, details);
  }
  const byStatus: Record<number, AdminApiErrorCode> = {
    400: 'validation',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'validation',
    429: 'too_many_attempts',
  };
  return new AdminApiError(byStatus[response.status] ?? 'unavailable', details);
}

function id(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Token d'identità dell'account di servizio dal server dei metadati di Google Cloud, con
 * destinatario l'URL di admin-api (Cloud Run IAM). Si usa solo con ADMIN_API_IAM=true.
 */
export function metadataIdentityToken(audience: string): () => Promise<string | null> {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
    const response = await fetch(url, {
      headers: { 'Metadata-Flavor': 'Google' },
      cache: 'no-store',
    });
    if (!response.ok) throw new AdminApiError('unavailable');
    const token = await response.text();
    // I token durano un'ora: si rinnovano con dieci minuti di margine.
    cached = { token, expiresAt: Date.now() + 50 * 60_000 };
    return token;
  };
}
