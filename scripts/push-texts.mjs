/**
 * Testi delle notifiche push del backend (D209): li copia da testi.js della radice, l'unica fonte
 * dei testi dell'app, e genera src/domain/notifications/push-texts.ts. Nessun testo delle notifiche
 * si scrive a mano nel codice.
 *
 *   node scripts/push-texts.mjs           genera il file
 *   node scripts/push-texts.mjs --check   esce con 1 se il file non è aggiornato
 *   node scripts/push-texts.mjs --kit <cartella docs/>   indica la radice dei documenti a mano
 *
 * La radice dei documenti si cerca accanto al repository: ../swipe-and-slide-root/docs (anche da
 * un worktree affiancato) oppure ../docs.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'src/domain/notifications/push-texts.ts');

/** Chiavi di testi.js usate dalle notifiche push (architettura, "Notifiche push"). */
const KEYS = [
  'notification.match',
  'notification.message',
  'notification.escalation',
  'notification.invite',
  'invite.accepted',
  'invite.toReschedule',
  'notification.meetingTomorrow',
  'notification.expiry',
  'reverification.title',
  'notification.ooo',
  'notification.offsite.tomorrow',
  'notification.offsite.updated',
  'notification.offsite.cancelled',
  'approval.approved',
  'approval.notification',
];

const argv = process.argv.slice(2);
const kit = argv.indexOf('--kit');
const candidates =
  kit >= 0
    ? [path.resolve(argv[kit + 1])]
    : [
        path.resolve(ROOT, '../swipe-and-slide-root/docs'),
        path.resolve(ROOT, '../docs'),
        path.resolve(ROOT, '../../swipe-and-slide-root/docs'),
      ];
const docs = candidates.find((dir) => fs.existsSync(path.join(dir, 'design')));
if (!docs) {
  console.error(`Radice dei documenti non trovata. Cercata in:\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}
const source = fs.readFileSync(path.join(docs, 'design/sorgente/mockup/testi.js'), 'utf8');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source, sandbox, { filename: 'testi.js' });
const all = sandbox.module.exports;
const missing = KEYS.filter((key) => !(key in all));
if (missing.length > 0) {
  console.error(`Chiavi assenti da testi.js: ${missing.join(', ')}`);
  process.exit(1);
}
const lines = KEYS.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(all[key][0])},`);
const content = `// Generato da scripts/push-texts.mjs a partire da testi.js della radice (D209): non modificare a
// mano. Testi delle notifiche push, a tema e senza nomi, foto né anteprime (D65).
export const pushTexts = {
${lines.join('\n')}
} as const;

export type PushTextKey = keyof typeof pushTexts;
`;
if (argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
  if (current !== content) {
    console.error(`${OUTPUT} non è aggiornato: esegui node scripts/push-texts.mjs`);
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUTPUT, content);
  console.log(`Scritto ${OUTPUT}`);
}
