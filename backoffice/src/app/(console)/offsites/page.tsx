import { redirect } from 'next/navigation';

// In questa fase la sezione Offsite apre il modulo del nuovo offsite (mockup 18d).
export default function OffsitesPage() {
  redirect('/offsites/new');
}
