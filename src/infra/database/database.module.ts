import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DATABASE, PG_POOL } from './database';
import * as schema from './schema';

/** Crea il pool con il ruolo del servizio e un pool piccolo per istanza (D231). */
export function createPool(databaseUrl: string, role: string | null, max = 5): Pool {
  if (role && !/^[a-z_]+$/.test(role)) throw new Error('DATABASE_ROLE non valido');
  // Il ruolo si imposta all'avvio della connessione (`-c role=...`), prima di ogni query
  return new Pool({
    connectionString: databaseUrl,
    max,
    statement_timeout: 10_000,
    ...(role ? { options: `-c role=${role}` } : {}),
  });
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.databaseUrl, config.databaseRole),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
  ],
  exports: [PG_POOL, DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
