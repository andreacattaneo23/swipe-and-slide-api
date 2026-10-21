import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Response } from 'express';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { BlocksService } from '../../domain/blocks/blocks.service';
import { ExcludedCompaniesService } from '../../domain/excluded-companies/excluded-companies.service';
import { OpenSpaceService } from '../../domain/open-space/open-space.service';
import { ApiError } from '../../infra/http/api-error';

export class OpenSpaceFiltersDto {
  @ApiProperty({ description: 'Proprie aziende escluse, anche in attesa (D157)' })
  excludedCompanies: number;

  @ApiProperty({ description: 'Persone bloccate dall’utente' })
  blockedPeople: number;
}

export class OpenSpaceStatusDto {
  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional({ nullable: true })
  since: Date | null;

  @ApiProperty({ description: 'Dopo un cambio di azienda: chiedere se riattivarlo' })
  prompt: boolean;

  @ApiProperty({ description: 'Attivazioni rimaste nei 30 giorni' })
  changesRemaining: number;

  @ApiProperty()
  maxChanges: number;

  @ApiPropertyOptional({ nullable: true, description: 'Solo oltre il limite' })
  changeableAt: Date | null;

  @ApiProperty({ type: OpenSpaceFiltersDto })
  filters: OpenSpaceFiltersDto;
}

export class OpenSpaceUpdateDto {
  @ApiProperty({ description: '"Attiva l\'open space" (vero) o "Spegni l\'open space" (falso)' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'Versione dei testi della schermata di conferma, obbligatoria per attivare',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  textVersion?: string;
}

export class CompanyRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Solo il nome (D35)' })
  name: string;
}

export class ExcludedCompanyDto extends CompanyRefDto {
  @ApiProperty({ description: 'Azienda lasciata al cambio di lavoro (D176)' })
  leftCompany: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Da quando si potrà togliere (7 giorni)' })
  removableFrom: Date | null;
}

export class PendingChangeDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: CompanyRefDto })
  company: CompanyRefDto;

  @ApiProperty({ enum: ['add', 'remove'] })
  operation: string;

  @ApiProperty({ description: '"Entro due giorni": data massima, mai quella esatta (D36)' })
  latestAt: Date;
}

export class ExcludedCompaniesDto {
  @ApiProperty({ type: ExcludedCompanyDto, isArray: true })
  companies: ExcludedCompanyDto[];

  @ApiProperty({ type: PendingChangeDto, isArray: true })
  pending: PendingChangeDto[];

  @ApiProperty({ description: 'Aziende escluse più aggiunte in attesa' })
  count: number;

  @ApiProperty({ description: 'Massimo (15, D186)' })
  max: number;

  @ApiProperty({ description: 'Modifiche rimaste nei 30 giorni (5, D39)' })
  changesRemaining: number;

  @ApiPropertyOptional({ nullable: true })
  changeableAt: Date | null;

  @ApiProperty({ description: 'In approvazione le modifiche valgono subito (D166)' })
  immediate: boolean;
}

export class ChangeResultDto {
  @ApiProperty({
    enum: ['applied', 'pending', 'cancelled', 'unchanged'],
    description: '`pending`: vale entro due giorni; `cancelled`: annullata la modifica opposta',
  })
  status: string;

  @ApiPropertyOptional({ nullable: true })
  latestAt: Date | null;
}

export class BlockDto {
  @ApiProperty({ description: 'Persona del feed o di un match' })
  @IsUUID()
  userId: string;
}

export class BlockedPersonDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional({ nullable: true, description: 'Foto principale, URL firmato' })
  photoUrl: string | null;
}

/**
 * Impostazioni e privacy (D70, D80, D137–D140, D157, D175): Open space, aziende escluse con le
 * modifiche in attesa, persone bloccate. Tutto riguarda solo l'utente stesso: nessuna risposta contiene dati di altre persone, tranne "Persone bloccate" (D70).
 */
@ApiTags('privacy')
@ApiBearerAuth()
@Controller()
export class PrivacyController {
  constructor(
    private readonly openSpace: OpenSpaceService,
    private readonly excluded: ExcludedCompaniesService,
    private readonly blocks: BlocksService,
  ) {}

  @Get('me/open-space')
  @Scopes('approval', 'full', 'restore', 'limited')
  @ApiOkResponse({ type: OpenSpaceStatusDto })
  openSpaceStatus(@CurrentUser() me: AuthContext): Promise<OpenSpaceStatusDto> {
    return this.openSpace.status(me.userId);
  }

  /**
   * Attivazione dopo la conferma (solo `approval` e `full`) o spegnimento, sempre ammesso, anche
   * oltre il limite e da `restore` e `limited` (D197).
   */
  @Put('me/open-space')
  @Scopes('approval', 'full', 'restore', 'limited')
  @ApiOkResponse({ type: OpenSpaceStatusDto })
  setOpenSpace(
    @CurrentUser() me: AuthContext,
    @Body() body: OpenSpaceUpdateDto,
  ): Promise<OpenSpaceStatusDto> {
    if (body.enabled && !['approval', 'full'].includes(me.scope)) throw ApiError.forbidden();
    return this.openSpace.set(me.userId, body.enabled, body.textVersion ?? null);
  }

  @Get('settings/excluded-companies')
  @Scopes('approval', 'full')
  @ApiOkResponse({ type: ExcludedCompaniesDto })
  excludedCompanies(@CurrentUser() me: AuthContext): Promise<ExcludedCompaniesDto> {
    return this.excluded.list(me.userId);
  }

  /** Aggiunta: `202` in attesa (entro due giorni), `200` subito in approvazione (D166). */
  @Put('settings/excluded-companies/:companyId')
  @Scopes('approval', 'full')
  @ApiOkResponse({ type: ChangeResultDto })
  @ApiAcceptedResponse({ type: ChangeResultDto })
  async addExcluded(
    @CurrentUser() me: AuthContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChangeResultDto> {
    const result = await this.excluded.add(me.userId, companyId);
    res.status(result.status === 'pending' ? 202 : 200);
    return result;
  }

  @Delete('settings/excluded-companies/:companyId')
  @Scopes('approval', 'full')
  @ApiOkResponse({ type: ChangeResultDto })
  @ApiAcceptedResponse({ type: ChangeResultDto })
  async removeExcluded(
    @CurrentUser() me: AuthContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChangeResultDto> {
    const result = await this.excluded.remove(me.userId, companyId);
    res.status(result.status === 'pending' ? 202 : 200);
    return result;
  }

  /** Annulla una modifica in attesa: nessun effetto, non conta per il limite (D39). */
  @Delete('settings/excluded-company-changes/:id')
  @Scopes('approval', 'full')
  @HttpCode(204)
  @ApiNoContentResponse()
  async cancelChange(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.excluded.cancel(me.userId, id);
  }

  /** Blocco immediato e silenzioso nei due sensi (D70): `404` neutro per chi non è raggiungibile. */
  @Post('blocks')
  @Scopes('full')
  @HttpCode(204)
  @ApiNoContentResponse()
  async block(@CurrentUser() me: AuthContext, @Body() body: BlockDto): Promise<void> {
    await this.blocks.block(me.userId, body.userId);
  }

  /** "Persone bloccate": eccezione esplicita del test di copertura delle rotte. */
  @Get('blocks')
  @Scopes('full', 'approval', 'restore', 'limited')
  @ApiOkResponse({ type: BlockedPersonDto, isArray: true })
  blocked(@CurrentUser() me: AuthContext): Promise<BlockedPersonDto[]> {
    return this.blocks.list(me.userId);
  }

  @Delete('blocks/:userId')
  @Scopes('full', 'approval', 'restore', 'limited')
  @HttpCode(204)
  @ApiNoContentResponse()
  async unblock(
    @CurrentUser() me: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.blocks.unblock(me.userId, userId);
  }
}
