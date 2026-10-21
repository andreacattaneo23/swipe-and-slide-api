import { test as setup } from '@playwright/test';
import { SESSION_FILE, signIn } from './support';

/**
 * Un solo accesso dell'operatore per tutta la prova (email e codice da Mailpit, D244): le prove
 * riusano la sessione salvata, così non si mandano codici a ogni prova.
 */
setup('accesso dell’operatore con il codice da Mailpit', async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: SESSION_FILE });
});
