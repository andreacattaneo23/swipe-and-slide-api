import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AgeVerificationService } from '../../domain/safety/age-verification.service';
import { ModerationService } from '../../domain/safety/moderation.service';
import {
  DecidedSanctionType,
  SANCTION_TYPES,
  SEVERE_CASES,
  SanctionsService,
  SevereCase,
} from '../../domain/safety/sanctions.service';
import { UserAdminService } from '../../domain/safety/user-admin.service';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAuthService } from '../auth/operator-auth.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto, StrongConfirmationDto } from '../common/admin.dto';
import { by } from '../companies/companies.controller';

export class UserSearchQueryDto {
  @ApiPropertyOptional({ description: 'Email esatta, personale o aziendale attiva' })
  @IsOptional()
  @IsString()
  @Length(3, 260)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class UserSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() status: string;
  @ApiProperty() isDemo: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) companyName: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) firstName: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Mascherata (D90)' })
  personalEmailMasked: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Mascherata (D90)' })
  workEmailMasked: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Uguale a `workEmailMasked`' })
  maskedWorkEmail: string | null;
  @ApiProperty() createdAt: Date;
}

export class UserPhotoDto {
  @ApiProperty() id: string;
  @ApiProperty() position: number;
  @ApiProperty() status: string;
  @ApiProperty({ description: 'URL firmato di pochi minuti' }) url: string;
}

export class UserReportDto {
  @ApiProperty() id: string;
  @ApiProperty() reason: string;
  @ApiProperty() severity: string;
  @ApiProperty() status: string;
  @ApiProperty() createdAt: Date;
}

export class UserSanctionDto {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiPropertyOptional({ nullable: true, type: String }) severeCase: string | null;
  @ApiProperty() startsAt: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) endsAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) revokedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Motivazione per l’utente' })
  reason: string | null;
  @ApiProperty({ enum: ['none', 'pending', 'upheld', 'rejected'] }) appealStatus: string;
}

/** Scheda (D89, D90): mai "chi ti interessa", aziende escluse, blocchi, Open space né città. */
export class UserCardDto extends UserSummaryDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Mascherata (D90)' })
  maskedPersonalEmail: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) approvedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Giorno dell’ultimo accesso' })
  lastActiveAt: string | null;
  @ApiProperty() visible: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) companyId: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['apple', 'google', 'email'] })
  signInMethod: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) workEmailVerifiedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) nextReverificationAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) reverificationDueAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String }) lastSeenOn: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) deletionScheduledAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) deletionRequestedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Solo l’età (D90)' })
  ageYears: number | null;
  @ApiPropertyOptional({ nullable: true, type: String }) gender: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) practiceArea: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) lookingFor: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) bio: string | null;
  @ApiProperty({ type: [UserPhotoDto] }) photos: UserPhotoDto[];
  @ApiProperty({ type: [UserReportDto] }) reports: UserReportDto[];
  @ApiProperty({ type: [UserSanctionDto] }) sanctions: UserSanctionDto[];
}

export class RevealEmailDto extends ExplanationDto {
  @ApiProperty({ enum: ['personal', 'work'] })
  @IsIn(['personal', 'work'])
  kind: 'personal' | 'work';
}

export class RevealedEmailDto {
  @ApiProperty({ enum: ['personal', 'work'] }) kind: 'personal' | 'work';
  @ApiProperty() email: string;
}

export class UserSanctionInputDto extends ExplanationDto {
  @ApiProperty({ enum: SANCTION_TYPES })
  @IsIn(SANCTION_TYPES)
  type: DecidedSanctionType;

  @ApiPropertyOptional({ enum: SEVERE_CASES })
  @IsOptional()
  @IsIn(SEVERE_CASES)
  severeCase?: SevereCase;

  @ApiProperty({ maxLength: 1000, description: 'Motivazione per l’utente (D75)' })
  @IsString()
  @Length(3, 1000)
  userExplanation: string;
}

export class SanctionCreatedDto {
  @ApiProperty() id: string;
}

export class BirthDateDto extends ExplanationDto {
  @ApiProperty({ example: '1992-04-12' })
  @IsDateString({ strict: true })
  birthDate: string;
}

export class AgeDto {
  @ApiProperty() ageYears: number;
}

export class AgeOutcomeDto extends ExplanationDto {
  @ApiProperty({ enum: ['adult', 'minor'] })
  @IsIn(['adult', 'minor'])
  outcome: 'adult' | 'minor';

  @ApiPropertyOptional({ maxLength: 1000, description: 'Per l’utente, se minorenne (espulsione)' })
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  userExplanation?: string;
}

export class AgeDocumentDto {
  @ApiProperty() requested: boolean;
  @ApiPropertyOptional({ nullable: true, type: Date }) requestedAt: Date | null;
  @ApiProperty() uploaded: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'URL firmato di 5 minuti' })
  documentUrl: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) expiresAt: Date | null;
}

export class CountDto {
  @ApiProperty() count: number;
}

/**
 * Utenti (D89–D93, D112, D113): ricerca, scheda con le email mascherate, rivelazione registrata,
 * sanzioni, riattivazione, ri-verifica forzata, data di nascita, verifica dell'età, cancellazione
 * con la conferma rafforzata. Il Moderatore vede solo le schede dei casi in coda.
 */
@ApiTags('backoffice-users')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice/users')
export class UsersController {
  constructor(
    private readonly users: UserAdminService,
    private readonly sanctions: SanctionsService,
    private readonly moderation: ModerationService,
    private readonly ageVerification: AgeVerificationService,
    private readonly auth: OperatorAuthService,
  ) {}

  @Get()
  @OperatorRoles('admin', 'support')
  @ApiOkResponse({ type: UserSummaryDto, isArray: true })
  search(@Query() query: UserSearchQueryDto): Promise<UserSummaryDto[]> {
    if (!query.email && !query.id) throw ApiError.badRequest('validation');
    return this.users.search(query);
  }

  @Get(':id')
  @OperatorRoles('admin', 'support', 'moderator')
  @ApiOkResponse({ type: UserCardDto })
  async card(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserCardDto> {
    await this.assertScope(operator, id);
    return this.users.card(id);
  }

  @Post(':id/reveal-email')
  @OperatorRoles('admin', 'support')
  @HttpCode(200)
  @ApiOkResponse({ type: RevealedEmailDto })
  async reveal(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RevealEmailDto,
  ): Promise<RevealedEmailDto> {
    return {
      kind: body.kind,
      email: await this.users.revealEmail(id, body.kind, by(operator, body)),
    };
  }

  @Post(':id/reverification')
  @OperatorRoles('admin', 'support')
  @HttpCode(204)
  async reverification(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<void> {
    await this.users.forceReverification(id, by(operator, body));
  }

  @Post(':id/sanctions')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(201)
  @ApiOkResponse({ type: SanctionCreatedDto })
  async sanction(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UserSanctionInputDto,
  ): Promise<SanctionCreatedDto> {
    await this.assertScope(operator, id);
    const sanctionId = await this.sanctions.apply(
      {
        userId: id,
        type: body.type,
        severeCase: body.severeCase ?? null,
        userExplanation: body.userExplanation,
      },
      by(operator, body),
    );
    return { id: sanctionId };
  }

  @Post(':id/reactivation')
  @OperatorRoles('admin', 'support')
  @HttpCode(200)
  @ApiOkResponse({ type: CountDto })
  async reactivate(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<CountDto> {
    return { count: await this.users.reactivate(id, by(operator, body)) };
  }

  @Post(':id/birth-date')
  @OperatorRoles('admin', 'support')
  @HttpCode(200)
  @ApiOkResponse({ type: AgeDto })
  async birthDate(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BirthDateDto,
  ): Promise<AgeDto> {
    return { ageYears: await this.users.correctBirthDate(id, body.birthDate, by(operator, body)) };
  }

  @Post(':id/age-verification')
  @OperatorRoles('admin', 'moderator', 'support')
  @HttpCode(204)
  async requestAgeVerification(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<void> {
    await this.assertScope(operator, id);
    await this.ageVerification.request(id, by(operator, body));
  }

  /** Documento della verifica: solo il Supporto (e l'Amministratore), mai il Moderatore (D113). */
  @Get(':id/age-verification')
  @OperatorRoles('admin', 'support')
  @ApiOkResponse({ type: AgeDocumentDto })
  ageDocument(@Param('id', ParseUUIDPipe) id: string): Promise<AgeDocumentDto> {
    return this.ageVerification.document(id);
  }

  @Post(':id/age-verification/outcome')
  @OperatorRoles('admin', 'support')
  @HttpCode(204)
  async ageOutcome(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AgeOutcomeDto,
  ): Promise<void> {
    if (body.outcome === 'minor' && !body.userExplanation) {
      throw ApiError.badRequest('validation', { field: 'userExplanation' });
    }
    await this.ageVerification.recordOutcome(
      id,
      body.outcome,
      body.userExplanation ?? '',
      by(operator, body),
    );
  }

  /** Cancellazione con la conferma rafforzata (D93, D244): identificativo digitato. */
  @Delete(':id')
  @OperatorRoles('admin', 'support')
  @HttpCode(204)
  async delete(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StrongConfirmationDto,
  ): Promise<void> {
    if (body.confirmName.trim().toLowerCase() !== id.toLowerCase()) {
      throw ApiError.badRequest('confirmation.mismatch');
    }
    await this.users.delete(id, by(operator, body));
  }

  /** Il Moderatore (senza altri ruoli) vede e sanziona solo chi è in un caso in coda (D88). */
  private async assertScope(operator: OperatorContext, userId: string): Promise<void> {
    if (operator.roles.some((role) => role === 'admin' || role === 'support')) return;
    if (!(await this.moderation.inModeratorScope(userId))) throw ApiError.notFound();
  }
}
