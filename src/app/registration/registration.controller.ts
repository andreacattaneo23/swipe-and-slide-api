import { Body, Controller, Get, HttpCode, Ip, Post, Put } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { VerifiedIdentity } from '../../infra/identity-providers/provider-token-verifier';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Public, Scopes } from '../../core/auth/scopes.decorator';
import { normalizeEmail, PRIVATE_RELAY_DOMAIN } from '../../domain/email/email-address';
import { OtpService } from '../../domain/otp/otp.service';
import { AcceptedDto, EmailDto, ProviderTokenDto, VerifyCodeDto } from '../auth/auth.dto';
import { PersonalIdentitiesService } from '../auth/personal-identities.service';
import { ProviderSignInService } from '../auth/provider-sign-in.service';
import { RegistrationTicketService } from '../auth/registration-ticket.service';
import {
  BirthDateDto,
  CompleteResultDto,
  ConsentDto,
  OpenSpaceChoiceDto,
  PrivacyDto,
  RegistrationProfileDto,
  RegistrationSessionDto,
  RegistrationStateDto,
  WorkEmailDto,
  WorkEmailVerifyDto,
} from './registration.dto';
import { RegistrationService } from './registration.service';

/** Registrazione in sette passi nell'ordine di D224 e D236, fino a `pending_approval`. */
@ApiTags('registration')
@Controller('registration')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly identities: PersonalIdentitiesService,
    private readonly otp: OtpService,
    private readonly providers: ProviderSignInService,
    private readonly tickets: RegistrationTicketService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @Scopes('registration')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RegistrationStateDto })
  state(@CurrentUser() me: AuthContext): Promise<RegistrationStateDto> {
    return this.registration.state(me.userId);
  }

  /**
   * Passo 1 con l'email personale: dominio dell'elenco e usa e getta **prima** del codice;
   * stessa risposta per indirizzi nuovi e già registrati.
   */
  @Post('personal-email')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async personalEmail(@Body() body: EmailDto, @Ip() ip: string): Promise<AcceptedDto> {
    await this.limit(`registration-email:${ip}`, 20);
    const email = this.personal(body.email);
    await this.identities.checkPersonalDomain(email.domain, false);
    await this.otp.issue({ email: email.email, purpose: 'registration', from: 'project', ip });
    return { status: 'sent' };
  }

  /** Verifica del codice: solo ora impronte bloccate, identità esistente o email già usata. */
  @Post('personal-email/verify')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: RegistrationSessionDto })
  async personalEmailVerify(
    @Body() body: VerifyCodeDto,
    @Ip() ip: string,
  ): Promise<RegistrationSessionDto> {
    await this.limit(`registration-verify:${ip}`, 30);
    const email = this.personal(body.email);
    await this.identities.checkPersonalDomain(email.domain, false);
    await this.otp.verifyOrThrow(email.email, 'registration', body.code);
    const hash = this.identities.emailHash(email.email);
    if (await this.identities.isBlocked(hash))
      throw ApiError.badRequest(ErrorCode.registrationBlocked);
    const existing = await this.identities.signIn('email', hash);
    if (existing) return { result: 'existingAccount', session: existing };
    const session = await this.identities.createAccount({
      provider: 'email',
      subject: hash,
      email: email.email,
      isPrivateRelay: false,
    });
    return { result: 'created', session };
  }

  @Post('apple')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: RegistrationSessionDto })
  apple(@Body() body: ProviderTokenDto, @Ip() ip: string): Promise<RegistrationSessionDto> {
    return this.providerRegistration('apple', body, ip);
  }

  @Post('google')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: RegistrationSessionDto })
  google(@Body() body: ProviderTokenDto, @Ip() ip: string): Promise<RegistrationSessionDto> {
    return this.providerRegistration('google', body, ip);
  }

  @Put('birth-date')
  @Scopes('registration')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RegistrationStateDto })
  birthDate(
    @CurrentUser() me: AuthContext,
    @Body() body: BirthDateDto,
  ): Promise<RegistrationStateDto> {
    return this.registration.birthDate(me.userId, body);
  }

  @Post('work-email')
  @Scopes('registration')
  @ApiBearerAuth()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async workEmail(
    @CurrentUser() me: AuthContext,
    @Body() body: WorkEmailDto,
    @Ip() ip: string,
  ): Promise<AcceptedDto> {
    await this.registration.requestWorkEmailCode(me.userId, body, ip);
    return { status: 'sent' };
  }

  @Post('work-email/verify')
  @Scopes('registration')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: RegistrationStateDto })
  workEmailVerify(
    @CurrentUser() me: AuthContext,
    @Body() body: WorkEmailVerifyDto,
  ): Promise<RegistrationStateDto> {
    return this.registration.verifyWorkEmail(me.userId, body);
  }

  @Put('consent')
  @Scopes('registration')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RegistrationStateDto })
  consent(@CurrentUser() me: AuthContext, @Body() body: ConsentDto): Promise<RegistrationStateDto> {
    return this.registration.consent(me.userId, body);
  }

  @Put('profile')
  @Scopes('registration')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RegistrationStateDto })
  profile(
    @CurrentUser() me: AuthContext,
    @Body() body: RegistrationProfileDto,
  ): Promise<RegistrationStateDto> {
    return this.registration.profile(me.userId, body);
  }

  @Put('open-space')
  @Scopes('registration')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RegistrationStateDto })
  openSpace(
    @CurrentUser() me: AuthContext,
    @Body() body: OpenSpaceChoiceDto,
  ): Promise<RegistrationStateDto> {
    return this.registration.openSpace(me.userId, body);
  }

  @Put('privacy')
  @Scopes('registration')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RegistrationStateDto })
  privacy(@CurrentUser() me: AuthContext, @Body() body: PrivacyDto): Promise<RegistrationStateDto> {
    return this.registration.privacy(me.userId, body);
  }

  @Post('complete')
  @Scopes('registration')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: CompleteResultDto })
  complete(@CurrentUser() me: AuthContext): Promise<CompleteResultDto> {
    return this.registration.complete(me.userId, me.sessionId);
  }

  /**
   * Passo 1 con Apple o Google: token verificato (o ticket di un accesso senza account), poi
   * gli stessi controlli dell'email. [Proposta 6] Con un rifiuto il token appena ricevuto va
   * revocato subito presso il fornitore: da fare insieme allo scambio del codice (Proposta 7).
   */
  private async providerRegistration(
    provider: 'apple' | 'google',
    body: ProviderTokenDto,
    ip: string,
  ): Promise<RegistrationSessionDto> {
    await this.limit(`registration-${provider}:${ip}`, 30);
    let identity: VerifiedIdentity | null;
    if (body.registrationTicket) {
      identity = this.tickets.read(body.registrationTicket, provider);
      if (!identity) throw new ApiError(401, ErrorCode.providerToken);
    } else {
      identity = await this.providers.verify(provider, body.identityToken, body.nonce);
    }
    const existing = await this.identities.signIn(provider, identity.subject);
    if (existing) return { result: 'existingAccount', session: existing };
    const email = normalizeEmail(identity.email);
    if (!email) throw new ApiError(401, ErrorCode.providerToken);
    if (!(identity.isPrivateRelay && email.domain === PRIVATE_RELAY_DOMAIN)) {
      await this.identities.checkPersonalDomain(email.domain, true);
    }
    const session = await this.identities.createAccount({ ...identity, email: email.email });
    return { result: 'created', session };
  }

  private personal(input: string): { email: string; domain: string } {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest(ErrorCode.validation);
    return email;
  }

  private async limit(key: string, perMinute: number): Promise<void> {
    if (!(await this.limiter.hit(key, perMinute, 60))) throw ApiError.tooManyRequests();
  }
}
