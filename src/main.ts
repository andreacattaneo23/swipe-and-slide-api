import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadConfig } from './infra/config/config';

/** Avvio HTTP del servizio secondo `SERVICE_ROLE` (`app`, `admin`, `realtime`). */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.port);
}

void main();
