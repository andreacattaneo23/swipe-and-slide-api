/**
 * Testi del backoffice (D209): copia testi.js dal kit di brand e genera src/texts/it.ts.
 *
 *   npm run texts             copia testi.js byte per byte, scrive kit.json e genera it.ts
 *   npm run texts:check       confronta copia e it.ts con quelli che lo script scriverebbe; esce con
 *                             codice 1 se c'è una differenza
 *
 * In it.ts entrano, con la stessa chiave e lo stesso testo della sorgente:
 * - le chiavi `backoffice.` tranne i contenuti fittizi (origine F), che nel backoffice sono dati e
 *   arrivano dall'adattatore delle API;
 * - le chiavi comuni elencate in SHARED_KEYS (marchio, pulsanti generici, codici, errori, motivi).
 * I testi che servono al backoffice e non sono ancora in testi.js stanno in
 * src/texts/proposed.ts, segnati come proposte da approvare (D209): dopo l'approvazione entrano in
 * testi.js e si tolgono da lì.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { findDocsRoot, sha256, writeOrCheck } from './kit.mjs';

const check = process.argv.includes('--check');
const docs = findDocsRoot();
const SOURCE = 'design/sorgente/mockup/testi.js';

/** Chiavi fuori dal prefisso `backoffice.` usate dal backoffice. */
export const SHARED_KEYS = [
  'brand.swipe',
  'brand.amp',
  'brand.slide',
  'common.cancel',
  'common.close',
  'common.next',
  'common.retry',
  'common.save',
  'common.saved',
  'common.optional',
  'common.optionalFeminine',
  'signIn.title',
  'signIn.email.label',
  'signIn.email.placeholder',
  'code.wrong',
  'code.wrong.one',
  'code.expired',
  'code.attempts',
  'a11y.code',
  'a11y.loading',
  'error.generic.serious',
  'error.network',
  'error.session',
  'reason.photos',
  'deck.bio',
  'offsite.under10',
  'offsite1.attendees',
];

const content = fs.readFileSync(path.join(docs, SOURCE));
const sandbox = { module: { exports: {} } };
vm.runInNewContext(content.toString('utf8'), sandbox, { filename: 'testi.js' });
const all = sandbox.module.exports;

const missing = SHARED_KEYS.filter((key) => !(key in all));
if (missing.length > 0) {
  console.error(`Chiavi comuni assenti da testi.js: ${missing.join(', ')}`);
  process.exit(1);
}

const selected = Object.entries(all).filter(
  ([key, [, origin]]) =>
    (key.startsWith('backoffice.') && origin !== 'F') || SHARED_KEYS.includes(key),
);
selected.sort(([a], [b]) => a.localeCompare(b));

const body = selected.map(([key, [text]]) => `  ${JSON.stringify(key)}: ${JSON.stringify(text)},`);
const it = `// Generato da npm run texts a partire da src/texts/source/texts.js: non modificare a mano.
// Fonte unica dei testi: docs/design/sorgente/mockup/testi.js della radice (D209).
export const texts = {
${body.join('\n')}
} as const;
`;

const kit = {
  description: 'Copia dei testi: origine relativa alla cartella docs/ della radice.',
  source: SOURCE,
  copy: 'src/texts/source/texts.js',
  sha256: sha256(content),
  keys: selected.length,
};

writeOrCheck(
  [
    { path: 'src/texts/source/texts.js', content },
    { path: 'src/texts/it.ts', content: it },
    { path: 'src/texts/source/kit.json', content: `${JSON.stringify(kit, null, 2)}\n` },
  ],
  check,
  'Testi',
);
