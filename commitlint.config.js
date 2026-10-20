/**
 * Configurazione di commitlint (D201): Conventional Commits con i testi in italiano, secondo le
 * regole del git-master.
 *
 * Nessun hook git: niente husky né lefthook. commitlint lo esegue il git-master prima di ogni
 * commit (`echo "<messaggio>" | npx commitlint`) e la GitHub Action `pr-title.yml` sul titolo
 * di ogni PR, che diventa il commit dello squash su `main`.
 *
 * Formato: `<tipo>(<ambito>): <descrizione>`, con i tipi standard in inglese (`feat`, `fix`,
 * `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`).
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Intestazione di al massimo 72 caratteri in tutto.
    'header-max-length': [2, 'always', 72],
    // Descrizione con l'iniziale minuscola (imperativo presente: "aggiungi", "correggi") e
    // senza punto finale.
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-full-stop': [2, 'never', '.'],
    // Ambito facoltativo, in italiano e in kebab-case (es. `regola-core`, `registrazione`).
    'scope-case': [2, 'always', 'kebab-case'],
    // Corpo e footer: una riga vuota prima, righe di al massimo 100 caratteri.
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [2, 'always', 100],
    'footer-leading-blank': [2, 'always'],
    'footer-max-line-length': [2, 'always', 100],
  },
};
