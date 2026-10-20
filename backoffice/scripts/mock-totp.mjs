/**
 * Stampa il codice TOTP corrente degli operatori finti dell'adattatore mock (solo sviluppo).
 * In alternativa si aggiunge il segreto a un'app di autenticazione.
 */
import fs from 'node:fs';
import { TOTP } from 'otpauth';

const config = JSON.parse(
  fs.readFileSync(new URL('../src/server/admin-api/mock/dev-operators.json', import.meta.url)),
);
const totp = new TOTP({ secret: config.totpSecret, digits: 6, period: 30 });
const seconds = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Codice del secondo fattore: ${totp.generate()} (vale ancora ${seconds} s)`);
console.log(`Segreto per un'app di autenticazione: ${config.totpSecret}`);
