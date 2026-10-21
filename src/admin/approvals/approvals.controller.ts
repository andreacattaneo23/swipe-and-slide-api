import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import {
  ApprovalsService,
  QueueItem,
  REJECTION_REASONS,
  RejectionReason,
  ReviewDetail,
} from '../../domain/approvals/approvals.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto } from '../common/admin.dto';
import { by } from '../companies/companies.controller';

export class QueueQueryDto {
  @ApiPropertyOptional({ description: "Cursore: `submittedAt` dell'ultima revisione della pagina" })
  @IsOptional()
  @IsDateString()
  after?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class QueueItemDto {
  @ApiProperty() reviewId: string;
  @ApiProperty() userId: string;
  @ApiProperty({ minimum: 1, maximum: 3 }) attempt: number;
  @ApiProperty() submittedAt: Date;
  @ApiProperty() dueAt: Date;
  @ApiProperty({ description: 'Minuti alle 24 ore, negativi se in ritardo (D144)' })
  minutesLeft: number;
  @ApiProperty({ nullable: true, type: String }) firstName: string | null;
  @ApiProperty({ description: "Solo l'età, mai la data di nascita (D90)" }) ageYears: number;
  @ApiProperty({ nullable: true, type: String }) gender: string | null;
  @ApiProperty({ nullable: true, type: String }) practiceArea: string | null;
  @ApiProperty({ nullable: true, type: String }) lookingFor: string | null;
  @ApiProperty({ nullable: true, type: String }) bio: string | null;
  @ApiProperty({ nullable: true, type: String }) companyName: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'URL firmato, pochi minuti' })
  photoUrl: string | null;
}

export class ReviewPhotoDto {
  @ApiProperty() id: string;
  @ApiProperty() position: number;
  @ApiProperty() status: string;
  @ApiProperty({ description: 'URL firmato di pochi minuti' }) url: string;
}

export class PreviousAttemptDto {
  @ApiProperty() attempt: number;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: String }) explanation: string | null;
}

export class ReviewDetailDto extends QueueItemDto {
  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] }) outcome: string;
  @ApiProperty({ type: [ReviewPhotoDto] }) photos: ReviewPhotoDto[];
  @ApiProperty({ type: [PreviousAttemptDto] }) previousAttempts: PreviousAttemptDto[];
}

export class RejectDto extends ExplanationDto {
  @ApiProperty({ enum: REJECTION_REASONS })
  @IsIn(REJECTION_REASONS)
  reason: RejectionReason;

  @ApiProperty({
    description: "Cosa correggere: visibile solo nell'app (D142)",
    minLength: 3,
    maxLength: 1000,
  })
  @IsString()
  @Length(3, 1000)
  userExplanation: string;
}

export class RejectResultDto {
  @ApiProperty() attempt: number;
  @ApiProperty({ description: 'Terzo rifiuto: email bloccate per 2 anni (D142)' }) blocked: boolean;
}

/**
 * Coda "Approvazioni" (D141–D144): Moderatore e Amministratore. La vista non contiene "chi ti
 * interessa", email, aziende escluse, blocchi né Open space (D90, RC-168).
 */
@ApiTags('backoffice-approvals')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('queue')
  @OperatorRoles('admin', 'moderator')
  @ApiOkResponse({ type: QueueItemDto, isArray: true })
  queue(@Query() query: QueueQueryDto): Promise<QueueItem[]> {
    return this.approvals.queue({ after: query.after, limit: query.limit ?? 50 });
  }

  @Get(':id')
  @OperatorRoles('admin', 'moderator')
  @ApiOkResponse({ type: ReviewDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ReviewDetail> {
    return this.approvals.detail(id);
  }

  @Post(':id/approval')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(204)
  async approve(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<void> {
    await this.approvals.approve(id, by(operator, body));
  }

  @Post(':id/rejection')
  @OperatorRoles('admin', 'moderator')
  @HttpCode(200)
  @ApiOkResponse({ type: RejectResultDto })
  reject(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectDto,
  ): Promise<RejectResultDto> {
    return this.approvals.reject(
      id,
      { reason: body.reason, explanation: body.userExplanation },
      by(operator, body),
    );
  }
}
