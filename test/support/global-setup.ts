import { ensureBucket, S3ObjectStorage } from '../../src/infra/storage/s3-object-storage';
import { testConfig } from './test-config';
import { resetDatabase } from './test-db';

export default async function globalSetup(): Promise<void> {
  await resetDatabase();
  await ensureBucket(new S3ObjectStorage(testConfig().storage));
}
