/**
 * Operatore della richiesta corrente. Il ruolo arriva da admin-api a ogni richiesta (D231), mai
 * dal cookie: il menu si costruisce da quello e la sezione si apre solo se il ruolo la permette.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { canOpen, homeFor, type SectionId } from '@/lib/roles';
import { AdminApiError, getAdminApi, type Operator } from './admin-api';
import { readSession } from './session';

export interface CurrentOperator {
  operator: Operator;
  token: string;
}

/** Operatore della richiesta, una sola chiamata ad admin-api per richiesta. */
export const currentOperator = cache(async (): Promise<CurrentOperator | null> => {
  const session = await readSession();
  if (!session) return null;
  try {
    const operator = await getAdminApi().getCurrentOperator(session.token);
    return { operator, token: session.token };
  } catch (error) {
    if (
      error instanceof AdminApiError &&
      (error.code === 'unauthorized' || error.code === 'forbidden')
    ) {
      return null;
    }
    throw error;
  }
});

/** Operatore obbligatorio; con una sezione, anche il ruolo che la apre. */
export async function requireOperator(section?: SectionId): Promise<CurrentOperator> {
  const current = await currentOperator();
  if (!current) redirect('/login');
  if (section && !canOpen(current.operator.roles, section))
    redirect(homeFor(current.operator.roles));
  return current;
}
