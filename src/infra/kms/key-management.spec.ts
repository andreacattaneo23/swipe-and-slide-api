import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { EnvKeyManagement, OpenBaoKeyManagement } from './key-management';

describe('Custodia della chiave principale (D183, D241)', () => {
  it('env: cifra e decifra una chiave dei dati; altra versione rifiutata', async () => {
    const kms = new EnvKeyManagement(randomBytes(32));
    const plain = randomBytes(32);
    const wrapped = await kms.encryptDataKey(plain);
    expect(wrapped.keyVersion).toBe('env-v1');
    expect(wrapped.ciphertext.includes(plain)).toBe(false);
    expect(await kms.decryptDataKey(wrapped.ciphertext, wrapped.keyVersion)).toEqual(plain);
    await expect(kms.decryptDataKey(wrapped.ciphertext, 'altra')).rejects.toThrow();
  });

  describe('openbao: API transit', () => {
    // Doppio di OpenBao definito nel test: risponde come /v1/transit/{encrypt,decrypt}/<chiave>
    let server: Server;
    let address: string;
    const seen: { url: string; token: string | undefined }[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          seen.push({
            url: req.url ?? '',
            token: req.headers['x-vault-token'] as string | undefined,
          });
          const input = JSON.parse(body) as { plaintext?: string; ciphertext?: string };
          const data = req.url?.includes('/encrypt/')
            ? { ciphertext: `vault:v3:${input.plaintext}`, key_version: 3 }
            : { plaintext: input.ciphertext?.replace(/^vault:v\d+:/, '') };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ data }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('usa il token e la chiave transit e restituisce la versione', async () => {
      const kms = new OpenBaoKeyManagement(address, 'token-di-prova', 'messages');
      const plain = randomBytes(32);
      const wrapped = await kms.encryptDataKey(plain);
      expect(wrapped.keyVersion).toBe('openbao:messages:v3');
      expect(wrapped.ciphertext.toString()).toMatch(/^vault:v3:/);
      expect(await kms.decryptDataKey(wrapped.ciphertext, wrapped.keyVersion)).toEqual(plain);
      expect(seen.map((s) => s.url)).toEqual([
        '/v1/transit/encrypt/messages',
        '/v1/transit/decrypt/messages',
      ]);
      expect(seen.every((s) => s.token === 'token-di-prova')).toBe(true);
    });
  });
});
