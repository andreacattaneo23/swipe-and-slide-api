import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Public, Scopes } from '../../core/auth/scopes.decorator';
import { ApprovalsService } from '../../domain/approvals/approvals.service';
import { WaitlistService } from '../../domain/companies/waitlist.service';
import { AgeVerificationService } from '../../domain/safety/age-verification.service';
import { AppealsService } from '../../domain/safety/appeals.service';
import { ReportsService } from '../../domain/safety/reports.service';
import { SanctionsService } from '../../domain/safety/sanctions.service';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { DATABASE, Database } from '../../infra/database/database';
import { profileReviews, users } from '../../infra/database/schema';
import { ApiError } from '../../infra/http/api-error';
import {
  AgeVerificationStatusDto,
  AppealDto,
  CodeAppealDto,
  MySanctionDto,
  ReceivedDto,
  ReportDto,
  ReportOutcomeDto,
  ResubmissionDto,
  UploadConfirmationDto,
  UploadUrlDto,
  WaitlistRequestDto,
  WaitlistVerificationDto,
} from './safety.dto';

/**
 * Sicurezza dall'app (D71–D76, D113, D142): segnalazioni con blocco automatico e conferma
 * neutra, esiti generici, decisioni motivate e ricorsi, verifica dell'età, ripresentazione del
 * profilo rifiutato e ricorso dopo il terzo rifiuto. Tono serio nei testi dell'app (D69).
 */
@ApiTags('safety')
@ApiBearerAuth()
@Controller()
export class SafetyController {
  constructor(
    private readonly reports: ReportsService,
    private readonly sanctions: SanctionsService,
    private readonly appeals: AppealsService,
    private readonly ageVerification: AgeVerificationService,
    private readonly approvals: ApprovalsService,
    private readonly limiter: RateLimiter,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /**
   * Segnalazione dal profilo (feed o match), dalla chat, da un match chiuso da meno di 30
   * giorni o da "Persone bloccate". La regola si controlla nel servizio: si segnala solo chi si
   * vede o chi è stato in un proprio match, altrimenti `404` neutro.
   */
  @Post('reports')
  @Scopes('full')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: ReceivedDto })
  async report(@CurrentUser() me: AuthContext, @Body() body: ReportDto): Promise<ReceivedDto> {
    await this.reports.create(me.userId, body);
    return { status: 'received' };
  }

  @Get('me/reports')
  @Scopes('full', 'limited')
  @ApiOkResponse({ type: ReportOutcomeDto, isArray: true })
  myReports(@CurrentUser() me: AuthContext): Promise<ReportOutcomeDto[]> {
    return this.reports.outcomesFor(me.userId);
  }

  /** Decisioni motivate della moderazione sull'account (D75), anche durante una sospensione. */
  @Get('me/sanctions')
  @Scopes('full', 'limited', 'restore')
  @ApiOkResponse({ type: MySanctionDto, isArray: true })
  mySanctions(@CurrentUser() me: AuthContext): Promise<MySanctionDto[]> {
    return this.sanctions.listFor(me.userId);
  }

  @Post('me/sanctions/:id/appeal')
  @Scopes('full', 'limited', 'restore')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: ReceivedDto })
  async appeal(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AppealDto,
  ): Promise<ReceivedDto> {
    await this.appeals.submitForSanction(me.userId, id, body.text);
    return { status: 'received' };
  }

  /** Ricorso con il collegamento dell'email, anche dopo la cancellazione dell'account (D75). */
  @Post('appeals')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: ReceivedDto })
  async appealWithCode(@Body() body: CodeAppealDto, @Ip() ip: string): Promise<ReceivedDto> {
    if (!(await this.limiter.hit(`appeal-code:${ip}`, 10, 3600))) throw ApiError.tooManyRequests();
    await this.appeals.submitWithCode(body.code, body.text);
    return { status: 'received' };
  }

  @Get('me/age-verification')
  @Scopes('full', 'limited')
  @ApiOkResponse({ type: AgeVerificationStatusDto })
  ageVerificationStatus(@CurrentUser() me: AuthContext): Promise<AgeVerificationStatusDto> {
    return this.ageVerification.statusFor(me.userId);
  }

  /** URL firmato verso l'area temporanea: il documento non passa mai dal backend (D113). */
  @Post('me/age-verification/upload')
  @Scopes('full', 'limited')
  @HttpCode(200)
  @ApiOkResponse({ type: UploadUrlDto })
  ageVerificationUpload(@CurrentUser() me: AuthContext): Promise<UploadUrlDto> {
    return this.ageVerification.uploadUrl(me.userId);
  }

  @Post('me/age-verification/upload/confirmation')
  @Scopes('full', 'limited')
  @HttpCode(204)
  async ageVerificationConfirm(
    @CurrentUser() me: AuthContext,
    @Body() body: UploadConfirmationDto,
  ): Promise<void> {
    await this.ageVerification.confirmUpload(me.userId, body.key);
  }

  /**
   * Ripresentazione dopo un rifiuto (D142): nuova revisione con 24 ore e la cancellazione
   * prevista dei profili non ripresentati azzerata.
   */
  @Post('me/approval/resubmission')
  @Scopes('approval')
  @HttpCode(200)
  @ApiOkResponse({ type: ResubmissionDto })
  async resubmit(@CurrentUser() me: AuthContext): Promise<ResubmissionDto> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, me.userId))
        .for('update');
      const [last] = await tx
        .select({ attempt: profileReviews.attempt, outcome: profileReviews.outcome })
        .from(profileReviews)
        .where(and(eq(profileReviews.userId, me.userId)))
        .orderBy(desc(profileReviews.attempt))
        .limit(1);
      if (
        user?.status !== 'pending_approval' ||
        last?.outcome !== 'rejected' ||
        last.attempt >= 3
      ) {
        throw ApiError.conflict('conflict');
      }
      const review = await this.approvals.submit(me.userId, tx);
      await tx
        .update(users)
        .set({ deletionScheduledAt: sql`null` })
        .where(eq(users.id, me.userId));
      return { attempt: review.attempt, dueAt: review.dueAt };
    });
  }

  /** Ricorso dopo il terzo rifiuto (D142), dalla sessione `limited`. */
  @Post('me/approval/appeal')
  @Scopes('limited')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: ReceivedDto })
  async approvalAppeal(
    @CurrentUser() me: AuthContext,
    @Body() body: AppealDto,
  ): Promise<ReceivedDto> {
    await this.appeals.submitForThirdRejection(me.userId, body.text);
    return { status: 'received' };
  }
}

/** Lista d'attesa (P13, D95): chi non ha un dominio dell'elenco chiede l'aggiunta. */
@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(
    private readonly waitlist: WaitlistService,
    private readonly limiter: RateLimiter,
  ) {}

  @Post()
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ type: ReceivedDto })
  async request(@Body() body: WaitlistRequestDto, @Ip() ip: string): Promise<ReceivedDto> {
    if (!(await this.limiter.hit(`waitlist:${ip}`, 10, 3600))) throw ApiError.tooManyRequests();
    await this.waitlist.request(body, ip);
    return { status: 'received' };
  }

  /** Conferma dell'email di contatto con il codice (architettura: `POST /waitlist/confirm`). */
  @Post('confirm')
  @Public()
  @HttpCode(204)
  async verify(@Body() body: WaitlistVerificationDto, @Ip() ip: string): Promise<void> {
    if (!(await this.limiter.hit(`waitlist-verify:${ip}`, 20, 3600))) {
      throw ApiError.tooManyRequests();
    }
    await this.waitlist.confirm(body.contactEmail, body.code);
  }
}
