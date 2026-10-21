// @vitest-environment node
import { OFFSITE_FORM_EXPLANATION } from './contract';
import { HttpAdminApi, OPERATOR_TOKEN_HEADER } from './http-admin-api';

interface Recorded {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const calls: Recorded[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const api = (impl: typeof fetch) =>
  new HttpAdminApi({ baseUrl: 'https://admin-api.example/', fetch: impl });
const sent = (call: Recorded | undefined) => JSON.parse(String(call?.init.body));
const headersOf = (call: Recorded | undefined) => call?.init.headers as Record<string, string>;

describe('adattatore http: trasporto', () => {
  it('chiama le rotte con le due identità, senza cache', async () => {
    const { impl, calls } = fakeFetch(200, []);
    const client = new HttpAdminApi({
      baseUrl: 'https://admin-api.example/',
      callerToken: async () => 'token-iam',
      fetch: impl,
    });
    await client.listCompanies('token-operatore', 'prova & co');
    const [call] = calls;
    expect(call?.url).toBe(
      'https://admin-api.example/backoffice/companies?search=prova+%26+co&limit=100',
    );
    expect(headersOf(call).Authorization).toBe('Bearer token-iam');
    expect(headersOf(call)[OPERATOR_TOKEN_HEADER]).toBe('token-operatore');
    expect(call?.init.cache).toBe('no-store');
    expect(call?.init.redirect).toBe('error');
  });

  it('una rete assente diventa "unavailable"', async () => {
    const client = api((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(client.getModerationQueue('t')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('adattatore http: contratto di main (openapi/admin.json)', () => {
  it('accesso: codice senza token, poi email e codice, senza secondo fattore (D244)', async () => {
    const { impl, calls } = fakeFetch(200, { token: 'jwt', expiresAt: '2026-10-20T18:00:00Z' });
    const client = api(impl);
    await client.requestSignInCode('admin@example.invalid');
    const session = await client.verifySignIn('admin@example.invalid', '123456');
    expect(session).toEqual({ token: 'jwt', expiresAt: '2026-10-20T18:00:00Z' });
    expect(calls.map((call) => call.url)).toEqual([
      'https://admin-api.example/backoffice/auth/code',
      'https://admin-api.example/backoffice/auth/verify',
    ]);
    expect(sent(calls[1])).toEqual({
      email: 'admin@example.invalid',
      code: '123456',
    });
    expect(headersOf(calls[1])[OPERATOR_TOKEN_HEADER]).toBeUndefined();
  });

  it('verifica rifiutata: "unauthorized" del contratto diventa un errore del modulo', async () => {
    const client = api(fakeFetch(401, { error: { code: 'unauthorized' } }).impl);
    await expect(client.verifySignIn('a@b.it', '123456')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('uscita con POST /backoffice/auth/logout', async () => {
    const { impl, calls } = fakeFetch(204);
    await api(impl).signOut('t');
    expect(calls[0]).toMatchObject({
      url: 'https://admin-api.example/backoffice/auth/logout',
      init: { method: 'POST' },
    });
  });

  it('CompanyDto: i campi mancanti diventano valori neutri', async () => {
    const dto = {
      id: 'c1',
      name: 'Prova',
      status: 'active',
      isDemo: false,
      domains: ['prova.example'],
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    const [company] = await api(fakeFetch(200, [dto]).impl).listCompanies('t');
    expect(company).toEqual({
      id: 'c1',
      name: 'Prova',
      status: 'active',
      isDemo: false,
      domains: ['prova.example'],
      usersCount: null,
      updatedAt: dto.createdAt,
      removalFinalAt: null,
    });
  });

  it('coda delle approvazioni: QueueItemDto più il numero delle foto nuove', async () => {
    const item = {
      reviewId: 'r1',
      userId: 'u1',
      attempt: 2,
      submittedAt: '2026-10-20T08:00:00Z',
      dueAt: '2026-10-21T08:00:00Z',
      minutesLeft: 600,
      firstName: 'Elena',
      ageYears: 27,
      gender: null,
      practiceArea: null,
      lookingFor: null,
      bio: null,
      companyName: null,
    };
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      const photo = { id: 'p', position: 0, status: 'under_review' };
      const body = url.includes('new-photos')
        ? [1, 2].map((n) => ({
            id: `np${n}`,
            userId: 'u',
            firstName: null,
            submittedAt: '',
            dueAt: '',
            photo,
          }))
        : [item];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const queue = await api(impl).getApprovalQueue('t');
    expect(queue.profiles[0]).toMatchObject({
      id: 'r1',
      name: 'Elena',
      age: 27,
      attempt: 2,
      maxAttempts: 3,
    });
    expect(queue).toMatchObject({ profilesCount: 1, photosCount: 2 });
  });

  it('rifiuto: motivo, testo per l’utente e motivazione come RejectDto', async () => {
    const { impl, calls } = fakeFetch(200, { attempt: 3, blocked: true });
    const result = await api(impl).rejectProfile('t', 'r/1', {
      reason: 'fake_profile',
      explanation: 'Profilo falso',
      userExplanation: 'Usa foto tue.',
    });
    expect(result).toEqual({ attempt: 3, blocked: true });
    expect(calls[0]?.url).toBe('https://admin-api.example/backoffice/approvals/r%2F1/rejection');
    expect(sent(calls[0])).toEqual({
      reason: 'fake_profile',
      explanation: 'Profilo falso',
      userExplanation: 'Usa foto tue.',
    });
  });

  it('offsite: marcatore tecnico al posto della motivazione del modulo (D238); 0 iscritti = meno di 10', async () => {
    const dto = {
      id: 'o1',
      title: 'T',
      description: 'D',
      coverKey: null,
      venueName: 'V',
      venueAddress: 'A',
      cityId: '015146',
      startsAt: '2026-10-15T16:30:00.000Z',
      endsAt: '2026-10-15T19:00:00.000Z',
      capacity: null,
      status: 'draft',
      isDemo: false,
      createdAt: '2026-10-01T10:00:00.000Z',
      publishedAt: null,
      updatedAt: '2026-10-01T10:00:00.000Z',
      cancelledAt: null,
      attendeesRounded: 0,
    };
    const { impl, calls } = fakeFetch(200, dto);
    const input = {
      title: dto.title,
      description: dto.description,
      venueName: dto.venueName,
      venueAddress: dto.venueAddress,
      cityId: dto.cityId,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      capacity: dto.capacity,
    };
    const saved = await api(impl).createOffsite('t', input);
    expect(sent(calls[0])).toEqual({ ...input, explanation: OFFSITE_FORM_EXPLANATION });
    expect(saved).toMatchObject({ attendeesRounded: null, coverUrl: null });
  });
});

describe('adattatore http: rotte [Proposta] dell’architettura', () => {
  it('conferma rafforzata con il nome esatto, senza totp; il nome sbagliato torna sul campo', async () => {
    const { impl, calls } = fakeFetch(200, {
      id: 'a/b',
      name: 'N',
      status: 'removing',
      isDemo: false,
      domains: [],
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    await api(impl).startRemoval('t', 'a/b', {
      explanation: 'm',
      confirmName: 'N',
    });
    expect(calls[0]?.url).toBe('https://admin-api.example/backoffice/companies/a%2Fb/removal');
    expect(sent(calls[0])).toEqual({ explanation: 'm', confirmName: 'N' });

    const refused = api(fakeFetch(400, { error: { code: 'confirmation.mismatch' } }).impl);
    await expect(
      refused.deleteUser('t', 'u1', { explanation: 'mmm', confirmName: 'u2' }),
    ).rejects.toMatchObject({ code: 'validation', details: { field: 'confirmName' } });
  });

  it('ricerca degli utenti con l’email nella query verso admin-api, mai nella pagina', async () => {
    const { impl, calls } = fakeFetch(200, []);
    await api(impl).searchUsers('t', { email: 'a+b@esempio.it' });
    expect(calls[0]?.url).toBe(
      'https://admin-api.example/backoffice/users?email=a%2Bb%40esempio.it',
    );
  });

  it('esportazione dell’audit in CSV con il nome del file', async () => {
    const { impl, calls } = fakeFetch(200, 'id,at\n1,2\n', {
      'content-disposition': 'attachment; filename="audit-2026-10-20.csv"',
    });
    const file = await api(impl).exportAudit('t', { type: 'security' });
    expect(file).toEqual({ fileName: 'audit-2026-10-20.csv', csv: 'id,at\n1,2\n' });
    expect(calls[0]?.url).toBe(
      'https://admin-api.example/backoffice/audit/export?type=security&format=csv',
    );
    expect(headersOf(calls[0]).Accept).toBe('text/csv');
  });

  it('audit a pagine: cursore dall’ultima voce di una pagina piena', async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({ id: `a${index}` }));
    const page = await api(fakeFetch(200, items).impl).listAudit('t', {});
    expect(page.nextCursor).toBe('a49');
  });

  it('copertina in multipart, senza Content-Type scritto a mano', async () => {
    const { impl, calls } = fakeFetch(200, {
      id: 'o1',
      attendeesRounded: 20,
      coverUrl: 'https://r2.example/c.jpg',
    });
    const saved = await api(impl).uploadCover('t', 'o1', {
      fileName: 'cover.jpg',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    });
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    expect(headersOf(calls[0])['Content-Type']).toBeUndefined();
    expect(saved).toMatchObject({ coverUrl: 'https://r2.example/c.jpg', attendeesRounded: 20 });
  });
});

describe('adattatore http: errori', () => {
  it('traduce i codici del contratto e gli stati HTTP', async () => {
    const cases: [number, unknown, string, string?][] = [
      [401, { error: { code: 'unauthorized' } }, 'unauthorized'],
      [403, undefined, 'forbidden'],
      [409, { error: { code: 'company.domain.inUse' } }, 'conflict', 'domains'],
      [400, { error: { code: 'confirmation.mismatch' } }, 'validation', 'confirmName'],
      [
        400,
        { error: { code: 'validation', fields: ['explanation must be longer'] } },
        'validation',
        'explanation',
      ],
      [400, { error: { code: 'code.invalid' } }, 'invalid_code'],
      [429, { error: { code: 'rate_limited' } }, 'too_many_attempts'],
      [400, { error: { code: 'sconosciuto' } }, 'validation'],
      [503, undefined, 'unavailable'],
    ];
    for (const [status, body, expected, field] of cases) {
      const client = api(fakeFetch(status, body).impl);
      const error = await client.getStats('t').catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: expected });
      if (field) expect(error).toMatchObject({ details: { field } });
    }
  });
});
