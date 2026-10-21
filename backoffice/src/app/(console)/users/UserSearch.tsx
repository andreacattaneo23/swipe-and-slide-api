'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button, Note, TextInput } from '@/components/ui';
import { ACCOUNT_STATUS } from '@/lib/labels';
import { formatDate } from '@/lib/time';
import { t } from '@/texts';
import { searchUsersAction, type SearchState } from './actions';

const initial: SearchState = { status: 'idle' };

/** Ricerca degli utenti (D89, D197): per email esatta o identificativo, risultati mascherati. */
export function UserSearch() {
  const [state, action, pending] = useActionState(searchUsersAction, initial);
  return (
    <>
      <form action={action} className="sheet panel search-form" role="search" noValidate>
        <TextInput
          label={t('backoffice.users.search.label')}
          hint={t('backoffice.users.search.hint')}
          name="query"
          type="search"
          autoComplete="off"
          spellCheck={false}
          required
          error={state.fieldErrors?.query}
        />
        <Button type="submit" icon="search" disabled={pending}>
          {t('backoffice.users.search.submit')}
        </Button>
        <Note icon="lock">{t('backoffice.users.search.note')}</Note>
      </form>
      {state.status === 'error' && state.message ? (
        <p className="form-message form-message--error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.results ? (
        <div className="sheet table-sheet" aria-live="polite">
          {state.results.length === 0 ? (
            <p className="empty">{t('backoffice.users.search.empty')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('backoffice.users.column.user')}</th>
                  <th scope="col">{t('backoffice.column.company')}</th>
                  <th scope="col">{t('backoffice.users.workEmail')}</th>
                  <th scope="col">{t('backoffice.column.status')}</th>
                  <th scope="col">{t('backoffice.users.column.created')}</th>
                </tr>
              </thead>
              <tbody>
                {state.results.map((user) => (
                  <tr key={user.id}>
                    <th scope="row" className="table__name">
                      <Link href={`/users/${encodeURIComponent(user.id)}`}>
                        {user.firstName ?? t('backoffice.users.noName')}
                      </Link>
                      <span className="table__sub">{user.id}</span>
                    </th>
                    <td>{user.companyName ?? '—'}</td>
                    <td className="mono">{user.maskedWorkEmail ?? '—'}</td>
                    <td>
                      <span className="status status--demo">{t(ACCOUNT_STATUS[user.status])}</span>
                      {user.isDemo ? (
                        <span className="status status--demo">{t('backoffice.demo')}</span>
                      ) : null}
                    </td>
                    <td className="table__number">{formatDate(new Date(user.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </>
  );
}
