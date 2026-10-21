/**
 * Client delle API di amministrazione: solo admin-api vera, con l'adattatore http (D240). L'istanza
 * vive in globalThis, così si riusa tra una richiesta e l'altra anche con il ricaricamento dei
 * moduli in sviluppo.
 */
import 'server-only';
import { readConfig } from '../config';
import { HttpAdminApi, metadataIdentityToken } from './http-admin-api';
import type { AdminApi } from './types';

const globalForApi = globalThis as typeof globalThis & { __backofficeAdminApi?: AdminApi };

export function getAdminApi(): AdminApi {
  if (globalForApi.__backofficeAdminApi) return globalForApi.__backofficeAdminApi;
  const config = readConfig();
  const api = new HttpAdminApi({
    baseUrl: config.adminApiUrl,
    ...(config.adminApiIam ? { callerToken: metadataIdentityToken(config.adminApiUrl) } : {}),
  });
  globalForApi.__backofficeAdminApi = api;
  return api;
}

/** Solo per i test di unità: sostituisce il client con un doppio definito nel test. */
export function setAdminApiForTests(api: AdminApi | undefined): void {
  globalForApi.__backofficeAdminApi = api;
}

export * from './types';
