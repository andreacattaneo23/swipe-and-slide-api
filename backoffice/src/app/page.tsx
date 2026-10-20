import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/roles';
import { currentOperator } from '@/server/auth';

// Ingresso: la prima sezione permessa dal ruolo, oppure l'accesso.
export default async function Home() {
  const current = await currentOperator();
  redirect(current ? homeFor(current.operator.roles) : '/login');
}
