// @vitest-environment node
import { HttpAdminApi, OPERATOR_TOKEN_HEADER } from './http-admin-api';

function fakeFetch(status: number, body?: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('adattatore http delle API di amministrazione', () => {
  it('chiama le rotte dell’architettura con le due identità, senza cache', async () => {
    const { impl, calls } = fakeFetch(200, []);
    const api = new HttpAdminApi({
      baseUrl: 'https://admin-api.example/',
      callerToken: async () => 'token-iam',
      fetch: impl,
    });
    await api.listCompanies('token-operatore', 'prova & co');
    const [call] = calls;
    expect(call?.url).toBe(
      'https://admin-api.example/backoffice/companies?search=prova%20%26%20co',
    );
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-iam');
    expect(headers[OPERATOR_TOKEN_HEADER]).toBe('token-operatore');
    expect(call?.init.cache).toBe('no-store');
  });

  it('manda la conferma rafforzata nel corpo e codifica gli identificativi', async () => {
    const { impl, calls } = fakeFetch(200, { id: 'a/b' });
    const api = new HttpAdminApi({ baseUrl: 'https://admin-api.example', fetch: impl });
    await api.startRemoval('t', 'a/b', { explanation: 'm', confirmName: 'N', totpCode: '123456' });
    expect(calls[0]?.url).toBe('https://admin-api.example/backoffice/companies/a%2Fb/removal');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      explanation: 'm',
      confirmName: 'N',
      totpCode: '123456',
    });
  });

  it('traduce gli errori nei codici del contratto', async () => {
    const cases: [number, unknown, string][] = [
      [401, undefined, 'unauthorized'],
      [403, undefined, 'forbidden'],
      [409, undefined, 'conflict'],
      [422, { code: 'invalid_code', remainingAttempts: 2 }, 'invalid_code'],
      [400, { code: 'sconosciuto' }, 'validation'],
      [503, undefined, 'unavailable'],
    ];
    for (const [status, body, expected] of cases) {
      const api = new HttpAdminApi({
        baseUrl: 'https://x.example',
        fetch: fakeFetch(status, body).impl,
      });
      await expect(api.getApprovalQueue('t')).rejects.toMatchObject({ code: expected });
    }
  });

  it('una rete assente diventa "unavailable"', async () => {
    const api = new HttpAdminApi({
      baseUrl: 'https://x.example',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(api.getApprovalQueue('t')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
