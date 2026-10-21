import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { AdminApiModule } from '../../src/admin/admin-api.module';
import { AppApiModule } from '../../src/app/app-api.module';
import { sha256Hex } from '../../src/infra/crypto/crypto.service';
import { RateLimiter } from '../../src/infra/cache/rate-limiter';
import { EMAIL_SENDER } from '../../src/infra/email/email-sender';
import { CaptureEmailSender } from './capture-email-sender';
import { setupApp } from '../../src/infra/http/setup-app';
import {
  PROVIDER_KEYS,
  type ProviderKeys,
} from '../../src/infra/identity-providers/provider-token-verifier';
import { testConfig } from './test-config';

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/** Fornitori d'identità di prova: chiavi generate, nessuna chiamata ad Apple né a Google. */
export class FakeProviders {
  private constructor(
    private readonly keys: Record<'apple' | 'google', { privateKey: SigningKey; jwk: JWK }>,
    readonly attacker: SigningKey,
  ) {}

  static async create(): Promise<FakeProviders> {
    const make = async (kid: string) => {
      const pair = await generateKeyPair('RS256', { extractable: true });
      return {
        privateKey: pair.privateKey,
        jwk: { ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256' },
      };
    };
    const attacker = await generateKeyPair('RS256');
    return new FakeProviders(
      { apple: await make('apple-1'), google: await make('google-1') },
      attacker.privateKey,
    );
  }

  providerKeys(): ProviderKeys {
    return {
      apple: createLocalJWKSet({ keys: [this.keys.apple.jwk] }),
      google: createLocalJWKSet({ keys: [this.keys.google.jwk] }),
    };
  }

  /** Token d'identità firmato; ogni campo si può sostituire per i casi di rifiuto (RC-208). */
  async token(
    provider: 'apple' | 'google',
    claims: { sub: string; email: string; nonce: string } & Record<string, unknown>,
    options: {
      audience?: string;
      issuer?: string;
      expiresIn?: string;
      key?: SigningKey;
      kid?: string;
    } = {},
  ): Promise<string> {
    const { sub, nonce, ...rest } = claims;
    return new SignJWT({
      email_verified: true,
      ...rest,
      nonce: provider === 'apple' ? sha256Hex(nonce) : nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? this.keys[provider].jwk.kid! })
      .setSubject(sub)
      .setIssuer(
        options.issuer ??
          (provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com'),
      )
      .setAudience(
        options.audience ?? (provider === 'apple' ? 'it.swipeandslide.app' : 'test-google-web'),
      )
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m')
      .sign(options.key ?? this.keys[provider].privateKey);
  }
}

export interface TestApp {
  app: INestApplication;
  email: CaptureEmailSender;
}

/**
 * App di prova. Con `realEmail` le email partono davvero via SMTP verso Mailpit (D240) e i
 * codici si leggono dalla sua API (`test/support/mailpit.ts`); altrimenti restano nel doppio.
 */
export async function createTestApp(
  role: 'app' | 'admin',
  providers?: FakeProviders,
  options: { realEmail?: boolean } = {},
): Promise<TestApp> {
  const email = new CaptureEmailSender();
  const root =
    role === 'app'
      ? AppApiModule.forRoot(testConfig('app'))
      : AdminApiModule.forRoot(testConfig('admin'));
  // I limiti per IP in memoria si provano a parte: qui tutte le richieste arrivano dallo stesso IP
  let builder = Test.createTestingModule({ imports: [root] })
    .overrideProvider(RateLimiter)
    .useValue({ hit: () => Promise.resolve(true) });
  if (!options.realEmail) builder = builder.overrideProvider(EMAIL_SENDER).useValue(email);
  if (providers)
    builder = builder.overrideProvider(PROVIDER_KEYS).useValue(providers.providerKeys());
  const moduleRef = await builder.compile();
  // TEST_LOGS=1 mostra gli errori del servizio durante i test
  const app = moduleRef.createNestApplication({
    bodyParser: false,
    logger: process.env.TEST_LOGS ? ['error', 'warn'] : false,
  });
  setupApp(app);
  await app.init();
  return { app, email };
}
