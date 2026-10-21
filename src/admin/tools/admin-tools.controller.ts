import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../../infra/http/api-error';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { StoreReviewService } from '../../domain/safety/store-review.service';
import { OperatorAuthService } from '../auth/operator-auth.service';
import { OperatorContext, OperatorRole } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto } from '../common/admin.dto';
import { by } from '../companies/companies.controller';
import { AdminToolsService } from './admin-tools.service';

const ROLES = ['admin', 'moderator', 'support'] as const;

export class AuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: ['action', 'security'] })
  @IsOptional()
  @IsIn(['action', 'security'])
  type?: 'action' | 'security';

  @ApiPropertyOptional({ description: 'Codice dell’azione (es. `sanction_decided`)' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{3,60}$/)
  action?: string;

  @ApiPropertyOptional({ description: 'Cursore: identificativo dell’ultima riga della pagina' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AuditExportQueryDto extends AuditQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

export class AuditEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() at: Date;
  @ApiProperty({ enum: ['action', 'security'] }) type: string;
  @ApiProperty() action: string;
  @ApiPropertyOptional({ nullable: true, type: String }) operatorId: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) operatorName: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '`tipo:identificativo interno` dell’oggetto (D112)',
  })
  subjectRef: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) explanation: string | null;
  @ApiProperty({ type: Object, description: 'Solo conteggi e codici (D112)' }) details: unknown;
}

export class StatsValuesDto {
  @ApiPropertyOptional({ nullable: true, type: Number, description: '`null` sotto la soglia' })
  activeUsers: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) pendingApprovals: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) registrations7d: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) matches7d: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) reports7d: number | null;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Totale della piattaforma, mai per azienda (D197)',
  })
  openSpaceActive: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) companies: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) offsitesPublished: number | null;
}

export class StatsDto {
  @ApiProperty() generatedAt: Date;
  @ApiProperty({ type: StatsValuesDto }) values: StatsValuesDto;
}

export class ConfigLimitDto {
  @ApiProperty() key: string;
  @ApiProperty() value: number;
  @ApiProperty() min: number;
  @ApiProperty() max: number;
  @ApiProperty({ enum: ['count', 'hours', 'days'] }) unit: string;
}

export class ConfigListDto {
  @ApiProperty() key: string;
  @ApiProperty({ type: [String] }) items: string[];
}

export class TaxonomyItemDto {
  @ApiProperty() key: string;
  @ApiProperty() active: boolean;
}

export class TaxonomyDto {
  @ApiProperty({ enum: ['interests', 'practiceAreas', 'lookingFor', 'profileQuestions'] })
  id: string;
  @ApiProperty({ type: [TaxonomyItemDto] }) items: TaxonomyItemDto[];
}

export class SystemConfigDto {
  @ApiProperty({ type: [ConfigLimitDto] }) limits: ConfigLimitDto[];
  @ApiProperty({ type: [ConfigListDto], description: 'Parole del filtro, soglie delle foto' })
  lists: ConfigListDto[];
  @ApiProperty({ type: [TaxonomyDto] }) taxonomies: TaxonomyDto[];
  @ApiProperty() citiesCount: number;
}

export class LimitUpdateDto extends ExplanationDto {
  @ApiProperty()
  @IsInt()
  value: number;
}

export class ConfigValueDto extends ExplanationDto {
  @ApiProperty({ description: 'Elenco di testi (parole del filtro, soglie delle foto)' })
  @IsDefined()
  value: unknown;
}

export class TaxonomyItemUpdateDto extends ExplanationDto {
  @ApiProperty()
  @IsBoolean()
  active: boolean;
}

export class CityDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() provinceCode: string;
}

export class OperatorDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ROLES, isArray: true }) roles: string[];
  @ApiProperty({ enum: ['active', 'disabled'] }) status: string;
  @ApiProperty() createdAt: Date;
}

export class NewOperatorDto extends ExplanationDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ enum: ROLES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLES, { each: true })
  roles: OperatorRole[];
}

export class OperatorCreatedDto {
  @ApiProperty() id: string;
}

export class OperatorUpdateDto extends ExplanationDto {
  @ApiPropertyOptional({ enum: ROLES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLES, { each: true })
  roles?: OperatorRole[];

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

export class ReviewWindowInputDto extends ExplanationDto {
  @ApiProperty({ enum: ['apple', 'google'] })
  @IsIn(['apple', 'google'])
  store: 'apple' | 'google';

  @ApiProperty({ minimum: 1, maximum: 14 })
  @IsInt()
  @Min(1)
  @Max(14)
  days: number;
}

export class ReviewWindowDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['apple', 'google'] }) store: string;
  @ApiProperty() openedAt: Date;
  @ApiProperty({ description: 'Fine prevista (al massimo 14 giorni)' }) endsAt: Date;
  @ApiProperty() failedAttempts: number;
  @ApiPropertyOptional({ nullable: true, type: Date }) closedAt: Date | null;
}

export class DemoAccountDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() companyName: string;
  @ApiProperty({ description: 'Mascherata (D90)' }) maskedEmail: string;
}

export class StoreReviewDto {
  @ApiProperty({ type: [ReviewWindowDto] }) windows: ReviewWindowDto[];
  @ApiProperty({ type: [DemoAccountDto] }) accounts: DemoAccountDto[];
}

export class ReviewWindowOpenedDto {
  @ApiProperty({ type: ReviewWindowDto }) window: ReviewWindowDto;
  @ApiProperty({ description: 'Codice di revisione, mostrato una sola volta (D42)' }) code: string;
}

export class RowsDto {
  @ApiProperty() rows: number;
}

/**
 * Strumenti dell'Amministratore (D42, D88, D89, D99, D112): audit ed esportazione, statistiche
 * aggregate, configurazione, città, operatori, finestre di revisione degli store.
 */
@ApiTags('backoffice-admin')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice')
export class AdminToolsController {
  constructor(
    private readonly tools: AdminToolsService,
    private readonly storeReview: StoreReviewService,
    private readonly auth: OperatorAuthService,
  ) {}

  @Get('audit')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: AuditEntryDto, isArray: true })
  audit(@Query() query: AuditQueryDto): Promise<AuditEntryDto[]> {
    return this.tools.auditEntries({ ...query, limit: query.limit ?? 100 });
  }

  /** Esportazione con i filtri dell'elenco; resta nell'audit a sua volta (D197). */
  @Get('audit/export')
  @OperatorRoles('admin')
  async exportAudit(
    @CurrentOperator() operator: OperatorContext,
    @Query() query: AuditExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const format = query.format ?? 'csv';
    const body = await this.tools.exportAudit(
      { from: query.from, to: query.to, type: query.type, action: query.action, format },
      { operatorId: operator.operatorId, sessionId: operator.sessionId },
    );
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
    );
    res.setHeader('Content-Disposition', `attachment; filename="audit-${day}.${format}"`);
    return body;
  }

  @Get('stats')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: StatsDto })
  stats(): Promise<StatsDto> {
    return this.tools.stats() as unknown as Promise<StatsDto>;
  }

  @Get('config')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: SystemConfigDto })
  config(): Promise<SystemConfigDto> {
    return this.tools.systemConfig();
  }

  @Put('config/limits/:key')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: ConfigLimitDto })
  setLimit(
    @CurrentOperator() operator: OperatorContext,
    @Param('key') key: string,
    @Body() body: LimitUpdateDto,
  ): Promise<ConfigLimitDto> {
    return this.tools.setLimit(key, body.value, by(operator, body));
  }

  /** Elenchi della configurazione (parole del filtro, soglie del controllo delle foto). */
  @Put('config/lists/:key')
  @OperatorRoles('admin')
  @HttpCode(204)
  async setList(
    @CurrentOperator() operator: OperatorContext,
    @Param('key') key: string,
    @Body() body: ConfigValueDto,
  ): Promise<void> {
    await this.tools.setConfig(key, body.value, by(operator, body));
  }

  /** Voce di una tassonomia a tema attiva o spenta (D130), con motivazione e audit. */
  @Put('config/taxonomies/:taxonomy/:key')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: TaxonomyItemDto })
  setTaxonomyItem(
    @CurrentOperator() operator: OperatorContext,
    @Param('taxonomy') taxonomy: string,
    @Param('key') key: string,
    @Body() body: TaxonomyItemUpdateDto,
  ): Promise<TaxonomyItemDto> {
    return this.tools.setTaxonomyItem(taxonomy, key, body.active, by(operator, body));
  }

  /** Città per i moduli del backoffice (offsite). */
  @Get('config/cities')
  @OperatorRoles('admin', 'moderator', 'support')
  @ApiOkResponse({ type: CityDto, isArray: true })
  cities(): Promise<CityDto[]> {
    return this.tools.cities();
  }

  @Get('operators')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OperatorDto, isArray: true })
  operators(): Promise<OperatorDto[]> {
    return this.tools.operators();
  }

  @Post('operators')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OperatorCreatedDto })
  async createOperator(
    @CurrentOperator() operator: OperatorContext,
    @Body() body: NewOperatorDto,
  ): Promise<OperatorCreatedDto> {
    return this.tools.createOperator(
      { email: body.email, name: body.name, roles: body.roles },
      by(operator, body),
    );
  }

  @Patch('operators/:id')
  @OperatorRoles('admin')
  @HttpCode(204)
  async updateOperator(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OperatorUpdateDto,
  ): Promise<void> {
    await this.tools.updateOperator(
      id,
      { roles: body.roles, status: body.status },
      by(operator, body),
    );
  }

  @Get('store-review')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: StoreReviewDto })
  storeReviewOverview(): Promise<StoreReviewDto> {
    return this.storeReview.overview();
  }

  /** Nuova finestra con la motivazione (D42, D244): il codice si mostra una sola volta. */
  @Post('store-review/windows')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: ReviewWindowOpenedDto })
  async openWindow(
    @CurrentOperator() operator: OperatorContext,
    @Body() body: ReviewWindowInputDto,
  ): Promise<ReviewWindowOpenedDto> {
    return this.storeReview.open(body.store, body.days, by(operator, body));
  }

  /** Chiusura: codice non più valido, sessioni dimostrative revocate, dati azzerati (D42). */
  @Post('store-review/windows/:id/close')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: ReviewWindowDto })
  async closeWindow(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<ReviewWindowDto> {
    const closed = await this.storeReview.close(by(operator, body), id);
    if (!closed) throw ApiError.notFound();
    return closed;
  }

  /** Azzeramento dei dati dimostrativi con la motivazione (D42, RC-89, D244). */
  @Post('store-review/windows/:id/reset')
  @OperatorRoles('admin')
  @HttpCode(200)
  @ApiOkResponse({ type: RowsDto })
  async reset(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() body: ExplanationDto,
  ): Promise<RowsDto> {
    return { rows: await this.storeReview.reset(by(operator, body)) };
  }
}
