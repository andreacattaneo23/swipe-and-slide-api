/**
 * Design token, font e logo del backoffice (D92, D200): copia il kit di brand e genera i fogli di
 * stile con le variabili CSS.
 *
 *   npm run tokens            copia byte per byte tokens.json, i font con le licenze OFL e il logo
 *                             orizzontale piccolo (D219); scrive kit.json con le impronte SHA-256;
 *                             genera src/design/tokens.css dalla copia
 *   npm run tokens:check      confronta copie e file generati con quelli che lo script scriverebbe;
 *                             esce con codice 1 se c'è una differenza
 *
 * Nel foglio di stile entrano solo i ruoli semantici dei colori (`color.semantic`), mai i colori di
 * base, le famiglie dei font, le spaziature e i raggi. Il backoffice non usa il design system
 * dell'app (D92): solo colori e font del brand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findDocsRoot, sha256, writeOrCheck } from './kit.mjs';

const check = process.argv.includes('--check');
const docs = findDocsRoot();

const FONTS = [
  'Newsreader-Regular.ttf',
  'Newsreader-Medium.ttf',
  'NunitoSans-Regular.ttf',
  'NunitoSans-SemiBold.ttf',
  'NunitoSans-Bold.ttf',
  'OFL-Newsreader.txt',
  'OFL-NunitoSans.txt',
];
const LOGOS = ['logo-orizzontale-piccolo-positivo.svg'];

const sources = [
  { from: 'design/token/tokens.json', to: 'src/design/source/tokens.json' },
  ...FONTS.map((name) => ({ from: `design/font/${name}`, to: `src/design/fonts/${name}` })),
  ...LOGOS.map((name) => ({ from: `design/logo/${name}`, to: `public/brand/${name}` })),
  // Icona della scheda del browser (D126), con la convenzione di Next.js per app/icon.svg.
  { from: 'design/logo/favicon.svg', to: 'src/app/icon.svg' },
];

const copies = sources.map((source) => ({
  path: source.to,
  content: fs.readFileSync(path.join(docs, source.from)),
}));

const tokens = JSON.parse(copies[0].content.toString('utf8'));

/** Risolve un alias `{group.token}` nel valore finale. */
function resolve(value, depth = 0) {
  if (typeof value !== 'string' || !value.startsWith('{')) return value;
  if (depth > 10) throw new Error(`Alias circolare: ${value}`);
  const node = value
    .slice(1, -1)
    .split('.')
    .reduce((acc, key) => acc?.[key], tokens);
  if (!node || !('$value' in node)) throw new Error(`Alias non trovato: ${value}`);
  return resolve(node.$value, depth + 1);
}

/** camelCase → kebab-case per i nomi delle variabili CSS. */
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Raccoglie le foglie `$value` di un gruppo con il loro percorso. */
function leaves(group, prefix = []) {
  return Object.entries(group).flatMap(([key, node]) => {
    if (key.startsWith('$') || typeof node !== 'object' || node === null) return [];
    if ('$value' in node) return [[[...prefix, key], node.$value]];
    return leaves(node, [...prefix, key]);
  });
}

const lines = [];
for (const [keys, value] of leaves(tokens.color.semantic)) {
  lines.push(`  --color-${keys.map(kebab).join('-')}: ${resolve(value)};`);
}
for (const [name, family] of Object.entries({
  headings: tokens.font.family.headings.$value,
  body: tokens.font.family.body.$value,
})) {
  const list = resolve(family)
    .map((item) => (item.includes(' ') ? `'${item}'` : item))
    .join(', ');
  lines.push(`  --font-${name}-fallback: ${list};`);
}
for (const [keys, value] of leaves(tokens.spacing)) {
  if (keys[0] === 'usage') continue;
  lines.push(`  --space-${keys.join('-')}: ${resolve(value)};`);
}
for (const [keys, value] of leaves(tokens.radius)) {
  if (keys[0] === 'usage') continue;
  lines.push(`  --radius-${keys.join('-')}: ${resolve(value)};`);
}

const css = `/* Generato da npm run tokens a partire da src/design/source/tokens.json: non modificare a mano. */
/* Versione dei token: ${tokens.$extensions?.['it.swipeandslide']?.version ?? 'n.d.'} */
:root {
${lines.join('\n')}
}
`;

const kit = {
  description: 'Copie del kit di brand: origine relativa alla cartella docs/ della radice.',
  files: sources.map((source, index) => ({
    source: source.from,
    copy: source.to,
    sha256: sha256(copies[index].content),
  })),
};

writeOrCheck(
  [
    ...copies,
    { path: 'src/design/tokens.css', content: css },
    { path: 'src/design/source/kit.json', content: `${JSON.stringify(kit, null, 2)}\n` },
  ],
  check,
  'Token',
);
