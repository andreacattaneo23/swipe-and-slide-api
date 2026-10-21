// @vitest-environment node
import type { Mock } from 'vitest';
import { cookieJar, form, run } from '@/test/next-mocks';
import { initialFormState } from '@/lib/form-state';
import type { OperatorRole } from '@/lib/roles';
import { AdminApiError, setAdminApiForTests, type AdminApi } from '@/server/admin-api';
import { requestCode, signOut, verifySignIn } from '@/app/login/actions';
import {
  addDomainAction,
  changeCompanyAction,
  createCompanyAction,
  startRemovalAction,
} from '@/app/(console)/companies/actions';
import { decideApproval, decideNewPhotoAction } from '@/app/(console)/approvals/actions';

/**
 * Gestori lato server con un doppio di admin-api definito qui (D240): ogni metodo è una funzione
 * spia che, se il test non la prepara, risponde "unavailable".
 */
type Stub = { [K in keyof AdminApi]: Mock };

function stubApi(): Stub {
  const fns = new Map<string, Mock>();
  return new Proxy({} as Stub, {
    get: (_target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (!fns.has(key)) {
        fns.set(
          key,
          vi.fn(async () => {
            throw new AdminApiError('unavailable');
          }),
        );
      }
      return fns.get(key);
    },
  });
}

const CODE = '482913';
const ADMIN = 'admin@swipeandslide.example';
const MODERATOR = 'moderatore@swipeandslide.example';
const ROLES: Record<string, OperatorRole[]> = { [ADMIN]: ['admin'], [MODERATOR]: ['moderator'] };
let api: Stub;

beforeEach(() => {
  cookieJar.clear();
  api = stubApi();
  api.requestSignInCode.mockResolvedValue(undefined);
  api.signOut.mockResolvedValue(undefined);
  api.verifySignIn.mockImplementation(async (email: string, code: string) => {
    if (code !== CODE) throw new AdminApiError('invalid_code', { remainingAttempts: 4 });
    if (!ROLES[email]) throw new AdminApiError('invalid_credentials');
    return { token: `token-${email}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  });
  api.getCurrentOperator.mockImplementation(async (token: string) => {
    const email = token.replace('token-', '');
    if (!ROLES[email]) throw new AdminApiError('unauthorized');
    return { id: email, name: email, roles: ROLES[email] };
  });
  setAdminApiForTests(api as unknown as AdminApi);
});

afterAll(() => setAdminApiForTests(undefined));

async function signIn(email: string) {
  await run(() => requestCode(initialFormState, form({ email })));
  return run(() => verifySignIn(initialFormState, form({ code: CODE })));
}

describe("gestori lato server dell'accesso", () => {
  it('due passi, poi la prima sezione del ruolo e un cookie HttpOnly SameSite=Strict', async () => {
    expect(await signIn(ADMIN)).toEqual({ redirect: '/companies' });
    const session = cookieJar.get('bo_session');
    expect(session?.options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
    expect(cookieJar.has('bo_sign_in')).toBe(false);
  });

  it('l’email della procedura e il token non sono in chiaro nei cookie', async () => {
    await run(() => requestCode(initialFormState, form({ email: ADMIN })));
    expect(cookieJar.get('bo_sign_in')?.value).not.toContain('admin');
    await run(() => verifySignIn(initialFormState, form({ code: CODE })));
    expect(api.verifySignIn).toHaveBeenCalledWith(ADMIN, CODE);
    expect(cookieJar.get('bo_session')?.value).not.toContain(`token-${ADMIN}`);
  });

  it('il Moderatore entra nella coda delle approvazioni', async () => {
    expect(await signIn(MODERATOR)).toEqual({ redirect: '/approvals' });
  });

  it('codice sbagliato: errore sul campo con i tentativi rimasti', async () => {
    await run(() => requestCode(initialFormState, form({ email: ADMIN })));
    const state = await run(() => verifySignIn(initialFormState, form({ code: '000 000' })));
    expect(state).toMatchObject({
      status: 'error',
      fieldErrors: { code: 'Codice non valido. Ti restano 4 tentativi.' },
    });
  });

  it('indirizzo che non è di un operatore: messaggio unico, nessuna sessione', async () => {
    await run(() => requestCode(initialFormState, form({ email: 'altro@swipeandslide.example' })));
    const state = await run(() => verifySignIn(initialFormState, form({ code: CODE })));
    expect(state).toMatchObject({
      status: 'error',
      message: 'Codice non valido.',
    });
    expect(cookieJar.has('bo_session')).toBe(false);
  });

  it('codici di formato sbagliato: nessuna chiamata ad admin-api', async () => {
    await run(() => requestCode(initialFormState, form({ email: ADMIN })));
    const spy = api.verifySignIn;
    spy.mockClear();
    const state = await run(() => verifySignIn(initialFormState, form({ code: '12' })));
    expect(state).toMatchObject({ fieldErrors: { code: 'Il codice ha 6 cifre.' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('senza la procedura in corso la verifica non vale', async () => {
    const state = await run(() => verifySignIn(initialFormState, form({ code: CODE })));
    expect(state).toMatchObject({ status: 'error' });
    expect(cookieJar.has('bo_session')).toBe(false);
  });

  it("l'uscita chiude la sessione anche in admin-api", async () => {
    await signIn(ADMIN);
    const spy = api.signOut;
    expect(await run(() => signOut())).toEqual({ redirect: '/login' });
    expect(spy).toHaveBeenCalledOnce();
    expect(cookieJar.has('bo_session')).toBe(false);
  });
});

describe('gestori lato server delle aziende', () => {
  it('senza sessione si torna all’accesso', async () => {
    const result = await run(() =>
      startRemovalAction(initialFormState, form({ companyId: 'c-fictional' })),
    );
    expect(result).toEqual({ redirect: '/login' });
  });

  it('il Moderatore non può rimuovere un’azienda', async () => {
    await signIn(MODERATOR);
    const result = await run(() =>
      startRemovalAction(initialFormState, form({ companyId: 'c-fictional' })),
    );
    expect(result).toEqual({ redirect: '/approvals' });
  });

  it('rimozione: motivazione e nome obbligatori, senza codice (D91, D93, D244)', async () => {
    await signIn(ADMIN);
    const missing = await run(() =>
      startRemovalAction(
        initialFormState,
        form({
          companyId: 'c-fictional',
          expectedName: 'Studio Fittizio',
          confirmName: 'Studio',
        }),
      ),
    );
    expect(api.startRemoval).not.toHaveBeenCalled();
    api.startRemoval.mockResolvedValue({});
    expect(missing).toMatchObject({
      status: 'error',
      fieldErrors: {
        explanation: 'Scrivi la motivazione, da 3 a 500 caratteri: è obbligatoria.',
        confirmName: "Il nome non corrisponde a quello dell'azienda.",
      },
    });
    const done = await run(() =>
      startRemovalAction(
        initialFormState,
        form({
          companyId: 'c-fictional',
          expectedName: 'Studio Fittizio',
          explanation: 'Società non più attiva',
          confirmName: 'Studio Fittizio',
        }),
      ),
    );
    expect(done).toMatchObject({ status: 'success' });
  });

  it('il nome giusto non basta se il nome atteso del modulo è falsato: decide admin-api', async () => {
    await signIn(ADMIN);
    api.startRemoval.mockRejectedValue(new AdminApiError('validation', { field: 'confirmName' }));
    const result = await run(() =>
      startRemovalAction(
        initialFormState,
        form({
          companyId: 'c-fictional',
          expectedName: 'Altro',
          explanation: 'Società chiusa',
          confirmName: 'Altro',
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { confirmName: expect.any(String) },
    });
  });

  it('nuova azienda dimostrativa dalla casella del modulo (D42)', async () => {
    await signIn(ADMIN);
    const spy = api.createCompany;
    spy.mockResolvedValue({});
    const data = form({
      name: 'Demo Gamma',
      domains: 'gamma.demo-revisione.example',
      explanation: 'Revisione degli store',
    });
    data.set('isDemo', 'on');
    expect(await run(() => createCompanyAction(initialFormState, data))).toMatchObject({
      status: 'success',
    });
    expect(spy).toHaveBeenCalledWith(expect.any(String), {
      name: 'Demo Gamma',
      domains: ['gamma.demo-revisione.example'],
      isDemo: true,
      explanation: 'Revisione degli store',
    });
  });

  it('un dominio già usato torna sul campo', async () => {
    await signIn(ADMIN);
    api.addDomain.mockRejectedValue(new AdminApiError('conflict', { field: 'domain' }));
    const state = await run(() =>
      addDomainAction(
        initialFormState,
        form({ companyId: 'c-model', domain: 'prova.example', explanation: 'Nuovo dominio' }),
      ),
    );
    expect(state).toMatchObject({
      fieldErrors: { domain: "Questo dominio è già di un'altra azienda." },
    });
  });

  it('fusione tra reale e dimostrativa rifiutata con un messaggio chiaro', async () => {
    await signIn(ADMIN);
    api.mergeCompany.mockRejectedValue(new AdminApiError('conflict', { field: 'targetCompanyId' }));
    const state = await run(() =>
      changeCompanyAction(
        initialFormState,
        form({
          kind: 'merge',
          companyId: 'c-trial',
          targetCompanyId: 'c-demo',
          explanation: 'Stesso gruppo',
          expectedName: 'Trial Consulting',
          confirmName: 'Trial Consulting',
        }),
      ),
    );
    expect(state).toMatchObject({
      fieldErrors: {
        targetCompanyId: 'Aziende reali e dimostrative non si uniscono e non si scambiano domini.',
      },
    });
  });
});

describe('gestori lato server delle approvazioni', () => {
  it('rifiuto senza motivo, testo né motivazione: errori e nessuna chiamata (D142)', async () => {
    await signIn(MODERATOR);
    const spy = api.rejectProfile;
    const state = await run(() =>
      decideApproval(initialFormState, form({ reviewId: 'r-marco', decision: 'reject' })),
    );
    expect(state).toMatchObject({
      status: 'error',
      fieldErrors: {
        reason: 'Scegli il motivo del rifiuto.',
        userExplanation: expect.any(String),
        explanation: expect.any(String),
      },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('l’approvazione chiede solo la motivazione', async () => {
    await signIn(MODERATOR);
    api.approveProfile.mockResolvedValue(undefined);
    const result = await run(() =>
      decideApproval(
        initialFormState,
        form({ reviewId: 'r-elena', decision: 'approve', explanation: 'Profilo conforme' }),
      ),
    );
    expect(result).toEqual({ redirect: '/approvals?done=approved' });
  });

  it('rifiuto completo: chiamata ad admin-api e ritorno alla coda', async () => {
    await signIn(MODERATOR);
    const spy = api.rejectProfile;
    spy.mockResolvedValue({ attempt: 1, blocked: false });
    const result = await run(() =>
      decideApproval(
        initialFormState,
        form({
          reviewId: 'r-marco',
          decision: 'reject',
          reason: 'photos_without_person',
          userExplanation: 'Carica una foto in cui ti si vede.',
          explanation: 'Foto non reale',
        }),
      ),
    );
    expect(result).toEqual({ redirect: '/approvals?done=rejected' });
    expect(spy).toHaveBeenCalledWith(expect.any(String), 'r-marco', {
      reason: 'photos_without_person',
      explanation: 'Foto non reale',
      userExplanation: 'Carica una foto in cui ti si vede.',
    });
  });

  it('terzo rifiuto: la coda annuncia il blocco delle email (D142)', async () => {
    await signIn(MODERATOR);
    api.rejectProfile.mockResolvedValue({ attempt: 3, blocked: true });
    const result = await run(() =>
      decideApproval(
        initialFormState,
        form({
          reviewId: 'r-davide',
          decision: 'reject',
          reason: 'fake_profile',
          userExplanation: 'Usa foto tue.',
          explanation: 'Profilo falso',
        }),
      ),
    );
    expect(result).toEqual({ redirect: '/approvals?done=blocked' });
  });

  it('foto nuova rifiutata con la motivazione (D143)', async () => {
    await signIn(MODERATOR);
    api.decideNewPhoto.mockResolvedValue(undefined);
    const state = await run(() =>
      decideNewPhotoAction(
        initialFormState,
        form({ photoId: 'np-1', outcome: 'rejected', explanation: 'Foto non conforme' }),
      ),
    );
    expect(state).toMatchObject({ status: 'success', message: 'Foto rifiutata.' });
  });
});
