import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AppealsService } from '../../domain/safety/appeals.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto } from '../common/admin.dto';
import { by } from '../companies/companies.controller';

export class AppealListQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'closed'], default: 'pending' })
  @IsOptional()
  @IsIn(['pending', 'closed'])
  status?: 'pending' | 'closed';
}

export class AppealSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['sanction', 'third_rejection'] }) kind: string;
  @ApiPropertyOptional({ nullable: true, type: String }) sanctionType: string | null;
  @ApiProperty() submittedAt: Date;
  @ApiProperty({ description: 'Risposta entro 7 giorni (D75)' }) dueAt: Date;
  @ApiProperty({ enum: ['pending', 'accepted', 'rejected'] }) outcome: string;
  @ApiProperty({ description: 'L’operatore ha deciso la sanzione: serve un’altra persona (D88)' })
  decidedByMe: boolean;
  @ApiProperty({ description: 'Tipo di sanzione o `third_rejection` (D142)' }) subject: string;
}

export class AppealDetailDto extends AppealSummaryDto {
  @ApiProperty() text: string;
  @ApiPropertyOptional({ nullable: true, type: String }) userId: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) decisionExplanation: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) severeCase: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) reviewedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String }) responseExplanation: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) decidedAt: Date | null;
  @ApiProperty() canDecide: boolean;
}

export class AppealDecisionDto extends ExplanationDto {
  @ApiProperty({
    enum: ['accepted', 'upheld', 'rejected'],
    description: '`upheld` (nome del backoffice) è sinonimo di `accepted`',
  })
  @IsIn(['accepted', 'upheld', 'rejected'])
  outcome: 'accepted' | 'upheld' | 'rejected';

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Risposta motivata per l’utente; senza, si usa la motivazione',
  })
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  userExplanation?: string;
}

/** Ricorsi (D75, D113, D142): tutti e tre i ruoli, una persona diversa da chi ha deciso (D88). */
@ApiTags('backoffice-appeals')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice/appeals')
export class AppealsController {
  constructor(private readonly appeals: AppealsService) {}

  @Get()
  @OperatorRoles('admin', 'moderator', 'support')
  @ApiOkResponse({ type: AppealSummaryDto, isArray: true })
  list(
    @CurrentOperator() operator: OperatorContext,
    @Query() query: AppealListQueryDto,
  ): Promise<AppealSummaryDto[]> {
    return this.appeals.list(operator.operatorId, { status: query.status });
  }

  @Get(':id')
  @OperatorRoles('admin', 'moderator', 'support')
  @ApiOkResponse({ type: AppealDetailDto })
  get(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppealDetailDto> {
    return this.appeals.get(operator.operatorId, id);
  }

  @Post(':id/decision')
  @OperatorRoles('admin', 'moderator', 'support')
  @HttpCode(204)
  async decide(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AppealDecisionDto,
  ): Promise<void> {
    await this.appeals.decide(
      id,
      {
        outcome: body.outcome === 'rejected' ? 'rejected' : 'accepted',
        userExplanation: body.userExplanation ?? body.explanation,
      },
      by(operator, body),
    );
  }
}
