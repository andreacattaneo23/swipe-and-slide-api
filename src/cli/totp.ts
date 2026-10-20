import { generate } from 'otplib';

/** Solo sviluppo: codice TOTP corrente di un segreto (`node dist/cli/totp.js <segreto>`). */
async function main(): Promise<void> {
  const secret = process.argv[2];
  if (!secret) throw new Error('Uso: node dist/cli/totp.js <segreto>');
  process.stdout.write(`${await generate({ secret })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
