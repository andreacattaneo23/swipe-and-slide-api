import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiError } from '../../infra/http/api-error';
import { CompaniesService, CompanyRecord } from '../../domain/companies/companies.service';
import { CompanyOperationsService } from '../../domain/companies/company-operations.service';
import { OperatorAuthService } from '../auth/operator-auth.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto, StrongConfirmationDto } from '../common/admin.dto';

export class CompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['active', 'merged', 'removing'] })
  status: string;

  @ApiProperty()
  isDemo: boolean;

  @ApiProperty({ type: [String] })
  domains: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date, description: 'Fine dell’intervallo (D111)' })
  removalFinalAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Utenti attivi in forma aggregata, `null` sotto 10 (D89)',
  })
  usersCount: number | null;
}

export class CompanyListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 60)
  search?: string;

  @ApiPropertyOptional({ description: 'Cursore: ultimo nome della pagina precedente' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  after?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateCompanyDto extends ExplanationDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({
    type: [String],
    example: ['modello-partners.it'],
    description: 'Corrispondenza esatta (P12)',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(3, 253, { each: true })
  domains: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Azienda dimostrativa per gli store (D42), immutabile',
  })
  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;
}

export class RenameCompanyDto extends ExplanationDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name: string;
}

export class AddDomainDto extends ExplanationDto {
  @ApiProperty({ example: 'it.modello-partners.com' })
  @IsString()
  @Length(3, 253)
  domain: string;
}

/** Elenco delle aziende (D84): solo l'Amministratore, ogni modifica con motivazione e audit. */
@ApiTags('backoffice-companies')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly auth: OperatorAuthService,
    private readonly operations: CompanyOperationsService,
  ) {}

  @Get('companies')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: CompanyDto, isArray: true })
  list(@Query() query: CompanyListQueryDto): Promise<CompanyDto[]> {
    return this.companies
      .list({ search: query.search, after: query.after, limit: query.limit ?? 50 })
      .then(toDtos);
  }

  @Post('companies')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: CompanyDto })
  create(
    @CurrentOperator() operator: OperatorContext,
    @Body() body: CreateCompanyDto,
  ): Promise<CompanyDto> {
    return this.companies
      .create(
        { name: body.name, domains: body.domains, isDemo: body.isDemo ?? false },
        by(operator, body),
      )
      .then(toDto);
  }

  @Get('companies/:id')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: CompanyDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CompanyDto> {
    return this.companies.get(id).then(toDto);
  }

  @Patch('companies/:id')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: CompanyDto })
  rename(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameCompanyDto,
  ): Promise<CompanyDto> {
    return this.companies.rename(id, body.name, by(operator, body)).then(toDto);
  }

  /**
   * Cancellazione con conferma rafforzata, solo per aziende senza utenti. Con utenti serve la
   * rimozione con anteprima e intervallo (D111, `/removal`): qui `409`.
   */
  @Delete('companies/:id')
  @OperatorRoles('admin')
  @HttpCode(204)
  async delete(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StrongConfirmationDto,
  ): Promise<void> {
    const company = await this.companies.get(id);
    if (company.name.trim().toLowerCase() !== body.confirmName.trim().toLowerCase())
      throw ApiError.badRequest('confirmation.mismatch');
    await this.companies.delete(id, by(operator, body));
  }

  @Post('companies/:id/domains')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: CompanyDto })
  addDomain(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddDomainDto,
  ): Promise<CompanyDto> {
    return this.companies.addDomain(id, body.domain, by(operator, body)).then(toDto);
  }

  @Delete('companies/:id/domains/:domain')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: CompanyDto })
  async removeDomain(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domain') domain: string,
    @Body() body: ExplanationDto,
  ): Promise<CompanyDto> {
    // Chi usa il dominio va in ri-verifica e resta nella stessa azienda (P14, RC-44)
    await this.operations.removeDomain(id, domain.toLowerCase(), by(operator, body));
    return this.companies.get(id).then(toDto);
  }
}

export function by(operator: OperatorContext, body: { explanation?: string | null }) {
  return {
    operatorId: operator.operatorId,
    sessionId: operator.sessionId,
    explanation: body.explanation?.trim() ?? '',
  };
}

function toDto(company: CompanyRecord): CompanyDto {
  return { ...company };
}

function toDtos(companies: CompanyRecord[]): CompanyDto[] {
  return companies.map(toDto);
}
