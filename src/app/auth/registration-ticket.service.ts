import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { VerifiedIdentity } from '../../infra/identity-providers/provider-token-verifier';

const TICKET_MINUTES = 10;

/**
 * `registrationTicket` (Proposta 5): risultato della verifica di un accesso con Apple o Google
 * senza account, cifrato dal backend e valido 10 minuti, così l'app crea l'account senza
 * chiedere di nuovo l'accesso al fornitore. L'app non può leggerlo. Un secondo uso trova
 * l'identità già registrata (`UNIQUE (provider, subject)`).
 */
@Injectable()
export class RegistrationTicketService {
  constructor(private readonly crypto: CryptoService) {}

  issue(identity: VerifiedIdentity): string {
    const payload = JSON.stringify({ ...identity, exp: Date.now() + TICKET_MINUTES * 60_000 });
    return this.crypto.encryptToken(payload).ciphertext;
  }

  read(ticket: string, provider: 'apple' | 'google'): VerifiedIdentity | null {
    try {
      const data = JSON.parse(this.crypto.decryptToken(ticket)) as VerifiedIdentity & {
        exp: number;
      };
      if (data.provider !== provider || data.exp < Date.now()) return null;
      return {
        provider: data.provider,
        subject: data.subject,
        email: data.email,
        isPrivateRelay: data.isPrivateRelay,
      };
    } catch {
      return null;
    }
  }
}
