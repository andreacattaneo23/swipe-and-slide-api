/**
 * Adattatore `http` delle API di amministrazione, verso ADMIN_API_URL (servizio privato
 * `admin-api`). Rotte, corpi, risposte ed errori vengono tutti da `contract.ts`: qui solo il
 * trasporto.
 *
 * Identità (D231): il chiamante si presenta a Cloud Run IAM con il token d'identità dell'account
 * di servizio del backoffice (`Authorization`), l'operatore con il token della sua sessione
 * nell'intestazione `X-Operator-Token` (contratto). Nessuna risposta si mette in cache.
 */
import 'server-only';
import { routes, toAdminApiError, type Call } from './contract';
import { AdminApiError, type AdminApi, type ApprovalQueue } from './types';

export const OPERATOR_TOKEN_HEADER = 'X-Operator-Token';

export interface HttpOptions {
  baseUrl: string;
  /** Token d'identità del chiamante per Cloud Run IAM; assente in locale. */
  callerToken?: () => Promise<string | null>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type Args<K extends keyof typeof routes> = Parameters<(typeof routes)[K]>;

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

  // ---------- Accesso ----------
  requestSignInCode = (...args: Args<'requestSignInCode'>) =>
    this.send(null, routes.requestSignInCode(...args));
  verifySignIn = (...args: Args<'verifySignIn'>) => this.send(null, routes.verifySignIn(...args));
  getCurrentOperator = (token: string) => this.send(token, routes.getCurrentOperator());
  signOut = (token: string) => this.send(token, routes.signOut());

  // ---------- Aziende ----------
  listCompanies = (token: string, ...args: Args<'listCompanies'>) =>
    this.send(token, routes.listCompanies(...args));
  getCompany = (token: string, ...args: Args<'getCompany'>) =>
    this.send(token, routes.getCompany(...args));
  createCompany = (token: string, ...args: Args<'createCompany'>) =>
    this.send(token, routes.createCompany(...args));
  renameCompany = (token: string, ...args: Args<'renameCompany'>) =>
    this.send(token, routes.renameCompany(...args));
  addDomain = (token: string, ...args: Args<'addDomain'>) =>
    this.send(token, routes.addDomain(...args));
  removeDomain = (token: string, ...args: Args<'removeDomain'>) =>
    this.send(token, routes.removeDomain(...args));
  previewMerge = (token: string, ...args: Args<'previewMerge'>) =>
    this.send(token, routes.previewMerge(...args));
  mergeCompany = (token: string, ...args: Args<'mergeCompany'>) =>
    this.send(token, routes.mergeCompany(...args));
  previewDomainMove = (token: string, ...args: Args<'previewDomainMove'>) =>
    this.send(token, routes.previewDomainMove(...args));
  moveDomain = (token: string, ...args: Args<'moveDomain'>) =>
    this.send(token, routes.moveDomain(...args));
  getRemovalPreview = (token: string, ...args: Args<'getRemovalPreview'>) =>
    this.send(token, routes.getRemovalPreview(...args));
  startRemoval = (token: string, ...args: Args<'startRemoval'>) =>
    this.send(token, routes.startRemoval(...args));
  cancelRemoval = (token: string, ...args: Args<'cancelRemoval'>) =>
    this.send(token, routes.cancelRemoval(...args));

  // ---------- Richieste di aggiunta ----------
  listWaitlist = (token: string) => this.send(token, routes.listWaitlist());
  respondWaitlist = (token: string, ...args: Args<'respondWaitlist'>) =>
    this.send(token, routes.respondWaitlist(...args));
  listDirectoryAlerts = (token: string) => this.send(token, routes.listDirectoryAlerts());

  // ---------- Utenti ----------
  searchUsers = (token: string, ...args: Args<'searchUsers'>) =>
    this.send(token, routes.searchUsers(...args));
  getUser = (token: string, ...args: Args<'getUser'>) => this.send(token, routes.getUser(...args));
  revealEmail = (token: string, ...args: Args<'revealEmail'>) =>
    this.send(token, routes.revealEmail(...args));
  forceReverification = (token: string, ...args: Args<'forceReverification'>) =>
    this.send(token, routes.forceReverification(...args));
  sanctionUser = (token: string, ...args: Args<'sanctionUser'>) =>
    this.send(token, routes.sanctionUser(...args));
  reactivateUser = (token: string, ...args: Args<'reactivateUser'>) =>
    this.send(token, routes.reactivateUser(...args));
  deleteUser = (token: string, ...args: Args<'deleteUser'>) =>
    this.send(token, routes.deleteUser(...args));

  // ---------- Moderazione ----------
  getModerationQueue = (token: string) => this.send(token, routes.getModerationQueue());
  getModerationCase = (token: string, ...args: Args<'getModerationCase'>) =>
    this.send(token, routes.getModerationCase(...args));
  decideCase = (token: string, ...args: Args<'decideCase'>) =>
    this.send(token, routes.decideCase(...args));
  listAppeals = (token: string) => this.send(token, routes.listAppeals());
  getAppeal = (token: string, ...args: Args<'getAppeal'>) =>
    this.send(token, routes.getAppeal(...args));
  decideAppeal = (token: string, ...args: Args<'decideAppeal'>) =>
    this.send(token, routes.decideAppeal(...args));

  // ---------- Approvazioni ----------
  /** Coda dei profili più il numero delle foto nuove, che è solo un aiuto alla navigazione. */
  async getApprovalQueue(token: string): Promise<ApprovalQueue> {
    const [profiles, photos] = await Promise.all([
      this.send(token, routes.getApprovalQueue()),
      this.send(token, routes.getNewPhotos()).catch(() => []),
    ]);
    return { profiles, profilesCount: profiles.length, photosCount: photos.length };
  }
  getApproval = (token: string, ...args: Args<'getApproval'>) =>
    this.send(token, routes.getApproval(...args));
  approveProfile = (token: string, ...args: Args<'approveProfile'>) =>
    this.send(token, routes.approveProfile(...args));
  rejectProfile = (token: string, ...args: Args<'rejectProfile'>) =>
    this.send(token, routes.rejectProfile(...args));
  getNewPhotos = (token: string) => this.send(token, routes.getNewPhotos());
  decideNewPhoto = (token: string, ...args: Args<'decideNewPhoto'>) =>
    this.send(token, routes.decideNewPhoto(...args));

  // ---------- Offsite ----------
  listCities = (token: string) => this.send(token, routes.listCities());
  listOffsites = (token: string) => this.send(token, routes.listOffsites());
  getOffsite = (token: string, ...args: Args<'getOffsite'>) =>
    this.send(token, routes.getOffsite(...args));
  createOffsite = (token: string, ...args: Args<'createOffsite'>) =>
    this.send(token, routes.createOffsite(...args));
  updateOffsite = (token: string, ...args: Args<'updateOffsite'>) =>
    this.send(token, routes.updateOffsite(...args));
  publishOffsite = (token: string, ...args: Args<'publishOffsite'>) =>
    this.send(token, routes.publishOffsite(...args));
  cancelOffsite = (token: string, ...args: Args<'cancelOffsite'>) =>
    this.send(token, routes.cancelOffsite(...args));
  uploadCover = (token: string, ...args: Args<'uploadCover'>) =>
    this.send(token, routes.uploadCover(...args));

  // ---------- Audit, statistiche, configurazione ----------
  listAudit = (token: string, ...args: Args<'listAudit'>) =>
    this.send(token, routes.listAudit(...args));
  exportAudit = (token: string, ...args: Args<'exportAudit'>) =>
    this.send(token, routes.exportAudit(...args));
  getStats = (token: string) => this.send(token, routes.getStats());
  getConfig = (token: string) => this.send(token, routes.getConfig());
  updateLimit = (token: string, ...args: Args<'updateLimit'>) =>
    this.send(token, routes.updateLimit(...args));
  setTaxonomyItem = (token: string, ...args: Args<'setTaxonomyItem'>) =>
    this.send(token, routes.setTaxonomyItem(...args));

  // ---------- Account dimostrativi ----------
  getStoreReview = (token: string) => this.send(token, routes.getStoreReview());
  openReviewWindow = (token: string, ...args: Args<'openReviewWindow'>) =>
    this.send(token, routes.openReviewWindow(...args));
  closeReviewWindow = (token: string, ...args: Args<'closeReviewWindow'>) =>
    this.send(token, routes.closeReviewWindow(...args));
  resetDemoData = (token: string, ...args: Args<'resetDemoData'>) =>
    this.send(token, routes.resetDemoData(...args));

  /** Esegue una chiamata del contratto; gli errori diventano `AdminApiError`. */
  private async send<T>(operatorToken: string | null, call: Call<T>): Promise<T> {
    const headers: Record<string, string> = {
      Accept: call.accept === 'text' ? 'text/csv' : 'application/json',
    };
    const caller = await this.callerToken();
    if (caller) headers.Authorization = `Bearer ${caller}`;
    if (operatorToken && !call.anonymous) headers[OPERATOR_TOKEN_HEADER] = operatorToken;
    let body: BodyInit | undefined;
    if (call.form) {
      body = call.form;
    } else if (call.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(call.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${call.path}`, {
        method: call.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AdminApiError('unavailable');
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw toAdminApiError(response.status, parse(text), call.errors);
    }
    if (call.accept === 'text') return call.read(text, response.headers);
    return call.read(text ? parse(text) : undefined, response.headers);
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
