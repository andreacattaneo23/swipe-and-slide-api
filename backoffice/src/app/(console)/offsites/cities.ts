import 'server-only';
import { getAdminApi, type City } from '@/server/admin-api';

/**
 * Elenco dei comuni per il modulo degli offsite. La rotta `GET /backoffice/config/cities` è
 * [Proposta] e non è ancora nel contratto di main: senza elenco il modulo chiede il codice ISTAT
 * del comune, che è l'identificativo di `cities`.
 */
export async function loadCities(token: string): Promise<City[]> {
  try {
    return await getAdminApi().listCities(token);
  } catch {
    return [];
  }
}
