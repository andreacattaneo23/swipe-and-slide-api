import { DynamicModule, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger as PinoLogger, LoggerModule } from 'nestjs-pino';
import { AdminApiModule } from './admin/admin-api.module';
import { AppApiModule } from './app/app-api.module';
import { AppConfig, ServiceRole } from './infra/config/config';
import { setupApp } from './infra/http/setup-app';
import { RealtimeServerModule } from './realtime/realtime-server.module';

/** Modulo radice scelto da `SERVICE_ROLE` (D231). */
export function rootModule(role: ServiceRole, config?: AppConfig): DynamicModule {
  if (role === 'admin') return AdminApiModule.forRoot(config);
  if (role === 'realtime') return RealtimeServerModule.forRoot(config);
  return AppApiModule.forRoot(config);
}

/**
 * Crea l'applicazione Nest del servizio con le misure HTTP comuni. Log JSON con `pino`, senza
 * dati personali: niente corpi, intestazioni d'autenticazione né query (README, "Log").
 */
export async function createApp(
  config: AppConfig,
  options: { logs?: boolean } = {},
): Promise<INestApplication> {
  const logs = options.logs ?? true;
  const logger = LoggerModule.forRoot({
    pinoHttp: {
      level: logs ? config.logLevel : 'silent',
      redact: [
        'req.headers.authorization',
        'req.headers["x-operator-token"]',
        'req.headers.cookie',
      ],
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(config.nodeEnv === 'development'
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    },
  });
  const root = rootModule(config.serviceRole, config);
  root.imports = [...(root.imports ?? []), logger];
  const app = await NestFactory.create(root, { bodyParser: false, bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  setupApp(app);
  // Canale WebSocket del tempo reale con `ws` (D182)
  if (config.serviceRole === 'realtime') app.useWebSocketAdapter(new WsAdapter(app));
  return app;
}
