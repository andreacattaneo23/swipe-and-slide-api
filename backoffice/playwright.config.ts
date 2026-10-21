import { defineConfig, devices } from '@playwright/test';

/**
 * Prove end to end del backoffice sul sistema vero (D240): admin-api in esecuzione (di base
 * http://localhost:3001, con PostgreSQL, Redis e il seed del backend) e Mailpit per il codice
 * dell'operatore. Il backoffice parte qui in sviluppo su una porta sua (E2E_PORT, di base 3110),
 * così non tocca il dev sulla 3100. Variabili in .env.example.
 */
const port = Number(process.env.E2E_PORT ?? 3110);

export default defineConfig({
  testDir: 'e2e',
  // Un solo operatore e una sola casella di Mailpit: i test vanno uno alla volta.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
  },
  projects: [
    // Un solo accesso con il codice da Mailpit, poi le prove riusano la sessione salvata
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/operator.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ADMIN_API_URL: process.env.ADMIN_API_URL ?? 'http://localhost:3001',
    },
  },
});
