/**
 * Funzioni comuni agli script che copiano il kit di brand (token, font, logo e testi) dalla radice
 * dei documenti nel backoffice (D200, D209).
 *
 * La radice dei documenti si cerca accanto al repository del backend: prima ../docs (backend dentro
 * la radice del progetto), poi ../../swipe-and-slide-root/docs (repository affiancati, anche da un
 * worktree affiancato). Con `--kit <cartella>` si indica la cartella docs/ a mano.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Radice del progetto Next.js del backoffice. */
export const BACKOFFICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Trova la cartella docs/ della radice dei documenti; esce con un errore se non c'è. */
export function findDocsRoot(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--kit');
  const candidates =
    index >= 0 && argv[index + 1]
      ? [path.resolve(process.cwd(), argv[index + 1])]
      : [
          path.resolve(BACKOFFICE_ROOT, '../../docs'),
          path.resolve(BACKOFFICE_ROOT, '../../swipe-and-slide-root/docs'),
          path.resolve(BACKOFFICE_ROOT, '../../../swipe-and-slide-root/docs'),
        ];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'design')));
  if (!found) {
    console.error(`Kit di brand non trovato. Cercato in:\n  ${candidates.join('\n  ')}`);
    console.error('Usa --kit <cartella docs/ della radice>.');
    process.exit(1);
  }
  return found;
}

/** Impronta SHA-256 di un file o di un testo. */
export function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Scrive un file creando le cartelle che mancano. */
export function writeFile(relativePath, content) {
  const target = path.join(BACKOFFICE_ROOT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Legge un file del backoffice, o null se non esiste. */
export function readFile(relativePath) {
  const target = path.join(BACKOFFICE_ROOT, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target) : null;
}

/**
 * Confronta i file attesi con quelli presenti; in modalità controllo stampa le differenze ed esce
 * con 1, altrimenti scrive i file.
 * @param {Array<{ path: string, content: string | Buffer }>} files
 * @param {boolean} check
 * @param {string} label
 */
export function writeOrCheck(files, check, label) {
  if (!check) {
    for (const file of files) writeFile(file.path, file.content);
    console.log(`${label}: scritti ${files.length} file.`);
    return;
  }
  const different = files.filter((file) => {
    const current = readFile(file.path);
    return !current || !current.equals(Buffer.from(file.content));
  });
  if (different.length > 0) {
    console.error(`${label}: copie non allineate al kit (lancia lo script senza --check):`);
    for (const file of different) console.error(`  ${file.path}`);
    process.exit(1);
  }
  console.log(`${label}: copie allineate al kit (${files.length} file).`);
}
