// Tre progetti Jest: unità (senza database), suite della regola core (RC) e integrazione,
// entrambe su PostgreSQL reale (`swipe_slide_test`), con le stesse migrazioni della produzione.
/** @type {import('jest').Config} */
const common = {
  testEnvironment: 'node',
  transform: {
    // jose ed expo-server-sdk sono ESM: ts-jest li trasforma in CommonJS come il codice del progetto
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(jose|@scure|@noble|expo-server-sdk)/)'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};

module.exports = {
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...common,
      displayName: 'core-rule',
      testMatch: ['<rootDir>/test/core-rule/**/*.test.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
    },
    {
      // Sistema vero (D240): PostgreSQL, MinIO e Mailpit avviati in locale
      ...common,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e.test.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
    },
  ],
};
