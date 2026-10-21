// @vitest-environment node
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { cookieJar, form, run } from '@/test/next-mocks';
import { initialFormState } from '@/lib/form-state';
import type { OperatorRole } from '@/lib/roles';
import { AdminApiError, setAdminApiForTests, type AdminApi } from '@/server/admin-api';
import { requestCode, verifySignIn } from '@/app/login/actions';
import {
  deleteUserAction,
  revealEmailAction,
  sanctionAction,
  searchUsersAction,
} from '@/app/(console)/users/actions';
import { decideCaseAction } from '@/app/(console)/moderation/actions';
import { decideAppealAction } from '@/app/(console)/appeals/actions';
import { cancelOffsiteAction, saveOffsite } from '@/app/(console)/offsites/actions';
import { updateLimitAction } from '@/app/(console)/config/actions';
import { openWindowAction } from '@/app/(console)/demo/actions';
import { respondWaitlistAction } from '@/app/(console)/requests/actions';
import { GET as exportAudit } from '@/app/(console)/audit/export/route';

/** Doppio di admin-api definito qui (D240): metodi spia, "unavailable" se non preparati. */
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

const ROLES: Record<string, OperatorRole[]> = {
  admin: ['admin'],
  moderatore: ['moderator'],
  supporto: ['support'],
};
let api: Stub;

beforeEach(() => {
  cookieJar.clear();
  api = stubApi();
  api.requestSignInCode.mockResolvedValue(undefined);
  api.verifySignIn.mockImplementation(async (email: string) => ({
    token: email.split('@')[0],
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }));
  api.getCurrentOperator.mockImplementation(async (token: string) => ({
    id: token,
    name: token,
    roles: ROLES[token],
  }));
  setAdminApiForTests(api as unknown as AdminApi);
});

afterAll(() => setAdminApiForTests(undefined));

async function signIn(who: 'admin' | 'moderatore' | 'supporto') {
  cookieJar.clear();
  await run(() => requestCode(initialFormState, form({ email: `${who}@swipeandslide.example` })));
  await run(() => verifySignIn(initialFormState, form({ code: '482913' })));
}

const forbidden = () => new AdminApiError('forbidden');

describe('utenti (D89–D93)', () => {
  it('ricerca per email: risultati mascherati, e il campo non torna al browser', async () => {
    await signIn('supporto');
    api.searchUsers.mockResolvedValue([
      {
        id: 'u-2087',
        firstName: 'Luca',
        status: 'active',
        isDemo: false,
        companyName: 'Prova Advisory',
        maskedWorkEmail: 'l•••@provaadvisory.example',
        createdAt: '2026-08-01T10:00:00.000Z',
      },
    ]);
    const state = await searchUsersAction(
      { status: 'idle' },
      form({ query: 'Luca@ProvaAdvisory.example' }),
    );
    expect(api.searchUsers).toHaveBeenCalledWith('supporto', {
      email: 'luca@provaadvisory.example',
    });
    expect(state.results?.map((item) => item.id)).toEqual(['u-2087']);
    expect(JSON.stringify(state)).not.toContain('luca@');
    expect(state.values).toBeUndefined();
  });

  it('un indirizzo incompleto non parte', async () => {
    await signIn('supporto');
    const spy = api.searchUsers;
    const state = await searchUsersAction({ status: 'idle' }, form({ query: 'luca@' }));
    expect(state.fieldErrors?.query).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('la rivelazione restituisce l’indirizzo una volta, con la motivazione', async () => {
    await signIn('supporto');
    const missing = await run(() =>
      revealEmailAction(initialFormState, form({ userId: 'u-1042', kind: 'personal' })),
    );
    expect(missing).toMatchObject({ fieldErrors: { explanation: expect.any(String) } });
    api.revealEmail.mockResolvedValue({ kind: 'personal', email: 'giulia.prova@posta.example' });
    const state = await run(() =>
      revealEmailAction(
        initialFormState,
        form({ userId: 'u-1042', kind: 'personal', explanation: 'Richiesta privacy' }),
      ),
    );
    expect(state).toMatchObject({
      status: 'success',
      result: [{ label: 'Email personale', value: 'giulia.prova@posta.example' }],
    });
  });

  it('il Supporto non applica sanzioni: decide admin-api', async () => {
    await signIn('supporto');
    api.sanctionUser.mockRejectedValue(forbidden());
    const state = await run(() =>
      sanctionAction(
        initialFormState,
        form({
          userId: 'u-1042',
          type: 'warning',
          userExplanation: 'Hai scritto messaggi offensivi.',
          explanation: 'Messaggi offensivi',
        }),
      ),
    );
    expect(state).toMatchObject({ message: 'Il tuo ruolo non permette questa azione.' });
  });

  it('cancellazione: identificativo esatto, poi ritorno alla ricerca', async () => {
    await signIn('admin');
    const wrong = await run(() =>
      deleteUserAction(
        initialFormState,
        form({
          userId: 'u-1042',
          confirmName: 'Giulia',
          explanation: 'Richiesta di cancellazione',
        }),
      ),
    );
    expect(wrong).toMatchObject({
      fieldErrors: { confirmName: "L'identificativo non corrisponde a quello dell'account." },
    });
    expect(api.deleteUser).not.toHaveBeenCalled();
    api.deleteUser.mockResolvedValue(undefined);
    const done = await run(() =>
      deleteUserAction(
        initialFormState,
        form({
          userId: 'u-1042',
          confirmName: 'u-1042',
          explanation: 'Richiesta di cancellazione',
        }),
      ),
    );
    expect(done).toEqual({ redirect: '/users?deleted=1' });
  });
});

describe('moderazione e ricorsi (D74, D75, D197)', () => {
  it('la sanzione da un caso chiede il testo per l’utente', async () => {
    await signIn('moderatore');
    const missing = await run(() =>
      decideCaseAction(
        initialFormState,
        form({ caseId: 'm-101', decision: 'warning', explanation: 'Messaggi insistenti' }),
      ),
    );
    expect(missing).toMatchObject({ fieldErrors: { userExplanation: expect.any(String) } });
    api.decideCase.mockResolvedValue(undefined);
    const archived = await run(() =>
      decideCaseAction(
        initialFormState,
        form({ caseId: 'm-103', decision: 'dismiss', explanation: 'Foto conforme' }),
      ),
    );
    expect(archived).toEqual({ redirect: '/moderation?done=1' });
  });

  it('il Moderatore che ha deciso la sanzione non decide il ricorso', async () => {
    await signIn('moderatore');
    api.decideAppeal.mockRejectedValueOnce(forbidden()).mockResolvedValue(undefined);
    const state = await run(() =>
      decideAppealAction(
        initialFormState,
        form({ appealId: 'a-201', outcome: 'upheld', explanation: 'Accolto' }),
      ),
    );
    expect(state).toMatchObject({ message: 'Il tuo ruolo non permette questa azione.' });
    await signIn('supporto');
    const done = await run(() =>
      decideAppealAction(
        initialFormState,
        form({ appealId: 'a-201', outcome: 'upheld', explanation: 'Nessuno spam' }),
      ),
    );
    expect(done).toEqual({ redirect: '/appeals?done=1' });
  });
});

describe('offsite, richieste, configurazione e account dimostrativi', () => {
  const offsite = {
    title: 'Cena di networking',
    description: 'Una cena tra consulenti',
    venueName: 'Trattoria Fittizia',
    venueAddress: 'Corso Esempio 40',
    cityId: 'city-torino',
    date: '2026-11-04',
    start: '20:00',
    end: '23:00',
    capacity: '40',
  };

  it('nuovo offsite pubblicato con la copertina caricata dal modulo', async () => {
    await signIn('admin');
    api.createOffsite.mockResolvedValue({ id: 'o-new', status: 'draft' });
    api.publishOffsite.mockResolvedValue({ id: 'o-new', status: 'published' });
    const spy = api.uploadCover;
    spy.mockResolvedValue({ id: 'o-new' });
    const data = form({ ...offsite, decision: 'publish' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    data.set('cover', new File([png], 'copertina.png', { type: 'image/png' }));
    const result = (await run(() => saveOffsite(initialFormState, data))) as { redirect: string };
    expect(result.redirect).toBe('/offsites/o-new?done=published');
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      fileName: 'cover.png',
      contentType: 'image/png',
      bytes: png,
    });
  });

  it('una copertina che non è un’immagine torna sul campo, senza chiamate', async () => {
    await signIn('admin');
    const spy = api.createOffsite;
    const data = form(offsite);
    data.set('cover', new File(['<svg/>'], 'copertina.png', { type: 'image/png' }));
    const state = await run(() => saveOffsite(initialFormState, data));
    expect(state).toMatchObject({ fieldErrors: { cover: expect.any(String) } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('modifica di un offsite esistente e annullamento con la motivazione', async () => {
    await signIn('admin');
    const spy = api.updateOffsite;
    spy.mockResolvedValue({ id: 'o-cena', status: 'draft' });
    api.cancelOffsite.mockResolvedValue({ id: 'o-cena', status: 'cancelled' });
    const result = await run(() =>
      saveOffsite(initialFormState, form({ ...offsite, offsiteId: 'o-cena', decision: 'draft' })),
    );
    expect(result).toEqual({ redirect: '/offsites/o-cena?done=saved' });
    expect(spy).toHaveBeenCalledWith(expect.any(String), 'o-cena', {
      title: 'Cena di networking',
      description: 'Una cena tra consulenti',
      venueName: 'Trattoria Fittizia',
      venueAddress: 'Corso Esempio 40',
      cityId: 'city-torino',
      startsAt: '2026-11-04T19:00:00.000Z',
      endsAt: '2026-11-04T22:00:00.000Z',
      capacity: 40,
    });
    const cancelled = await run(() =>
      cancelOffsiteAction(initialFormState, form({ offsiteId: 'o-cena', explanation: 'Maltempo' })),
    );
    expect(cancelled).toMatchObject({ status: 'success' });
  });

  it('risposta alla lista d’attesa con l’esito', async () => {
    await signIn('admin');
    api.respondWaitlist.mockResolvedValue(undefined);
    const state = await run(() =>
      respondWaitlistAction(
        initialFormState,
        form({ groupId: 'w-1', outcome: 'not_added', explanation: 'Non è consulenza' }),
      ),
    );
    expect(state).toMatchObject({ status: 'success' });
    expect(api.respondWaitlist).toHaveBeenCalledWith('admin', 'w-1', {
      outcome: 'not_added',
      explanation: 'Non è consulenza',
    });
  });

  it('limite fuori dall’intervallo: errore sul campo da admin-api', async () => {
    await signIn('admin');
    api.updateLimit.mockRejectedValue(new AdminApiError('validation', { field: 'value' }));
    const state = await run(() =>
      updateLimitAction(
        initialFormState,
        form({ key: 'reviewWindowMaxDays', value: '30', explanation: 'Più lunga' }),
      ),
    );
    expect(state).toMatchObject({ fieldErrors: { value: 'Valore fuori dai limiti ammessi.' } });
  });

  it('finestra di revisione: il codice arriva una volta nel risultato', async () => {
    await signIn('admin');
    api.openReviewWindow.mockResolvedValue({ window: { id: 'rw' }, code: '204816' });
    const state = await run(() =>
      openWindowAction(
        initialFormState,
        form({
          store: 'google',
          days: '7',
          explanation: 'Revisione 1.0',
        }),
      ),
    );
    expect(state).toMatchObject({
      status: 'success',
      result: [{ label: 'Codice di revisione', value: expect.stringMatching(/^\d{6}$/) }],
    });
  });
});

describe('esportazione dell’audit', () => {
  it('CSV scaricabile, senza cache, solo per l’Amministratore', async () => {
    await signIn('admin');
    api.exportAudit.mockResolvedValue({
      fileName: 'audit-2026-10-20.csv',
      csv: 'id,at,type,action,operator,subject,explanation\n',
    });
    const response = await exportAudit(
      new NextRequest('http://localhost/audit/export?type=action'),
    );
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="audit-/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.text()).split('\n')[0]).toBe(
      'id,at,type,action,operator,subject,explanation',
    );
    expect(api.exportAudit).toHaveBeenCalledWith('admin', { type: 'action', cursor: undefined });
    await signIn('supporto');
    await expect(
      run(() => exportAudit(new NextRequest('http://localhost/audit/export'))),
    ).resolves.toEqual({ redirect: '/users' });
  });
});
