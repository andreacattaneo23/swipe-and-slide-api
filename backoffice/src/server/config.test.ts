// @vitest-environment node
import { readConfig } from './config';

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe('configurazione', () => {
  it('in sviluppo: adattatore mock e cookie non Secure di base', () => {
    const config = readConfig(env({ NODE_ENV: 'development', ADMIN_API_ADAPTER: '' }));
    expect(config).toMatchObject({ adapter: 'mock', secureCookies: false });
    expect(config.sessionSecret).toHaveLength(32);
  });

  it('in produzione servono SESSION_SECRET e un adattatore vero', () => {
    expect(() =>
      readConfig(
        env({
          NODE_ENV: 'production',
          ADMIN_API_ADAPTER: 'http',
          ADMIN_API_URL: 'https://a.example',
        }),
      ),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      readConfig(
        env({ NODE_ENV: 'production', SESSION_SECRET: Buffer.alloc(32).toString('base64') }),
      ),
    ).toThrow(/mock/);
    const config = readConfig(
      env({
        NODE_ENV: 'production',
        ADMIN_API_ADAPTER: 'http',
        ADMIN_API_URL: 'https://a.example',
        SESSION_SECRET: Buffer.alloc(32, 1).toString('base64'),
      }),
    );
    expect(config).toMatchObject({ adapter: 'http', secureCookies: true });
  });

  it('http senza URL e chiavi della lunghezza sbagliata non partono', () => {
    expect(() => readConfig(env({ ADMIN_API_ADAPTER: 'http' }))).toThrow(/ADMIN_API_URL/);
    expect(() => readConfig(env({ SESSION_SECRET: 'corta' }))).toThrow(/32 byte/);
    expect(() => readConfig(env({ ADMIN_API_ADAPTER: 'grpc' }))).toThrow(/non valido/);
  });
});
