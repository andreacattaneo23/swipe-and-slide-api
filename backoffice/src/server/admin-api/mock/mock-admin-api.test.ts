// @vitest-environment node
import { AdminApiError } from '../types';
import { MockAdminApi } from './mock-admin-api';

const CODE = '482913';

function setup() {
  let now = new Date('2026-10-20T10:00:00Z');
  const delivered: string[] = [];
  const api = new MockAdminApi({
    now: () => now,
    signInCode: () => CODE,
    deliverCode: (email) => delivered.push(email),
  });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  async function signIn(email = 'admin@swipeandslide.example') {
    const challenge = await api.requestSignInCode(email);
    await api.verifySignInCode(challenge.challengeId, CODE);
    return api.verifyTotp(challenge.challengeId, api.currentTotp());
  }
  return { api, delivered, advance, signIn };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof AdminApiError ? error.code : 'other'),
  );

describe('adattatore mock: accesso degli operatori (D88, D231)', () => {
  it('apre la sessione con codice e TOTP; il ruolo arriva con l’operatore', async () => {
    const { api, signIn } = setup();
    const session = await signIn();
    expect(session.operator.roles).toEqual(['admin']);
    await expect(api.getCurrentOperator(session.token)).resolves.toMatchObject({ id: 'op-admin' });
  });

  it('risposta uguale per ogni email; il codice parte solo verso un operatore', async () => {
    const { api, delivered } = setup();
    const known = await api.requestSignInCode('admin@swipeandslide.example');
    const unknown = await api.requestSignInCode('chiunque@esempio.example');
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
    expect(delivered).toEqual(['admin@swipeandslide.example']);
    expect(await code(api.verifySignInCode(unknown.challengeId, CODE))).toBe('invalid_code');
  });

  it('massimo 5 tentativi del codice, poi serve un codice nuovo', async () => {
    const { api } = setup();
    const { challengeId } = await api.requestSignInCode('admin@swipeandslide.example');
    for (let attempt = 1; attempt <= 4; attempt++) {
      await expect(api.verifySignInCode(challengeId, '000000')).rejects.toMatchObject({
        code: 'invalid_code',
        details: { remainingAttempts: 5 - attempt },
      });
    }
    expect(await code(api.verifySignInCode(challengeId, '000000'))).toBe('too_many_attempts');
    expect(await code(api.verifySignInCode(challengeId, CODE))).toBe('too_many_attempts');
  });

  it('il codice scade dopo 10 minuti', async () => {
    const { api, advance } = setup();
    const { challengeId } = await api.requestSignInCode('admin@swipeandslide.example');
    advance(10 * 60_000 + 1);
    expect(await code(api.verifySignInCode(challengeId, CODE))).toBe('code_expired');
  });

  it('senza secondo fattore non c’è sessione e il TOTP non si salta', async () => {
    const { api } = setup();
    const { challengeId } = await api.requestSignInCode('admin@swipeandslide.example');
    expect(await code(api.verifyTotp(challengeId, api.currentTotp()))).toBe('code_expired');
    await api.verifySignInCode(challengeId, CODE);
    expect(await code(api.verifyTotp(challengeId, '123'))).toBe('invalid_totp');
  });

  it('la sessione dura 8 ore e l’uscita la chiude', async () => {
    const { api, advance, signIn } = setup();
    const first = await signIn();
    await api.signOut(first.token);
    expect(await code(api.getCurrentOperator(first.token))).toBe('unauthorized');
    const second = await signIn();
    advance(8 * 3_600_000);
    expect(await code(api.getCurrentOperator(second.token))).toBe('unauthorized');
  });

  it('il ruolo si controlla a ogni richiesta: il Moderatore non tocca le aziende', async () => {
    const { api, signIn } = setup();
    const session = await signIn('moderatore@swipeandslide.example');
    expect(await code(api.listCompanies(session.token))).toBe('forbidden');
    expect(await code(api.getApprovalQueue(session.token))).toBe('ok');
    const support = await signIn('supporto@swipeandslide.example');
    expect(await code(api.getApprovalQueue(support.token))).toBe('forbidden');
  });
});

describe('adattatore mock: aziende (D85, D93, D111, D120)', () => {
  it('cerca per nome o dominio', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn();
    expect((await api.listCompanies(token, 'fittizio')).map((item) => item.name)).toEqual([
      'Studio Fittizio',
    ]);
    expect((await api.listCompanies(token, 'prova.example')).map((item) => item.name)).toEqual([
      'Prova Advisory',
    ]);
  });

  it('la rimozione chiede motivazione, nome esatto e TOTP; poi resta annullabile', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn();
    const valid = {
      explanation: 'Non più attiva',
      confirmName: 'Studio Fittizio',
      totpCode: api.currentTotp(),
    };
    expect(await code(api.startRemoval(token, 'c-fictional', { ...valid, explanation: ' ' }))).toBe(
      'validation',
    );
    expect(
      await code(
        api.startRemoval(token, 'c-fictional', { ...valid, confirmName: 'studio fittizio' }),
      ),
    ).toBe('validation');
    expect(
      await code(api.startRemoval(token, 'c-fictional', { ...valid, totpCode: '000000' })),
    ).toBe('invalid_totp');

    const removing = await api.startRemoval(token, 'c-fictional', valid);
    expect(removing.status).toBe('removing');
    expect(removing.removalFinalAt).toBe('2026-10-21T10:00:00.000Z');
    expect(await code(api.startRemoval(token, 'c-fictional', valid))).toBe('conflict');

    expect(await code(api.cancelRemoval(token, 'c-fictional', { explanation: '' }))).toBe(
      'validation',
    );
    const restored = await api.cancelRemoval(token, 'c-fictional', { explanation: 'Errore' });
    expect(restored).toMatchObject({ status: 'active', removalFinalAt: null });
  });

  it('una nuova azienda ha solo nome e domini, mai un dominio già usato', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn();
    const created = await api.createCompany(token, {
      name: 'Nuova Consulenza',
      domains: ['Nuova.Example', 'nuova.example'],
      explanation: 'Richiesta approvata',
    });
    expect(created.domains).toEqual(['nuova.example']);
    expect(
      await code(
        api.createCompany(token, { name: 'Altra', domains: ['prova.example'], explanation: 'x' }),
      ),
    ).toBe('conflict');
    expect(
      await code(
        api.createCompany(token, { name: 'Altra', domains: ['non un dominio'], explanation: 'x' }),
      ),
    ).toBe('validation');
  });
});

describe('adattatore mock: approvazioni (D90, D141, D142)', () => {
  it('coda dal più vecchio e dettaglio senza dati vietati', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn('moderatore@swipeandslide.example');
    const queue = await api.getApprovalQueue(token);
    expect(queue.profiles[0]?.name).toBe('Marco');
    const detail = await api.getApproval(token, 'r-marco');
    const forbidden = [
      'email',
      'interestedIn',
      'excludedCompanies',
      'openSpace',
      'company',
      'companyId',
      'city',
      'birthDate',
    ];
    expect(Object.keys(detail).filter((key) => forbidden.includes(key))).toEqual([]);
  });

  it('il rifiuto chiede un motivo dell’elenco e la motivazione; la decisione toglie il profilo dalla coda', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn('moderatore@swipeandslide.example');
    expect(
      await code(api.rejectProfile(token, 'r-marco', { reason: 'boh' as never, explanation: 'x' })),
    ).toBe('validation');
    expect(
      await code(api.rejectProfile(token, 'r-marco', { reason: 'fake_profile', explanation: ' ' })),
    ).toBe('validation');
    await api.rejectProfile(token, 'r-marco', {
      reason: 'non_compliant_photo',
      explanation: 'Foto',
    });
    await api.approveProfile(token, 'r-elena', { explanation: 'Profilo conforme' });
    const queue = await api.getApprovalQueue(token);
    expect(queue.profiles.map((item) => item.id)).not.toContain('r-marco');
    expect(queue.profilesCount).toBe(3);
  });
});

describe('adattatore mock: offsite (D150, D153, D167)', () => {
  it('bozza e pubblicazione, senza elenco degli iscritti', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn();
    const draft = await api.createOffsite(token, {
      title: 'Aperitivo di fine quarter',
      description: 'Un aperitivo',
      venueName: 'Terrazza Esempio',
      venueAddress: "Via dell'Esempio 12, Milano",
      cityId: 'city-milano',
      startsAt: '2026-10-15T16:30:00.000Z',
      endsAt: '2026-10-15T19:00:00.000Z',
      capacity: 80,
    });
    expect(draft).toMatchObject({ status: 'draft', attendeesRounded: null });
    expect(Object.keys(draft)).not.toContain('attendees');
    expect((await api.publishOffsite(token, draft.id)).status).toBe('published');
    expect(await code(api.publishOffsite(token, draft.id))).toBe('conflict');
  });

  it('la fine viene dopo l’inizio', async () => {
    const { api, signIn } = setup();
    const { token } = await signIn();
    const result = api.createOffsite(token, {
      title: 'T',
      description: 'D',
      venueName: 'V',
      venueAddress: 'A',
      cityId: 'city-milano',
      startsAt: '2026-10-15T19:00:00.000Z',
      endsAt: '2026-10-15T18:00:00.000Z',
      capacity: null,
    });
    await expect(result).rejects.toMatchObject({
      code: 'validation',
      details: { field: 'endsAt' },
    });
  });
});
