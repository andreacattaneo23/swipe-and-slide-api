import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../config/config';
import { assertStorageKey, ObjectStorage, SignedUpload } from './object-storage';

/**
 * Archivio S3 (D240): MinIO in locale (`http://127.0.0.1:9100`), Cloudflare R2 in produzione. Un
 * solo bucket privato con prefissi (`tmp/`, `photos/`, `exports/`); gli oggetti non sono mai
 * pubblici e si leggono e scrivono solo con URL firmati di breve durata.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: AppConfig['storage']) {
    // Le credenziali servono solo all'archivio: senza, il servizio non parte (nessun ripiego)
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error("Variabili d'ambiente mancanti: S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY");
    }
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertStorageKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey')
        return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUpload(key: string, ttlSeconds: number, maxBytes: number): Promise<SignedUpload> {
    assertStorageKey(key);
    // La dimensione massima si ricontrolla alla conferma, leggendo l'oggetto (README, "Foto")
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    return { url, method: 'PUT', expiresAt: new Date(Date.now() + ttlSeconds * 1000), maxBytes };
  }

  async signedDownload(key: string, ttlSeconds: number): Promise<string> {
    assertStorageKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  async signedPutUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }> {
    const { url, expiresAt } = await this.signedUpload(key, ttlSeconds, 0);
    return { url, expiresAt };
  }

  async signedGetUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }> {
    const url = await this.signedDownload(key, ttlSeconds);
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async exists(key: string): Promise<boolean> {
    assertStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async read(key: string): Promise<Buffer> {
    const body = await this.get(key);
    if (!body) throw new Error('Oggetto assente');
    return body;
  }

  async write(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.put(key, body, contentType ?? 'application/octet-stream');
  }

  async copy(from: string, to: string): Promise<void> {
    assertStorageKey(from);
    assertStorageKey(to);
    await this.client.send(
      new CopyObjectCommand({ Bucket: this.bucket, Key: to, CopySource: `${this.bucket}/${from}` }),
    );
  }
}

/**
 * Crea il bucket privato se manca e la scadenza di un giorno dei caricamenti temporanei
 * (`tmp/`), che la conferma della foto cancella comunque (`npm run storage:setup`).
 */
export async function ensureBucket(storage: S3ObjectStorage): Promise<'created' | 'exists'> {
  const { CreateBucketCommand, HeadBucketCommand, PutBucketLifecycleConfigurationCommand } =
    await import('@aws-sdk/client-s3');
  let result: 'created' | 'exists' = 'exists';
  try {
    await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
  } catch {
    await storage.client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
    result = 'created';
  }
  await storage.client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: storage.bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'temp-uploads',
            Status: 'Enabled',
            Filter: { Prefix: 'tmp/' },
            Expiration: { Days: 1 },
          },
        ],
      },
    }),
  );
  return result;
}
