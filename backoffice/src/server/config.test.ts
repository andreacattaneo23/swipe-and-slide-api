// @vitest-environment node
import { LOCAL_ADMIN_API_URL, readConfig } from './config';

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe('configurazione', () => {
  it('in sviluppo: admin-api locale e cookie non Secure di base (D240)', () => {
    const config = readConfig(env({ NODE_ENV: 'development' }));
    expect(config).toMatchObject({ adminApiUrl: LOCAL_ADMIN_API_URL, secureCookies: false });
    expect(config.sessionSecret).toHaveLength(32);
  });

  it('in produzione servono ADMIN_API_URL e SESSION_SECRET', () => {
    const secret = Buffer.alloc(32, 1).toString('base64');
    expect(() => readConfig(env({ NODE_ENV: 'production', SESSION_SECRET: secret }))).toThrow(
      /ADMIN_API_URL/,
    );
    expect(() =>
      readConfig(env({ NODE_ENV: 'production', ADMIN_API_URL: 'https://a.example' })),
    ).toThrow(/SESSION_SECRET/);
    const config = readConfig(
      env({ NODE_ENV: 'production', ADMIN_API_URL: 'https://a.example', SESSION_SECRET: secret }),
    );
    expect(config).toMatchObject({ adminApiUrl: 'https://a.example', secureCookies: true });
  });

  it('URL non HTTP e chiavi della lunghezza sbagliata non partono', () => {
    expect(() => readConfig(env({ ADMIN_API_URL: 'ftp://x' }))).toThrow(/non valida/);
    expect(() => readConfig(env({ SESSION_SECRET: 'corta' }))).toThrow(/32 byte/);
  });
});
