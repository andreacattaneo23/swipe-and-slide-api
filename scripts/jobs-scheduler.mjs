/**
 * Programmatore locale dei processi pianificati (`npm run dev:stack`): in produzione li avvia lo
 * scheduler del cloud (`daily-jobs` di notte, `hourly-jobs` ogni ora). Qui `hourly` all'avvio e
 * poi a ogni ora piena, `daily` alle 3 (ora italiana); un passaggio alla volta, mai due insieme.
 * Ogni processo stampa solo nome e conteggi (`dist/jobs.js`).
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAILY_HOUR = 3;
let running = false;
let lastDaily = '';

function romeNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function runJobs(kind) {
  return new Promise((resolve) => {
    const child = spawn('node', ['--env-file-if-exists=.env', 'dist/jobs.js', kind], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code !== 0) console.error(`Processi ${kind}: uscita ${code}`);
      resolve();
    });
  });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = romeNow();
    if (now.hour === DAILY_HOUR && lastDaily !== now.day) {
      lastDaily = now.day;
      await runJobs('daily');
    }
    await runJobs('hourly');
  } finally {
    running = false;
  }
}

/** Millisecondi fino alla prossima ora piena. */
const untilNextHour = () => 3_600_000 - (Date.now() % 3_600_000);

console.log('Programmatore dei processi: hourly ora e a ogni ora piena, daily alle 3');
void tick();
setTimeout(function schedule() {
  void tick();
  setTimeout(schedule, untilNextHour());
}, untilNextHour());
