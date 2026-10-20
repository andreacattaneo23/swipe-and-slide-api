// @vitest-environment node
import { cookieJar, form, run } from '@/test/next-mocks';
import { initialFormState } from '@/lib/form-state';
import { setAdminApiForTests } from '@/server/admin-api';
import { MockAdminApi } from '@/server/admin-api/mock/mock-admin-api';
import { requestCode, signOut, verifyCode, verifyTotp } from '@/app/login/actions';
import { startRemovalAction } from '@/app/(console)/companies/actions';
import { decideApproval } from '@/app/(console)/approvals/actions';

const CODE = '482913';
let api: MockAdminApi;

beforeEach(() => {
  cookieJar.clear();
  api = new MockAdminApi({ signInCode: () => CODE, deliverCode: () => {} });
  setAdminApiForTests(api);
});

afterAll(() => setAdminApiForTests(undefined));

async function signIn(email: string) {
  await run(() => requestCode(initialFormState, form({ email })));
  await run(() => verifyCode(initialFormState, form({ code: CODE })));
  return run(() => verifyTotp(initialFormState, form({ totpCode: api.currentTotp() })));
}

describe("gestori lato server dell'accesso", () => {
  it('tre passi, poi la prima sezione del ruolo e un cookie HttpOnly SameSite=Strict', async () => {
    expect(await signIn('admin@swipeandslide.example')).toEqual({ redirect: '/companies' });
    const session = cookieJar.get('bo_session');
    expect(session?.options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
    expect(cookieJar.has('bo_sign_in')).toBe(false);
  });

  it('il cookie non contiene il token dell’operatore in chiaro', async () => {
    const spy = vi.spyOn(api, 'verifyTotp');
    await signIn('moderatore@swipeandslide.example');
    const token = (await spy.mock.results[0]?.value)?.token as string;
    expect(token).toBeTruthy();
    expect(cookieJar.get('bo_session')?.value).not.toContain(token);
  });

  it('il Moderatore entra nella coda delle approvazioni', async () => {
    expect(await signIn('moderatore@swipeandslide.example')).toEqual({ redirect: '/approvals' });
  });

  it('codice sbagliato: errore sul campo con i tentativi rimasti', async () => {
    await run(() => requestCode(initialFormState, form({ email: 'admin@swipeandslide.example' })));
    const state = await run(() => verifyCode(initialFormState, form({ code: '000 000' })));
    expect(state).toMatchObject({
      status: 'error',
      fieldErrors: { code: 'Codice non valido. Ti restano 4 tentativi.' },
    });
  });

  it('senza la procedura in corso il TOTP non vale', async () => {
    const state = await run(() =>
      verifyTotp(initialFormState, form({ totpCode: api.currentTotp() })),
    );
    expect(state).toMatchObject({ status: 'error' });
    expect(cookieJar.has('bo_session')).toBe(false);
  });

  it("l'uscita chiude la sessione anche in admin-api", async () => {
    await signIn('admin@swipeandslide.example');
    const spy = vi.spyOn(api, 'signOut');
    expect(await run(() => signOut())).toEqual({ redirect: '/login' });
    expect(spy).toHaveBeenCalledOnce();
    expect(cookieJar.has('bo_session')).toBe(false);
  });
});

describe('gestori lato server delle azioni', () => {
  it('senza sessione si torna all’accesso', async () => {
    const result = await run(() =>
      startRemovalAction(initialFormState, form({ companyId: 'c-fictional' })),
    );
    expect(result).toEqual({ redirect: '/login' });
  });

  it('il Moderatore non può rimuovere un’azienda', async () => {
    await signIn('moderatore@swipeandslide.example');
    const result = await run(() =>
      startRemovalAction(initialFormState, form({ companyId: 'c-fictional' })),
    );
    expect(result).toEqual({ redirect: '/approvals' });
  });

  it('rimozione: motivazione, nome e codice obbligatori (D91, D93)', async () => {
    await signIn('admin@swipeandslide.example');
    const missing = await run(() =>
      startRemovalAction(
        initialFormState,
        form({
          companyId: 'c-fictional',
          expectedName: 'Studio Fittizio',
          confirmName: 'Studio',
          totpCode: '12',
        }),
      ),
    );
    expect(missing).toMatchObject({
      status: 'error',
      fieldErrors: {
        explanation: 'Scrivi la motivazione: è obbligatoria.',
        confirmName: "Il nome non corrisponde a quello dell'azienda.",
        totpCode: 'Il codice ha 6 cifre.',
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
          totpCode: api.currentTotp(),
        }),
      ),
    );
    expect(done).toMatchObject({ status: 'success' });
  });

  it('il nome giusto non basta se il nome atteso del modulo è falsato: decide admin-api', async () => {
    await signIn('admin@swipeandslide.example');
    const result = await run(() =>
      startRemovalAction(
        initialFormState,
        form({
          companyId: 'c-fictional',
          expectedName: 'Altro',
          explanation: 'm',
          confirmName: 'Altro',
          totpCode: api.currentTotp(),
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { confirmName: expect.any(String) },
    });
  });

  it('rifiuto senza motivo né motivazione: errori e nessuna chiamata (D142)', async () => {
    await signIn('moderatore@swipeandslide.example');
    const spy = vi.spyOn(api, 'rejectProfile');
    const state = await run(() =>
      decideApproval(initialFormState, form({ reviewId: 'r-marco', decision: 'reject' })),
    );
    expect(state).toMatchObject({
      status: 'error',
      fieldErrors: { reason: 'Scegli il motivo del rifiuto.', explanation: expect.any(String) },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rifiuto completo: chiamata ad admin-api e ritorno alla coda', async () => {
    await signIn('moderatore@swipeandslide.example');
    const spy = vi.spyOn(api, 'rejectProfile');
    const result = await run(() =>
      decideApproval(
        initialFormState,
        form({
          reviewId: 'r-marco',
          decision: 'reject',
          reason: 'non_compliant_photo',
          explanation: 'Foto non reale',
        }),
      ),
    );
    expect(result).toEqual({ redirect: '/approvals?done=rejected' });
    expect(spy).toHaveBeenCalledWith(expect.any(String), 'r-marco', {
      reason: 'non_compliant_photo',
      explanation: 'Foto non reale',
    });
  });
});
