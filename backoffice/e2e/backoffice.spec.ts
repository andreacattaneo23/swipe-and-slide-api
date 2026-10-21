import { expect, test } from '@playwright/test';

/**
 * Percorsi principali del backoffice contro admin-api vera (contratto finale di `feat/integrazione`):
 * accesso con il codice da Mailpit (`auth.setup.ts`, senza secondo fattore, D244), aziende, approvazioni, offsite con una
 * bozza nuova, tutte le altre sezioni, ricerca degli utenti, configurazione e uscita.
 */

test.describe('senza sessione', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('ogni sezione rimanda all’accesso', async ({ page }) => {
    await page.goto('/companies');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Accesso al backoffice' })).toBeVisible();
  });

  test('intestazioni di sicurezza della pagina di accesso', async ({ page }) => {
    const response = await page.goto('/login');
    const headers = response!.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['cache-control']).toBe('no-store');
  });
});

test('cookie della sessione dopo l’accesso', async ({ context }) => {
  const session = (await context.cookies()).find((cookie) => cookie.name.endsWith('bo_session'));
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
});

test('aziende: elenco, ricerca e scheda di modifica', async ({ page }) => {
  await page.goto('/companies');
  await expect(page.getByRole('heading', { name: 'Aziende', level: 1 })).toBeVisible();
  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();
  const name = (await rows.first().locator('th').textContent())!.trim();
  await page.getByRole('searchbox', { name: 'Cerca per nome o dominio' }).fill(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('table tbody tr').first().locator('th')).toHaveText(name);
  await page.getByRole('link', { name: `Modifica ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Domini' })).toBeVisible();
});

test('approvazioni: la coda si apre dal più vecchio', async ({ page }) => {
  await page.goto('/approvals');
  await expect(page.getByRole('heading', { name: 'Approvazioni', level: 1 })).toBeVisible();
  await expect(page.getByText('Prima i più vecchi')).toBeVisible();
});

test('offsite: nuova bozza salvata e riaperta', async ({ page }) => {
  await page.goto('/offsites/new');
  const title = `Prova e2e ${Date.now()}`;
  await page.getByLabel('Titolo').fill(title);
  await page.getByLabel('Descrizione').fill('Bozza creata dalle prove end to end del backoffice.');
  await page.getByLabel('Nome del luogo').fill('Terrazza di prova');
  await page.getByLabel('Indirizzo').fill('Via di prova 1');
  const city = page.getByLabel('Città');
  if (await city.count()) await city.selectOption({ index: 1 });
  else await page.getByLabel('Codice ISTAT del comune').fill('015146');
  await page.getByLabel('Data').fill('2027-03-18');
  await page.getByLabel('Inizio').fill('18:30');
  await page.getByLabel('Fine').fill('21:00');
  await page.getByRole('button', { name: 'Salva la bozza' }).click();
  await expect(page).toHaveURL(/\/offsites\/[\w-]+\?done=draft$/);
  await expect(page.getByText('Bozza salvata.')).toBeVisible();
  await page.goto('/offsites');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});

// Ogni sezione legge admin-api vera: titolo della pagina e nessun errore del servizio
for (const [path, heading] of [
  ['/requests', 'Richieste di aggiunta'],
  ['/users', 'Utenti'],
  ['/moderation', 'Moderazione'],
  ['/appeals', 'Ricorsi'],
  ['/demo', 'Account dimostrativi'],
  ['/audit', 'Audit'],
  ['/stats', 'Statistiche'],
  ['/config', 'Configurazione'],
] as const) {
  test(`${heading}: la sezione si apre con i dati di admin-api`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText('Qualcosa non è andato')).toHaveCount(0);
  });
}

test('utenti: ricerca per email esatta dal seed', async ({ page }) => {
  await page.goto('/users');
  const search = page.getByRole('searchbox').first();
  await search.fill('luca.conti@personale.example');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Qualcosa non è andato')).toHaveCount(0);
  await expect(page.locator('table tbody tr, [role="list"] li').first()).toBeVisible();
});

test('configurazione: limiti e tassonomie a tema del profilo', async ({ page }) => {
  await page.goto('/config');
  await expect(page.getByText('Qualcosa non è andato')).toHaveCount(0);
  await expect(page.getByText(/interess/i).first()).toBeVisible();
});

// Ultima prova: l'uscita revoca la sessione condivisa
test('uscita: la sessione si chiude', async ({ page }) => {
  await page.goto('/companies');
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/companies');
  await expect(page).toHaveURL(/\/login$/);
});
