'use server';

/**
 * Gestori lato server delle azioni sugli utenti (D89–D93, D197): ricerca senza email in chiaro nei
 * risultati, rivelazione registrata nell'audit, ri-verifica forzata, sanzioni, riattivazione e
 * cancellazione con la conferma rafforzata. Motivazione obbligatoria su ogni azione (D91).
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { getAdminApi, type SanctionInput, type UserSummary } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { errorState } from '@/server/form-errors';
import { explanationError, field, perform, userTextError } from '@/server/perform';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SearchState extends FormState {
  results?: UserSummary[];
}

/**
 * Ricerca per email (corrispondenza esatta) o per identificativo. È un'azione e non un indirizzo
 * con la query, così l'email cercata non resta nella cronologia del browser né nei log.
 */
export async function searchUsersAction(
  _prev: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const { token } = await requireOperator('users');
  const query = field(formData, 'query', 254);
  const byEmail = query.includes('@');
  if (!query || (byEmail && !EMAIL_PATTERN.test(query))) {
    return { status: 'error', fieldErrors: { query: t('backoffice.users.search.error') } };
  }
  try {
    const results = await getAdminApi().searchUsers(
      token,
      byEmail ? { email: query.toLowerCase() } : { id: query },
    );
    // Il campo si svuota: nessuna email cercata torna al browser.
    return { status: 'success', results };
  } catch (error) {
    return errorState(error);
  }
}

export async function revealEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = field(formData, 'userId');
  const kind = field(formData, 'kind') === 'work' ? 'work' : 'personal';
  const explanation = field(formData, 'explanation');
  return perform(
    'users',
    { values: { explanation }, errors: { explanation: explanationError(explanation) } },
    async (api, token) => {
      const revealed = await api.revealEmail(token, userId, kind, { explanation });
      return {
        status: 'success',
        message: t('backoffice.users.reveal.done'),
        result: [
          {
            label: t(
              kind === 'work' ? 'backoffice.users.workEmail' : 'backoffice.users.personalEmail',
            ),
            value: revealed.email,
          },
        ],
      };
    },
  );
}

export async function reverifyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = field(formData, 'userId');
  const explanation = field(formData, 'explanation');
  return perform(
    'users',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: [`/users/${userId}`],
    },
    async (api, token) => {
      await api.forceReverification(token, userId, { explanation });
      return 'backoffice.users.reverify.done';
    },
  );
}

export async function reactivateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = field(formData, 'userId');
  const explanation = field(formData, 'explanation');
  return perform(
    'users',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: [`/users/${userId}`],
    },
    async (api, token) => {
      await api.reactivateUser(token, userId, { explanation });
      return 'backoffice.users.reactivate.done';
    },
  );
}

const SANCTIONS: readonly SanctionInput['type'][] = [
  'warning',
  'disciplinary_suspension',
  'expulsion',
];

export async function sanctionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = field(formData, 'userId');
  const type = field(formData, 'type') as SanctionInput['type'];
  const explanation = field(formData, 'explanation');
  const userExplanation = field(formData, 'userExplanation', 1000);
  return perform(
    'users',
    {
      values: { type, explanation, userExplanation },
      errors: {
        type: SANCTIONS.includes(type) ? undefined : t('backoffice.error.required'),
        userExplanation: userTextError(userExplanation),
        explanation: explanationError(explanation),
      },
      revalidate: [`/users/${userId}`],
    },
    async (api, token) => {
      await api.sanctionUser(token, userId, { type, explanation, userExplanation });
      return 'backoffice.users.sanction.done';
    },
  );
}

export async function deleteUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = field(formData, 'userId');
  const explanation = field(formData, 'explanation');
  const confirmName = field(formData, 'confirmName');
  const state = await perform(
    'users',
    {
      values: { explanation, confirmName },
      errors: {
        explanation: explanationError(explanation),
        confirmName: confirmName === userId ? undefined : t('backoffice.error.accountId'),
      },
      fields: { confirmName: 'backoffice.error.accountId' },
      revalidate: ['/users'],
    },
    async (api, token) => {
      await api.deleteUser(token, userId, { explanation, confirmName });
      return 'backoffice.users.delete.done';
    },
  );
  if (state.status === 'success') redirect('/users?deleted=1');
  return state;
}
