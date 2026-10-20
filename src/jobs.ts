import 'reflect-metadata';

/**
 * Avvio dei processi pianificati (`node dist/jobs.js daily` / `hourly`).
 * [Da fare] I comandi dei processi (architettura, "Processi pianificati"): pulizia delle
 * registrazioni abbandonate, applicazione delle modifiche delle aziende escluse, scadenze
 * dell'approvazione, controllo di coerenza della regola core, ...
 */
const kind = process.argv[2];
if (kind !== 'daily' && kind !== 'hourly') {
  process.stderr.write('Uso: node dist/jobs.js daily|hourly\n');
  process.exit(2);
}
process.stdout.write(`Nessun processo ${kind} ancora disponibile\n`);
