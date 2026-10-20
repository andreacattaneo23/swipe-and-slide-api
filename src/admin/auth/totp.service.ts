import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import { CryptoService } from '../../infra/crypto/crypto.service';

/**
 * Secondo fattore degli operatori: TOTP (RFC 6238) con `otplib`, segreto cifrato (D88).
 * [Proposta] Rifiuto del riuso dello stesso codice (`afterTimeStep`) da aggiungere.
 */
@Injectable()
export class TotpService {
  constructor(private readonly crypto: CryptoService) {}

  newSecret(): { secret: string; encrypted: string } {
    const secret = generateSecret();
    return { secret, encrypted: this.crypto.encryptTotpSecret(secret) };
  }

  uri(secret: string, label: string): string {
    return generateURI({ issuer: 'Swipe & Slide backoffice', label, secret });
  }

  async check(encryptedSecret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const secret = this.crypto.decryptTotpSecret(encryptedSecret);
    const result = await verify({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  }
}
