// Suite RC: copertura delle rotte (RC-26, RC-116) e confini tra i servizi (D231). Si leggono i
// metadati dei controller, così una rotta nuova senza dichiarazioni fa fallire la suite.
import 'reflect-metadata';
import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminApiModule } from '../../src/admin/admin-api.module';
import { OPERATOR_ROLES } from '../../src/admin/auth/operator-roles.decorator';
import { AppApiModule } from '../../src/app/app-api.module';
import { PUBLIC_ROUTE, SCOPES } from '../../src/core/auth/scopes.decorator';
import {
  EXPOSES_USER,
  type ExposesUserOptions,
} from '../../src/core/core-rule/exposes-user.decorator';
import { testConfig } from '../support/test-config';

interface Route {
  method: string;
  path: string;
  handler: (...args: unknown[]) => unknown;
  controller: Type;
}

function routes(controllers: Type[]): Route[] {
  const result: Route[] = [];
  for (const controller of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) continue;
      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'GET';
      const full = `/${[base, path].filter((part) => part && part !== '/').join('/')}`.replace(
        /\/+/g,
        '/',
      );
      result.push({ method, path: full, handler: handler as Route['handler'], controller });
    }
  }
  return result;
}

const meta = <T>(key: string, route: Route): T | undefined =>
  (Reflect.getMetadata(key, route.handler) ?? Reflect.getMetadata(key, route.controller)) as
    T | undefined;

const appRoutes = routes(AppApiModule.forRoot(testConfig('app')).controllers ?? []);
const adminRoutes = routes(AdminApiModule.forRoot(testConfig('admin')).controllers ?? []);

/** Percorsi che espongono o coinvolgono un altro utente, con la regola ammessa (RC-116). */
const RULES: { pattern: RegExp; rule: ExposesUserOptions['rule'] }[] = [
  { pattern: /^\/feed/, rule: 'interact' },
  { pattern: /^\/profiles\//, rule: 'interact' },
  { pattern: /^\/swipes/, rule: 'interact' },
  { pattern: /^\/offsites\/[^/]+\/feed/, rule: 'interact' },
  { pattern: /^\/matches\/:/, rule: 'match' },
  { pattern: /^\/agenda/, rule: 'match' },
];
/** Eccezioni esplicite (architettura, "Principi della suite"): "Persone bloccate". */
const EXCEPTIONS = new Set(['GET /blocks']);

describe("Copertura delle rotte dell'API dell'app", () => {
  it('trova le rotte dei controller', () => {
    expect(appRoutes.length).toBeGreaterThan(10);
  });

  it('D231: ogni rotta dichiara @Scopes(...) oppure @Public()', () => {
    const missing = appRoutes.filter(
      (route) => !meta<boolean>(PUBLIC_ROUTE, route) && !meta<string[]>(SCOPES, route)?.length,
    );
    expect(missing.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('RC-26 e RC-116: le rotte che espongono un altro utente dichiarano la regola ammessa', () => {
    const wrong: string[] = [];
    for (const route of appRoutes) {
      const key = `${route.method} ${route.path}`;
      const expected = RULES.find((item) => item.pattern.test(route.path))?.rule;
      if (!expected || EXCEPTIONS.has(key)) continue;
      const declared = meta<ExposesUserOptions>(EXPOSES_USER, route);
      if (declared?.rule !== expected)
        wrong.push(`${key}: ${declared?.rule ?? 'nessuna'} invece di ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  it("D231: l'API pubblica non espone alcuna rotta /backoffice", () => {
    expect(appRoutes.filter((route) => route.path.startsWith('/backoffice'))).toEqual([]);
  });
});

describe('Copertura delle rotte di amministrazione', () => {
  it('D231: ogni rotta dichiara @OperatorRoles(...) oppure @Public()', () => {
    const missing = adminRoutes.filter(
      (route) =>
        !meta<boolean>(PUBLIC_ROUTE, route) && !meta<string[]>(OPERATOR_ROLES, route)?.length,
    );
    expect(missing.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it("le rotte pubbliche di amministrazione sono solo la salute e l'accesso degli operatori", () => {
    const open = adminRoutes
      .filter((route) => meta<boolean>(PUBLIC_ROUTE, route))
      .map((route) => route.path);
    expect(open.every((path) => path === '/health' || path.startsWith('/backoffice/auth/'))).toBe(
      true,
    );
  });

  it('tutte le rotte di amministrazione stanno sotto /backoffice', () => {
    expect(
      adminRoutes.filter(
        (route) => route.path !== '/health' && !route.path.startsWith('/backoffice/'),
      ),
    ).toEqual([]);
  });
});
