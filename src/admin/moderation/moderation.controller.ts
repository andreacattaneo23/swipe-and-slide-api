import { ApiError } from '../../infra/http/api-error';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import {
  CHAT_READ_REASONS,
  ChatAccessService,
  ChatReadReason,
} from '../../domain/safety/chat-access.service';
import { AgeVerificationService } from '../../domain/safety/age-verification.service';
import {
  DECISION_ALIASES,
  MODERATION_DECISIONS,
  ModerationDecision,
  ModerationService,
  REMOVABLE_FIELDS,
  RemovableField,
} from '../../domain/safety/moderation.service';
import { PhotoReviewService } from '../../domain/safety/photo-review.service';
import {
  DecidedSanctionType,
  SANCTION_TYPES,
  SEVERE_CASES,
  SevereCase,
} from '../../domain/safety/sanctions.service';
import { OperatorAuthService } from '../auth/operator-auth.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto } from '../common/admin.dto';
import { by } from '../companies/companies.controller';

export class QueueEntryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['report', 'photo'] }) kind: string;
  @ApiPropertyOptional({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ enum: ['severe', 'standard'] }) severity: string;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ nullable: true, type: Date, description: 'Vuota per le dimostrative' })
  dueAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) minutesLeft: number | null;
  @ApiProperty() isDemo: boolean;
  @ApiProperty() reportsCount: number;
}

export class CasePhotoDto {
  @ApiProperty() id: string;
  @ApiProperty() position: number;
  @ApiProperty() status: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'URL firmato di pochi minuti' })
  url: string | null;
}

export class CaseSubjectDto {
  @ApiProperty() userId: string;
  @ApiPropertyOptional({ nullable: true, type: String }) firstName: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) ageYears: number | null;
  @ApiProperty() status: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Bio copiata nel caso' })
  bio: string | null;
  @ApiProperty({ type: [CasePhotoDto] }) photos: CasePhotoDto[];
}

export class CaseReportDto {
  @ApiProperty() reason: string;
  @ApiPropertyOptional({ nullable: true, type: String }) note: string | null;
  @ApiProperty() createdAt: Date;
}

export class FlaggedMessageDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true, type: Date }) sentAt: Date | null;
  @ApiProperty({ description: 'Scritto dalla persona segnalata' }) fromReported: boolean;
  @ApiProperty() text: string;
}

/** Caso della coda (D71, D187): solo i contenuti segnalati, chi segnala resta anonimo. */
export class CaseViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['report', 'photo'] }) kind: string;
  @ApiPropertyOptional({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ enum: ['severe', 'standard'] }) severity: string;
  @ApiProperty() reportsCount: number;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) dueAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: CaseSubjectDto }) subject: CaseSubjectDto | null;
  @ApiProperty({ type: [CaseReportDto] }) reports: CaseReportDto[];
  @ApiProperty({ type: [FlaggedMessageDto] }) flaggedMessages: FlaggedMessageDto[];
  @ApiPropertyOptional({ nullable: true, type: CasePhotoDto }) photo: CasePhotoDto | null;
  @ApiProperty() priorSanctions: number;
}

const DECISION_INPUTS = [...MODERATION_DECISIONS, 'dismiss', 'remove_content'] as const;

export class CaseDecisionDto extends ExplanationDto {
  @ApiProperty({
    enum: DECISION_INPUTS,
    description: '`dismiss` e `remove_content` sono sinonimi di `dismissed` e `content_removed`',
  })
  @IsIn(DECISION_INPUTS)
  decision: (typeof DECISION_INPUTS)[number];

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Motivazione per l’utente: obbligatoria per avviso, sospensione ed espulsione',
  })
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  userExplanation?: string;

  @ApiPropertyOptional({ enum: SEVERE_CASES, description: 'Caso grave: espulsione immediata' })
  @IsOptional()
  @IsIn(SEVERE_CASES)
  severeCase?: SevereCase;

  @ApiPropertyOptional({ enum: REMOVABLE_FIELDS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(REMOVABLE_FIELDS, { each: true })
  fields?: RemovableField[];

  @ApiPropertyOptional({ type: [String], description: 'Foto da respingere' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUUID('all', { each: true })
  photoIds?: string[];
}

export class ReporterSanctionDto extends ExplanationDto {
  @ApiProperty({ enum: SANCTION_TYPES })
  @IsIn(SANCTION_TYPES)
  type: DecidedSanctionType;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @Length(3, 1000)
  userExplanation: string;
}

export class NewPhotoDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiPropertyOptional({ nullable: true, type: String }) firstName: string | null;
  @ApiProperty() position: number;
  @ApiProperty() uploadedAt: Date;
  @ApiProperty() submittedAt: Date;
  @ApiProperty({ type: CasePhotoDto }) photo: CasePhotoDto;
  @ApiProperty() dueAt: Date;
  @ApiProperty() minutesLeft: number;
  @ApiProperty({ description: 'URL firmato di pochi minuti' }) url: string;
}

export class PhotoOutcomeDto extends ExplanationDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  outcome: 'approved' | 'rejected';
}

export class ChatReadDto extends ExplanationDto {
  @ApiProperty({ enum: CHAT_READ_REASONS })
  @IsIn(CHAT_READ_REASONS)
  reason: ChatReadReason;

  @ApiProperty({ description: 'Riferimento della richiesta delle autorità o del caso' })
  @IsString()
  @Length(3, 120)
  reference: string;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  from: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  to: Date;

  @ApiProperty({ description: 'Identificativo del match digitato per conferma (D187, D244)' })
  @IsString()
  @Length(1, 64)
  confirmName: string;
}

export class ChatReadMessageDto {
  @ApiProperty() id: string;
  @ApiProperty() senderId: string;
  @ApiProperty() sentAt: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) text: string | null;
}

/**
 * Moderazione (D71–D76, D113, D143, D187): coda con le scadenze di 24 e 72 ore, casi con i soli
 * contenuti segnalati, decisioni motivate, foto nuove e lettura motivata delle chat.
 */
@ApiTags('backoffice-moderation')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice')
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly photos: PhotoReviewService,
    private readonly ageVerification: AgeVerificationService,
    private readonly chats: ChatAccessService,
    private readonly auth: OperatorAuthService,
  ) {}

  @Get('moderation/queue')
  @OperatorRoles('admin', 'moderator')
  @ApiOkResponse({ type: QueueEntryDto, isArray: true })
  queue(): Promise<QueueEntryDto[]> {
    return this.moderation.queue();
  }

  @Get('moderation/cases/:id')
  @OperatorRoles('admin', 'moderator')
  @ApiOkResponse({ type: CaseViewDto })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<CaseViewDto> {
    return this.moderation.caseView(id);
  }

  @Post('moderation/cases/:id')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(204)
  async decide(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CaseDecisionDto,
  ): Promise<void> {
    await this.moderation.decideAny(
      id,
      {
        decision: DECISION_ALIASES[body.decision] ?? (body.decision as ModerationDecision),
        userExplanation: body.userExplanation,
        severeCase: body.severeCase ?? null,
        fields: body.fields,
        photoIds: body.photoIds,
      },
      by(operator, body),
    );
  }

  @Post('moderation/cases/:id/severity')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(204)
  async severity(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<void> {
    await this.moderation.raiseSeverity(id, by(operator, body));
  }

  /** Segnalazione falsa volontaria (D113): sanzione a chi ha segnalato, senza vederne l'identità. */
  @Post('moderation/cases/:id/reporter-sanction')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(204)
  async sanctionReporter(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReporterSanctionDto,
  ): Promise<void> {
    await this.moderation.sanctionReporter(
      id,
      { type: body.type, userExplanation: body.userExplanation },
      by(operator, body),
    );
  }

  /** Il Moderatore avvia la verifica dell'età della persona segnalata (D113). */
  @Post('moderation/cases/:id/age-verification')
  @OperatorRoles('admin', 'moderator', 'support')
  @HttpCode(204)
  async startAgeVerification(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<void> {
    const detail = await this.moderation.detail(id);
    if (!detail.reported) return;
    await this.ageVerification.request(detail.reported.userId, by(operator, body), id);
  }

  @Get('new-photos/queue')
  @OperatorRoles('admin', 'moderator')
  @ApiOkResponse({ type: NewPhotoDto, isArray: true })
  newPhotos(): Promise<NewPhotoDto[]> {
    return this.photos.newPhotosQueue();
  }

  /** Esito di una foto nuova (D143) o segnalata dal controllo automatico (D73). */
  @Post('new-photos/:id/outcome')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(204)
  async photoOutcome(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PhotoOutcomeDto,
  ): Promise<void> {
    await this.photos.decide(id, body.outcome, by(operator, body));
  }

  /**
   * Lettura motivata di una chat (D181, D187): solo l'Amministratore, con motivo, riferimento,
   * periodo e l'identificativo del match digitato (D244, senza secondo fattore); la riga
   * `chat_read` dell'audit nasce nella stessa transazione.
   */
  @Post('matches/:id/chat-read')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: ChatReadMessageDto, isArray: true })
  async readChat(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChatReadDto,
  ): Promise<ChatReadMessageDto[]> {
    if (body.confirmName.trim().toLowerCase() !== id.toLowerCase()) {
      throw ApiError.badRequest('confirmation.mismatch');
    }
    return this.chats.read(
      id,
      { reason: body.reason, reference: body.reference, from: body.from, to: body.to },
      by(operator, body),
    );
  }
}
