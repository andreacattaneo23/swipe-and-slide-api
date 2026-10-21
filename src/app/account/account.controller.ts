import { asDate } from '../../infra/database/timestamps';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { AccountLifecycleService } from '../../domain/account/account-lifecycle.service';
import { AccountMailer } from '../../domain/account/account-mailer';
import { DataExportsService } from '../../domain/account/data-exports.service';
import { OtpService } from '../../domain/otp/otp.service';
import { WorkIdentityService } from '../../domain/work-identity/work-identity.service';
import { AcceptedDto, EmailDto } from '../auth/auth.dto';
import { SessionsService } from '../auth/sessions.service';
import { AccessService } from './access.service';
import {
  AccessInfoDto,
  AccessMethodDto,
  AccessTokenDto,
  AccessUpdateDto,
  CodeDto,
  ConfirmationCodeRequestDto,
  ConfirmationDto,
  ConsentDto,
  DataExportDto,
  DeletionStateDto,
  PersonalEmailVerifyDto,
  WorkEmailResultDto,
  WorkEmailVerifyDto,
} from './account.dto';

const ALL = ['full', 'approval', 'restore', 'limited'] as const;

/**
 * Account (D80, sezione Account): cambio azienda, ri-verifica e ripristino, "Email e accesso",
 * consensi e revoca, cancellazione con ripensamento, "Scarica i miei dati". Le azioni delicate
 * chiedono un codice all'email personale (D82, D83); la revoca del consenso una conferma.
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller()
export class AccountController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: AccessService,
    private readonly workIdentity: WorkIdentityService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly exports: DataExportsService,
    private readonly sessions: SessionsService,
    private readonly otp: OtpService,
    private readonly mailer: AccountMailer,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Conferma dell'identità, cambio azienda, ri-verifica e ripristino (D9, D20, D82, D233)
  // ---------------------------------------------------------------------------------------------

  /** Codice all'email personale per confermare l'identità, anche con la sessione aperta. */
  @Post('identity/confirmation/code')
  @Scopes('full')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async confirmationCode(
    @CurrentUser() me: AuthContext,
    @Body() body: ConfirmationCodeRequestDto,
    @Ip() ip: string,
  ): Promise<AcceptedDto> {
    await this.access.sendConfirmationCode(me.userId, body.purpose, ip);
    return { status: 'sent' };
  }

  @Post('identity/confirmation')
  @Scopes('full')
  @HttpCode(204)
  @ApiNoContentResponse()
  async confirm(@CurrentUser() me: AuthContext, @Body() body: ConfirmationDto): Promise<void> {
    await this.access.confirm(me.userId, me.sessionId, body.purpose, body.code);
  }

  /** "Ho cambiato azienda": controlli del dominio e del limite prima del codice (D20, D24). */
  @Post('identity/company-change/work-email')
  @Scopes('full')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async companyChangeCode(
    @CurrentUser() me: AuthContext,
    @Body() body: EmailDto,
    @Ip() ip: string,
  ): Promise<AcceptedDto> {
    await this.requireCompanyChangeConfirmation(me);
    await this.workIdentity.requestNewWorkEmailCode(me.userId, body.email, ip, 'company_change');
    return { status: 'sent' };
  }

  @Post('identity/company-change/work-email/verify')
  @Scopes('full')
  @HttpCode(200)
  @ApiOkResponse({ type: WorkEmailResultDto })
  async companyChange(
    @CurrentUser() me: AuthContext,
    @Body() body: WorkEmailVerifyDto,
  ): Promise<WorkEmailResultDto> {
    await this.requireCompanyChangeConfirmation(me);
    const result = await this.workIdentity.verifyNewWorkEmail(me.userId, body, 'company_change');
    return { ...result, ...(await this.sessions.reissue(me.userId, me.sessionId)) };
  }

  /** Ri-verifica (P5) o ripristino con la stessa email (D82): codice all'email aziendale attiva. */
  @Post('identity/reverification/code')
  @Scopes('full', 'restore')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async reverificationCode(@CurrentUser() me: AuthContext, @Ip() ip: string): Promise<AcceptedDto> {
    await this.workIdentity.requestReverificationCode(me.userId, ip);
    return { status: 'sent' };
  }

  @Post('identity/reverification/verify')
  @Scopes('full', 'restore')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessTokenDto })
  async reverify(@CurrentUser() me: AuthContext, @Body() body: CodeDto): Promise<AccessTokenDto> {
    await this.workIdentity.verifyReverification(me.userId, body.code);
    return this.sessions.reissue(me.userId, me.sessionId);
  }

  /** Ripristino di un account in sospeso con un'email aziendale nuova (D19, D82, P6). */
  @Post('identity/restore/work-email')
  @Scopes('restore')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async restoreCode(
    @CurrentUser() me: AuthContext,
    @Body() body: EmailDto,
    @Ip() ip: string,
  ): Promise<AcceptedDto> {
    await this.workIdentity.requestNewWorkEmailCode(me.userId, body.email, ip, 'restore');
    return { status: 'sent' };
  }

  @Post('identity/restore/work-email/verify')
  @Scopes('restore')
  @HttpCode(200)
  @ApiOkResponse({ type: WorkEmailResultDto })
  async restore(
    @CurrentUser() me: AuthContext,
    @Body() body: WorkEmailVerifyDto,
  ): Promise<WorkEmailResultDto> {
    const result = await this.workIdentity.verifyNewWorkEmail(me.userId, body, 'restore');
    return { ...result, ...(await this.sessions.reissue(me.userId, me.sessionId)) };
  }

  /** L'avviso dell'azienda lasciata si mostra una volta: l'app lo conferma (D176). */
  @Post('me/notices/excluded-companies')
  @Scopes('full', 'approval')
  @HttpCode(204)
  @ApiNoContentResponse()
  async ackExcludedNotice(@CurrentUser() me: AuthContext): Promise<void> {
    await this.db.execute(
      sql`update users set excluded_companies_notice_at = null where id = ${me.userId}::uuid`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Email e accesso (D82, D224, D233)
  // ---------------------------------------------------------------------------------------------

  @Get('me/access')
  @Scopes(...ALL)
  @ApiOkResponse({ type: AccessInfoDto })
  accessInfo(@CurrentUser() me: AuthContext): Promise<AccessInfoDto> {
    return this.access.info(me.userId);
  }

  /** Accensione e spegnimento dell'accesso con l'email aziendale (`workEmailSignIn`, D233). */
  @Put('me/access')
  @Scopes('full', 'approval')
  @ApiOkResponse({ type: AccessInfoDto })
  setAccess(@CurrentUser() me: AuthContext, @Body() body: AccessUpdateDto): Promise<AccessInfoDto> {
    return this.access.setWorkEmailSignIn(me.userId, body.workEmailSignIn);
  }

  /** Codice alla nuova email personale per passare all'accesso con l'email. */
  @Post('me/access/method/email-code')
  @Scopes('full')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async methodEmailCode(
    @CurrentUser() me: AuthContext,
    @Body() body: EmailDto,
    @Ip() ip: string,
  ): Promise<AcceptedDto> {
    await this.access.requireConfirmation(me.sessionId, 'access_change');
    await this.access.sendNewEmailCode(me.userId, body.email, ip);
    return { status: 'sent' };
  }

  /** Cambio del modo di accesso dopo la conferma con quello di oggi (Proposta 1, D233). */
  @Put('me/access/method')
  @Scopes('full')
  @ApiOkResponse({ type: AccessInfoDto })
  changeMethod(
    @CurrentUser() me: AuthContext,
    @Body() body: AccessMethodDto,
  ): Promise<AccessInfoDto> {
    return this.access.changeMethod(me.userId, me.sessionId, body);
  }

  @Post('me/personal-email')
  @Scopes('full', 'approval')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async personalEmail(
    @CurrentUser() me: AuthContext,
    @Body() body: EmailDto,
    @Ip() ip: string,
  ): Promise<AcceptedDto> {
    await this.access.requestPersonalEmailChange(me.userId, body.email, ip);
    return { status: 'sent' };
  }

  @Post('me/personal-email/verify')
  @Scopes('full', 'approval')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessInfoDto })
  personalEmailVerify(
    @CurrentUser() me: AuthContext,
    @Body() body: PersonalEmailVerifyDto,
  ): Promise<AccessInfoDto> {
    return this.access.verifyPersonalEmailChange(me.userId, body);
  }

  // ---------------------------------------------------------------------------------------------
  // Consensi, cancellazione ed esportazione (D33, D83, D98)
  // ---------------------------------------------------------------------------------------------

  @Get('me/consents')
  @Scopes(...ALL)
  @ApiOkResponse({ type: ConsentDto, isArray: true })
  async consents(@CurrentUser() me: AuthContext): Promise<ConsentDto[]> {
    const rows = await this.db.execute<{
      type: string;
      text_version: string;
      given_at: Date;
      revoked_at: Date | null;
    }>(sql`
      select type, text_version, given_at, revoked_at from consents
       where user_id = ${me.userId}::uuid order by given_at`);
    return rows.rows.map((row) => ({
      type: row.type,
      textVersion: row.text_version,
      givenAt: asDate(row.given_at)!,
      revokedAt: asDate(row.revoked_at),
    }));
  }

  /** Revoca del consenso art. 9 con una semplice conferma: chiude l'account (D33, D83). */
  @Post('me/consents/art9/revocation')
  @Scopes(...ALL)
  @HttpCode(200)
  @ApiOkResponse({ type: DeletionStateDto })
  revokeConsent(@CurrentUser() me: AuthContext): Promise<DeletionStateDto> {
    return this.startDeletion(me, 'consent');
  }

  /** Codice all'email personale per confermare la cancellazione (D83, D233). */
  @Post('me/deletion/code')
  @Scopes(...ALL)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async deletionCode(@CurrentUser() me: AuthContext, @Ip() ip: string): Promise<AcceptedDto> {
    const email = await this.mailer.personalEmail(me.userId);
    if (!email) throw ApiError.forbidden();
    await this.otp.issue({ email, purpose: 'deletion', from: 'project', ip, userId: me.userId });
    return { status: 'sent' };
  }

  @Post('me/deletion')
  @Scopes(...ALL)
  @HttpCode(200)
  @ApiOkResponse({ type: DeletionStateDto })
  async requestDeletion(
    @CurrentUser() me: AuthContext,
    @Body() body: CodeDto,
  ): Promise<DeletionStateDto> {
    const email = await this.mailer.personalEmail(me.userId);
    if (!email) throw ApiError.forbidden();
    await this.otp.verifyOrThrow(email, 'deletion', body.code);
    return this.startDeletion(me, 'user');
  }

  /** Annulla la cancellazione (o la revoca del consenso) durante i 7 giorni (D83). */
  @Delete('me/deletion')
  @Scopes('limited')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessTokenDto })
  async cancelDeletion(@CurrentUser() me: AuthContext): Promise<AccessTokenDto> {
    await this.lifecycle.cancelDeletion(me.userId);
    return this.sessions.reissue(me.userId, me.sessionId);
  }

  @Post('me/exports')
  @Scopes(...ALL)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: DataExportDto })
  requestExport(@CurrentUser() me: AuthContext): Promise<DataExportDto> {
    return this.exports.request(me.userId);
  }

  @Get('me/exports')
  @Scopes(...ALL)
  @ApiOkResponse({ type: DataExportDto, isArray: true })
  listExports(@CurrentUser() me: AuthContext): Promise<DataExportDto[]> {
    return this.exports.list(me.userId);
  }

  @Get('me/exports/:id')
  @Scopes(...ALL)
  @ApiOkResponse({ type: DataExportDto })
  getExport(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DataExportDto> {
    return this.exports.get(me.userId, id);
  }

  /**
   * Avvio del ripensamento: nella stessa transazione la richiesta e la revoca delle altre
   * sessioni; la sessione corrente passa a `limited`, da cui si può annullare (D83).
   */
  private async startDeletion(
    me: AuthContext,
    source: 'user' | 'consent',
  ): Promise<DeletionStateDto> {
    const { state, token } = await this.db.transaction(async (tx) => {
      const state = await this.lifecycle.requestDeletion(me.userId, source, tx);
      await tx.execute(sql`
        update sessions set revoked_at = now()
         where user_id = ${me.userId}::uuid and id <> ${me.sessionId}::uuid and revoked_at is null`);
      const token = await this.sessions.reissue(me.userId, me.sessionId, tx);
      return { state, token };
    });
    await this.lifecycle.notifyDeletionRequested(me.userId, state);
    return { ...state, ...token };
  }

  private requireCompanyChangeConfirmation(me: AuthContext): Promise<void> {
    return this.access.requireConfirmation(me.sessionId, 'company_change');
  }
}
