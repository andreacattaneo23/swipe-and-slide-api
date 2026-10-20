import 'reflect-metadata';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { rootModule } from '../bootstrap';
import { AppConfig, loadConfig } from '../infra/config/config';

/** Configurazione fittizia: la generazione non si collega a database né a Redis. */
const PLACEHOLDER = 'x'.repeat(32);
const config = (role: 'app' | 'admin'): AppConfig =>
  loadConfig({
    SERVICE_ROLE: role,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://openapi@localhost:1/openapi',
    JWT_ACCESS_SIGNING_KEY: PLACEHOLDER,
    JWT_ADMIN_SIGNING_KEY: PLACEHOLDER,
    HMAC_SECRET: PLACEHOLDER,
    TOKEN_ENCRYPTION_KEY: PLACEHOLDER,
    TOTP_ENCRYPTION_KEY: PLACEHOLDER,
  });

const OUTPUT = join(__dirname, '..', '..', 'openapi');

/** Ordina le chiavi, così il file non cambia tra un'esecuzione e l'altra. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

/** Contratto OpenAPI generato dai DTO (`class-validator` e `@nestjs/swagger`). */
export async function buildDocument(role: 'app' | 'admin'): Promise<string> {
  const app = await NestFactory.create(rootModule(role, config(role)), {
    logger: false,
    abortOnError: false,
  });
  const builder = new DocumentBuilder()
    .setTitle(
      role === 'app' ? "Swipe & Slide — API dell'app" : 'Swipe & Slide — API di amministrazione',
    )
    .setVersion('0.1.0')
    .setOpenAPIVersion('3.1.0');
  if (role === 'app') builder.addBearerAuth();
  else builder.addApiKey({ type: 'apiKey', in: 'header', name: 'X-Operator-Token' }, 'operator');
  const document = SwaggerModule.createDocument(app, builder.build());
  await app.close();
  return `${JSON.stringify(sorted(document), null, 2)}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  let stale = false;
  for (const role of ['app', 'admin'] as const) {
    const file = join(OUTPUT, `${role}.json`);
    const content = await buildDocument(role);
    if (check) {
      const current = await readFile(file, 'utf8').catch(() => '');
      if (current !== content) {
        stale = true;
        process.stderr.write(`${file} non è aggiornato: esegui npm run openapi\n`);
      }
    } else {
      await writeFile(file, content);
      process.stdout.write(`Scritto ${file}\n`);
    }
  }
  if (stale) process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
