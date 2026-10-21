import { loadConfig } from '../infra/config/config';
import { ensureBucket, S3ObjectStorage } from '../infra/storage/s3-object-storage';

/** `npm run storage:setup`: crea il bucket dell'archivio (MinIO in locale, D240). */
async function main(): Promise<void> {
  const config = loadConfig();
  const storage = new S3ObjectStorage(config.storage);
  const result = await ensureBucket(storage);
  process.stdout.write(
    `Bucket ${config.storage.bucket}: ${result === 'created' ? 'creato' : 'già presente'}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
