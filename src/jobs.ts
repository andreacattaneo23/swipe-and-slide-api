import 'reflect-metadata';
import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './infra/config/config';
import { FEED_CHAT_DAILY_JOBS, FEED_CHAT_HOURLY_JOBS } from './jobs/feed-chat.jobs';
import { type Job, type JobSource, type SourceJob } from './jobs/job';
import { JobsModule } from './jobs/jobs.module';
import { ProfileAccountJobs } from './jobs/profile-account.jobs';
import { SAFETY_ADMIN_JOBS } from './jobs/safety-admin.jobs';

type Kind = 'daily' | 'hourly';

/** Adatta un processo di un servizio Nest alla forma comune (esito sempre come conteggi). */
const fromSource = (job: SourceJob): Job => ({
  name: job.name,
  async run() {
    const result = await job.run();
    return typeof result === 'number' ? { count: result } : result;
  },
});

/**
 * Elenco dei processi per cadenza. Ogni dominio aggiunge i suoi in fondo: gli elenchi statici
 * direttamente, i servizi Nest (`JobSource`) dal contesto.
 */
function jobsOf(context: INestApplicationContext, kind: Kind): Job[] {
  const sources: JobSource[] = [context.get(ProfileAccountJobs)];
  const fromSources = sources.flatMap((source) =>
    (kind === 'daily' ? source.daily() : source.hourly()).map(fromSource),
  );
  const lists: Record<Kind, Job[]> = {
    daily: [...FEED_CHAT_DAILY_JOBS],
    hourly: [...FEED_CHAT_HOURLY_JOBS],
  };
  lists[kind].push(...SAFETY_ADMIN_JOBS.filter((job) => job.schedule === kind));
  return [...fromSources, ...lists[kind]];
}

/**
 * Avvio dei processi pianificati (`node dist/jobs.js daily|hourly [nome]`, oppure
 * `node dist/jobs.js run <nome>` per uno solo di qualsiasi cadenza). Ogni processo gira da sé: un
 * errore non ferma gli altri e il codice d'uscita lo segnala. I registri contengono solo nomi e
 * conteggi, mai dati personali.
 */
async function main(args: string[]): Promise<number> {
  const [kind, name] = args;
  if (kind !== 'daily' && kind !== 'hourly' && !(kind === 'run' && name)) {
    process.stderr.write('Uso: node dist/jobs.js daily|hourly [nome] | run <nome>\n');
    return 2;
  }
  const context = await NestFactory.createApplicationContext(JobsModule.forRoot(loadConfig()), {
    logger: ['error', 'warn'],
  });
  let failures = 0;
  try {
    const all =
      kind === 'run'
        ? [...jobsOf(context, 'daily'), ...jobsOf(context, 'hourly')]
        : jobsOf(context, kind);
    const jobs = name ? all.filter((job) => job.name === name) : all;
    if (!jobs.length) {
      process.stderr.write(`Processo sconosciuto: ${name}\n`);
      return 2;
    }
    for (const job of jobs) {
      try {
        const counts = await job.run(context);
        process.stdout.write(`${JSON.stringify({ job: job.name, ...counts })}\n`);
      } catch (error) {
        failures += 1;
        process.stderr.write(
          `${JSON.stringify({ job: job.name, error: error instanceof Error ? error.message.split('\n')[0] : 'errore' })}\n`,
        );
      }
    }
  } finally {
    await context.close();
  }
  return failures === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
