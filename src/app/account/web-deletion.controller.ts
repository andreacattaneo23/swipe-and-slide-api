import { Body, Controller, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { Public } from '../../core/auth/scopes.decorator';
import { AccountLifecycleService } from '../../domain/account/account-lifecycle.service';
import { normalizeEmail } from '../../domain/email/email-address';
import { OtpService } from '../../domain/otp/otp.service';
import { EmailDto, VerifyCodeDto } from '../auth/auth.dto';
import { PersonalIdentitiesService } from '../auth/personal-identities.service';
import { WebDeletionAcceptedDto, WebDeletionResultDto } from './account.dto';

/**
 * Pagina web di cancellazione (requisito di Google Play, D83, D197): stesso percorso dell'app,
 * con i 7 giorni di ripensamento. Si accetta l'email personale dell'identità o l'email aziendale
 * **attiva** di un account attivo o in ri-verifica; mai un'email aziendale storica né quella di
 * un account sospeso (D9, RC-90). Il codice va sempre all'email personale dell'account; la
 * risposta è sempre la stessa, così la pagina non rivela chi è iscritto.
 */
@ApiTags('web-deletion')
@Controller('web-deletion')
export class WebDeletionController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly identities: PersonalIdentitiesService,
    private readonly otp: OtpService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly limiter: RateLimiter,
  ) {}

  @Post('code')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: WebDeletionAcceptedDto })
  async code(@Body() body: EmailDto, @Ip() ip: string): Promise<WebDeletionAcceptedDto> {
    if (!(await this.limiter.hit(`web-deletion:${ip}`, 10, 60))) throw ApiError.tooManyRequests();
    const account = await this.account(body.email);
    // Senza account si conta comunque il tentativo, con la stessa risposta (D224)
    await this.otp.issue({
      email: account?.personalEmail ?? normalizeEmail(body.email)?.email ?? 'invalid@invalid',
      purpose: 'deletion',
      from: 'project',
      ip,
      userId: account?.userId ?? null,
      send: account !== null,
    });
    return { status: 'sent' };
  }

  @Post('confirm')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: WebDeletionResultDto })
  async confirm(@Body() body: VerifyCodeDto, @Ip() ip: string): Promise<WebDeletionResultDto> {
    if (!(await this.limiter.hit(`web-deletion-confirm:${ip}`, 20, 60))) {
      throw ApiError.tooManyRequests();
    }
    const account = await this.account(body.email);
    if (!account) throw ApiError.badRequest(ErrorCode.codeInvalid);
    await this.otp.verifyOrThrow(account.personalEmail, 'deletion', body.code);
    const state = await this.db.transaction(async (tx) => {
      const result = await this.lifecycle.requestDeletion(account.userId, 'web', tx);
      // Nessuna sessione resta aperta: si annulla accedendo di nuovo all'app (sessione `limited`)
      await tx.execute(sql`
        update sessions set revoked_at = now()
         where user_id = ${account.userId}::uuid and revoked_at is null`);
      return result;
    });
    await this.lifecycle.notifyDeletionRequested(account.userId, state);
    return { status: 'requested', deletionFinalAt: state.deletionFinalAt };
  }

  /** Account dell'indirizzo indicato, con l'email personale a cui inviare il codice. */
  private async account(input: string): Promise<{ userId: string; personalEmail: string } | null> {
    const email = normalizeEmail(input);
    if (!email) return null;
    const hash = this.identities.emailHash(email.email);
    const result = await this.db.execute<{ user_id: string; email: string }>(sql`
      select i.user_id, i.email from personal_identities i join users x on x.id = i.user_id
       where i.revoked_at is null and x.status <> 'deleted'
         and (i.email_hash = ${hash}
              or i.user_id = (select w.user_id from work_emails w join users u on u.id = w.user_id
                               where w.email_hash = ${hash} and w.status = 'active'
                                 and u.status in ('active', 'reverifying')))
       limit 1`);
    const row = result.rows[0];
    return row ? { userId: row.user_id, personalEmail: row.email } : null;
  }
}
