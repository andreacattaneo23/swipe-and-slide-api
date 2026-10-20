import { redirect } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { homeFor } from '@/lib/roles';
import { t } from '@/texts';
import { currentOperator } from '@/server/auth';
import { readSignInFlow } from '@/server/session';
import { SignInForm } from './SignInForm';

export default async function LoginPage() {
  const current = await currentOperator();
  if (current) redirect(homeFor(current.operator.roles));
  const flow = await readSignInFlow();
  const step = flow?.step ?? 'email';

  return (
    <main className="sign-in">
      <div className="sign-in__card">
        <BrandMark />
        <span className="pill pill--sand">{t('backoffice.name')}</span>
        <SignInForm step={step} maskedEmail={flow?.maskedEmail ?? ''} />
      </div>
    </main>
  );
}
