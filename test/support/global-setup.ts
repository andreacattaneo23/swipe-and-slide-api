import { resetDatabase } from './test-db';

export default async function globalSetup(): Promise<void> {
  await resetDatabase();
}
