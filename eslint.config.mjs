// Configurazione di ESLint: TypeScript stretto con i controlli sui tipi e i confini tra i servizi
// (D231): `src/app/` non importa mai `src/admin/` e viceversa, così l'API pubblica non contiene
// codice di amministrazione; `src/realtime/` non tocca il database.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Regola dei confini: vieta gli import verso le cartelle indicate. */
const forbid = (folders, message) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: folders.map((folder) => ({
        group: [`**/${folder}`, `**/${folder}/**`],
        message,
      })),
    },
  ],
});

export default tseslint.config(
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', 'openapi/', '**/*.js', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // I DTO e i moduli di Nest usano i tipi a runtime (decoratori con i metadati): gli import di
    // soli tipi spezzerebbero l'iniezione delle dipendenze e la validazione.
    files: ['src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  { files: ['src/app/**/*.ts'], rules: forbid(['admin'], 'src/app non importa src/admin (D231)') },
  { files: ['src/admin/**/*.ts'], rules: forbid(['app'], 'src/admin non importa src/app (D231)') },
  {
    files: ['src/core/**/*.ts', 'src/domain/**/*.ts', 'src/infra/**/*.ts'],
    rules: forbid(['app', 'admin'], 'Il nucleo non dipende dai servizi app e admin (D231)'),
  },
  {
    files: ['src/realtime/**/*.ts'],
    rules: forbid(['app', 'admin', 'infra/database'], 'realtime non accede al database (D182)'),
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
