/**
 * ESLint 9 (configurazione flat): regole di Next.js (Core Web Vitals e TypeScript), più due
 * controlli del progetto:
 * - nessun colore scritto a mano nei componenti: i colori vengono dalle variabili di tokens.css;
 * - i moduli lato server (`src/server/`) non si importano dai componenti client.
 * In fondo `eslint-config-prettier`: la formattazione la controlla solo Prettier.
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const hex = '#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/^\\s*(${hex}\\s*$|(rgba?|hsla?)\\()/i]`,
          message: 'Colore scritto a mano: usa le variabili CSS dei token (tokens.css).',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/texts/source/**',
    'public/**',
  ]),
]);
