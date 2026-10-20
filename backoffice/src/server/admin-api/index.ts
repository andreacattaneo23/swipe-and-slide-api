/**
 * Scelta dell'adattatore delle API di amministrazione con ADMIN_API_ADAPTER (`mock` di base,
 * `http` verso ADMIN_API_URL). L'istanza mock vive in globalThis, così i dati in memoria restano
 * tra una richiesta e l'altra anche con il ricaricamento dei moduli in sviluppo.
 */
import 'server-only';
import { readConfig } from '../config';
import { HttpAdminApi, metadataIdentityToken } from './http-admin-api';
import { MockAdminApi } from './mock/mock-admin-api';
import type { AdminApi } from './types';

const globalForApi = globalThis as typeof globalThis & { __backofficeAdminApi?: AdminApi };

export function getAdminApi(): AdminApi {
  if (globalForApi.__backofficeAdminApi) return globalForApi.__backofficeAdminApi;
  const config = readConfig();
  const api: AdminApi =
    config.adapter === 'http'
      ? new HttpAdminApi({
          baseUrl: config.adminApiUrl!,
          ...(config.adminApiIam
            ? { callerToken: metadataIdentityToken(config.adminApiUrl!) }
            : {}),
        })
      : new MockAdminApi(
          process.env.MOCK_SIGN_IN_CODE ? { signInCode: () => process.env.MOCK_SIGN_IN_CODE! } : {},
        );
  globalForApi.__backofficeAdminApi = api;
  return api;
}

/** Solo per i test: sostituisce l'adattatore. */
export function setAdminApiForTests(api: AdminApi | undefined): void {
  globalForApi.__backofficeAdminApi = api;
}

export * from './types';
