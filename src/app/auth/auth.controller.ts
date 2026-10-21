import { Body, Controller, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { AuthContext } from '../../core/auth/auth-context';
import { Public, Scopes } from '../../core/auth/scopes.decorator';
import { normalizeEmail } from '../../domain/email/email-address';
import { OtpService } from '../../domain/otp/otp.service';
import { StoreReviewService } from '../../domain/safety/store-review.service';
import { DATABASE, Database } from '../../infra/database/database';
import { users } from '../../infra/database/schema';
import {
  AcceptedDto,
  EmailDto,
  LogoutDto,
  NonceDto,
  ProviderTokenDto,
  RefreshDto,
  SessionDto,
  SignInResultDto,
  VerifyCodeDto,
} from './auth.dto';
import { NonceService } from './nonce.service';
import { PersonalIdentitiesService } from './personal-identities.service';
import { ProviderSignInService } from './provider-sign-in.service';
import { RegistrationTicketService } from './registration-ticket.service';
import { SessionsService } from './sessions.service';

/** Accesso all'app: nonce, codice all'email, Apple, Google, rinnovo e uscita (D224, D231). */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly nonces: NonceService,
    private readonly otp: OtpService,
    private readonly identities: PersonalIdentitiesService,
    private readonly providers: ProviderSignInService,
    private readonly tickets: RegistrationTicketService,
    private readonly sessions: SessionsService,
    private readonly limiter: RateLimiter,
    private readonly storeReview: StoreReviewService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Post('nonce')
  @Public()
  @HttpCode(201)
  @ApiOkResponse({ type: NonceDto })
  async nonce(@Ip() ip: string): Promise<NonceDto> {
    await this.limit(`nonce:${ip}`, 30);
    return this.nonces.issue();
  }

  /**
   * Codice all'email personale di un'identità o all'email aziendale attiva (D82), mai a
   * un'email aziendale storica; stessa risposta per ogni indirizzo (`signIn.neutral`).
   */
  @Post('code')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async code(@Body() body: EmailDto, @Ip() ip: string): Promise<AcceptedDto> {
    await this.limit(`code:${ip}`, 20);
    const email = normalizeEmail(body.email);
    if (!email) throw ApiError.badRequest(ErrorCode.validation);
    const identity = await this.identities.identityByEmail(email.email);
    const workUser = identity ? null : await this.identities.userByActiveWorkEmail(email.email);
    // Account dimostrativi: nessun invio, si entra con il codice di revisione (D42)
    const demo = identity ? await this.isDemo(identity.userId) : false;
    await this.otp.issue({
      email: email.email,
      purpose: 'login',
      from: workUser ? 'neutral' : 'project',
      ip,
      send: !demo && (identity !== null || workUser !== null),
    });
    return { status: 'sent' };
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SignInResultDto })
  async verify(@Body() body: VerifyCodeDto, @Ip() ip: string): Promise<SignInResultDto> {
    await this.limit(`verify:${ip}`, 30);
    const email = normalizeEmail(body.email);
    if (!email) throw ApiError.badRequest(ErrorCode.validation);
    const demoIdentity = await this.identities.identityByEmail(email.email);
    if (demoIdentity?.provider === 'email' && (await this.isDemo(demoIdentity.userId))) {
      // Solo l'email e il codice di revisione, con una finestra aperta (D42, RC-87, RC-209)
      if (!(await this.storeReview.verifyCode(body.code, demoIdentity.userId))) {
        throw ApiError.badRequest(ErrorCode.codeInvalid);
      }
      return {
        result: 'signedIn',
        session: await this.sessions.create(demoIdentity.userId, 'review_code'),
      };
    }
    await this.otp.verifyOrThrow(email.email, 'login', body.code);
    const identity = demoIdentity;
    if (identity && identity.provider !== 'email') {
      // L'email personale di un account Apple o Google non apre sessioni (Proposta 4)
      throw ApiError.conflict(ErrorCode.emailInUse);
    }
    if (identity) {
      const session = await this.identities.signIn('email', identity.subject);
      return session ? { result: 'signedIn', session } : { result: 'noAccount' };
    }
    const workUser = await this.identities.userByActiveWorkEmail(email.email);
    if (workUser) {
      return { result: 'signedIn', session: await this.sessions.create(workUser, 'work_email') };
    }
    // Il codice non parte verso indirizzi sconosciuti: qui non si arriva con un codice valido
    throw ApiError.badRequest(ErrorCode.codeInvalid);
  }

  @Post('apple')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SignInResultDto })
  apple(@Body() body: ProviderTokenDto, @Ip() ip: string): Promise<SignInResultDto> {
    return this.providerSignIn('apple', body, ip);
  }

  @Post('google')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SignInResultDto })
  google(@Body() body: ProviderTokenDto, @Ip() ip: string): Promise<SignInResultDto> {
    return this.providerSignIn('google', body, ip);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  async refresh(@Body() body: RefreshDto, @Ip() ip: string): Promise<SessionDto> {
    await this.limit(`refresh:${ip}`, 60);
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('logout')
  @Scopes('full', 'registration', 'approval', 'restore', 'limited')
  @ApiBearerAuth()
  @HttpCode(204)
  async logout(@CurrentUser() me: AuthContext, @Body() body: LogoutDto): Promise<void> {
    if (body.from === 'all') await this.sessions.revokeAll(me.userId);
    else await this.sessions.revoke(me.sessionId);
  }

  private async providerSignIn(
    provider: 'apple' | 'google',
    body: ProviderTokenDto,
    ip: string,
  ): Promise<SignInResultDto> {
    await this.limit(`${provider}:${ip}`, 30);
    const identity = await this.providers.verify(provider, body.identityToken, body.nonce);
    const session = await this.identities.signIn(provider, identity.subject);
    if (session) return { result: 'signedIn', session };
    return { result: 'noAccount', registrationTicket: this.tickets.issue(identity) };
  }

  private async isDemo(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ isDemo: users.isDemo })
      .from(users)
      .where(eq(users.id, userId));
    return row?.isDemo === true;
  }

  private async limit(key: string, perMinute: number): Promise<void> {
    if (!(await this.limiter.hit(key, perMinute, 60))) throw ApiError.tooManyRequests();
  }
}
