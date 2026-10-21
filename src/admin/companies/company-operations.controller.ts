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
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { CompaniesService } from '../../domain/companies/companies.service';
import { CompanyOperationsService } from '../../domain/companies/company-operations.service';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAuthService } from '../auth/operator-auth.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto, StrongConfirmationDto } from '../common/admin.dto';
import { by, CompanyDto } from './companies.controller';

/** Anteprima con i soli conteggi e l'avviso di somiglianza (D197), mai l'Open space. */
export class ChangePreviewDto {
  @ApiProperty({ description: 'Utenti che cambiano azienda' }) usersMoving: number;
  @ApiProperty({ description: 'Match senza messaggi da revocare tra nuovi colleghi' })
  matchesToRevoke: number;
  @ApiProperty({ description: 'Like in attesa da cancellare' }) likesToDelete: number;
  @ApiProperty({ type: [String], description: 'Nomi di aziende simili già presenti' })
  similarCompanies: string[];
}

export class SimilarCompanyDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['name', 'domain'] }) matchedOn: string;
}

export class SimilarQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ description: 'Domini separati da virgola' })
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  domains?: string;
}

export class MoveQueryDto {
  @ApiProperty({ description: 'Azienda che riceve il dominio' })
  @IsUUID()
  to: string;
}

export class MergeQueryDto {
  @ApiProperty({ description: 'Azienda che resta' })
  @IsUUID()
  into: string;
}

/**
 * Spostamento e fusione cambiano l'azienda di utenti già iscritti: conferma rafforzata con il
 * nome digitato (dominio o azienda assorbita) e la motivazione (AF "Gestione dell'elenco", D197,
 * D244).
 */
export class MoveDomainDto extends StrongConfirmationDto {
  @ApiProperty()
  @IsUUID()
  targetCompanyId: string;
}

export class MergeDto extends StrongConfirmationDto {
  @ApiProperty({ description: 'Azienda che resta; il nome da digitare è quello dell’assorbita' })
  @IsUUID()
  targetCompanyId: string;
}

export class RemovalPreviewDto {
  @ApiProperty() companyId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: [String] }) domains: string[];
  @ApiProperty({ description: 'Account coinvolti (D111)' }) accountsCount: number;
}

export class WaitlistGroupDto {
  @ApiProperty({ description: 'Identificativo del gruppo: il dominio' }) id: string;
  @ApiProperty() domain: string;
  @ApiProperty() requestsCount: number;
  @ApiProperty({ type: [String] }) suggestedNames: string[];
  @ApiProperty() firstAt: Date;
  @ApiProperty() lastAt: Date;
}

export class WaitlistResponseDto extends ExplanationDto {
  @ApiProperty({
    enum: ['added', 'not_added'],
    description: 'Solo per l’audit: la risposta all’email è uguale nei due casi (D95)',
  })
  @IsIn(['added', 'not_added'])
  outcome: 'added' | 'not_added';
}

export class CountDto {
  @ApiProperty() count: number;
}

export class DirectoryAlertDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Azienda di chi segnala' }) reporterCompany: string;
  @ApiProperty({ description: 'Azienda della persona segnalata' }) reportedCompany: string;
  @ApiProperty() reporterCompanyId: string;
  @ApiProperty() reportedCompanyId: string;
  @ApiProperty() windowStartsAt: Date;
  @ApiProperty() windowEndsAt: Date;
  @ApiProperty({ enum: ['open', 'closed'] }) status: string;
}

/**
 * Operazioni sull'elenco che toccano gli utenti (P14, D85, D93, D94, D111, D120, D185) e lista
 * d'attesa (D95), avvisi aggregati (D72), avviso di somiglianza (D197): solo l'Amministratore.
 * Spostamenti, fusioni e rimozioni hanno l'anteprima con i soli conteggi e la conferma rafforzata.
 */
@ApiTags('backoffice-companies')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice')
export class CompanyOperationsController {
  constructor(
    private readonly operations: CompanyOperationsService,
    private readonly companies: CompaniesService,
    private readonly auth: OperatorAuthService,
  ) {}

  @Get('companies-similar')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: SimilarCompanyDto, isArray: true })
  similar(@Query() query: SimilarQueryDto): Promise<SimilarCompanyDto[]> {
    return this.operations.similar({
      name: query.name,
      domains: query.domains
        ?.split(',')
        .map((domain) => domain.trim())
        .filter(Boolean),
    });
  }

  @Get('domains/:domain/move/preview')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: ChangePreviewDto })
  async previewMove(
    @Param('domain') domain: string,
    @Query() query: MoveQueryDto,
  ): Promise<ChangePreviewDto> {
    const normalized = domain.toLowerCase();
    const counts = await this.operations.previewMoveDomain(normalized, query.to);
    return preview(counts, await this.operations.similar({ domains: [normalized] }, query.to));
  }

  /** Spostamento: conferma con il dominio digitato (D197, D244). */
  @Post('domains/:domain/move')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  async move(
    @CurrentOperator() operator: OperatorContext,
    @Param('domain') domain: string,
    @Body() body: MoveDomainDto,
  ): Promise<CompanyDto> {
    const normalized = domain.toLowerCase();
    if (body.confirmName.trim().toLowerCase() !== normalized) {
      throw ApiError.badRequest('confirmation.mismatch');
    }
    await this.operations.moveDomain(normalized, body.targetCompanyId, by(operator, body));
    return this.companies.get(body.targetCompanyId);
  }

  @Get('companies/:id/merge/preview')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: ChangePreviewDto })
  async previewMerge(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MergeQueryDto,
  ): Promise<ChangePreviewDto> {
    const counts = await this.operations.previewMerge(id, query.into);
    const absorbed = await this.companies.get(id);
    return preview(counts, await this.operations.similar({ name: absorbed.name }, id));
  }

  /** Fusione dell'azienda `id` in `targetCompanyId`: nome dell'assorbita digitato (D244). */
  @Post('companies/:id/merge')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  async merge(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MergeDto,
  ): Promise<CompanyDto> {
    const company = await this.companies.get(id);
    if (company.name.trim().toLowerCase() !== body.confirmName.trim().toLowerCase()) {
      throw ApiError.badRequest('confirmation.mismatch');
    }
    await this.operations.merge(id, body.targetCompanyId, by(operator, body));
    return this.companies.get(body.targetCompanyId);
  }

  @Get('companies/:id/removal/preview')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: RemovalPreviewDto })
  removalPreview(@Param('id', ParseUUIDPipe) id: string): Promise<RemovalPreviewDto> {
    return this.operations.removalPreview(id);
  }

  /** Avvio della rimozione con la conferma rafforzata (D93, D111): utenti invisibili subito. */
  @Post('companies/:id/removal')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  async startRemoval(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StrongConfirmationDto,
  ): Promise<CompanyDto> {
    const company = await this.companies.get(id);
    if (company.name.trim().toLowerCase() !== body.confirmName.trim().toLowerCase()) {
      throw ApiError.badRequest('confirmation.mismatch');
    }
    await this.operations.startRemoval(id, by(operator, body));
    return this.companies.get(id);
  }

  /** Annullamento durante l'intervallo (D120), con la motivazione. */
  @Delete('companies/:id/removal')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  async cancelRemoval(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<CompanyDto> {
    await this.operations.cancelRemoval(id, by(operator, body));
    return this.companies.get(id);
  }

  @Get('waitlist')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: WaitlistGroupDto, isArray: true })
  async waitlist(): Promise<WaitlistGroupDto[]> {
    return (await this.operations.waitlist()).map((group) => ({
      id: group.domain,
      domain: group.domain,
      requestsCount: group.requests,
      suggestedNames: group.suggestedNames,
      firstAt: group.firstAt,
      lastAt: group.lastAt,
    }));
  }

  /** Risposta neutra alle richieste di un dominio e loro cancellazione (D95). */
  @Post('waitlist/:domain/response')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: CountDto })
  async answer(
    @CurrentOperator() operator: OperatorContext,
    @Param('domain') domain: string,
    @Body() body: ExplanationDto,
  ): Promise<CountDto> {
    return {
      count: await this.operations.answerWaitlist(domain.toLowerCase(), by(operator, body)),
    };
  }

  @Get('directory-alerts')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: DirectoryAlertDto, isArray: true })
  alerts(): Promise<DirectoryAlertDto[]> {
    return this.operations.alerts();
  }

  @Post('directory-alerts/:id/closure')
  @OperatorRoles('admin')
  @HttpCode(204)
  async closeAlert(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<void> {
    await this.operations.closeAlert(id, by(operator, body));
  }
}

function preview(
  counts: { usersMoved: number; matchesRevoked: number; likesDeleted: number },
  similar: { name: string }[],
): ChangePreviewDto {
  return {
    usersMoving: counts.usersMoved,
    matchesToRevoke: counts.matchesRevoked,
    likesToDelete: counts.likesDeleted,
    similarCompanies: similar.map((company) => company.name),
  };
}
