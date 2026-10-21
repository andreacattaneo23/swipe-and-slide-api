import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { FeedDto } from '../feed/feed.dto';
import { AttendancePatchDto, OffsiteDetailDto, OffsiteSummaryDto } from './offsites.dto';
import { AppOffsitesService } from './offsites.service';

/** Offsite (D150–D154): eventi pubblici; dei partecipanti solo il numero arrotondato (D167). */
@ApiTags('offsites')
@ApiBearerAuth()
@Controller('offsites')
export class AppOffsitesController {
  constructor(private readonly offsites: AppOffsitesService) {}

  @Get()
  @Scopes('full')
  @ApiOkResponse({ type: OffsiteSummaryDto, isArray: true })
  list(@CurrentUser() me: AuthContext): Promise<OffsiteSummaryDto[]> {
    return this.offsites.list(me.userId);
  }

  @Get(':id')
  @Scopes('full')
  @ApiOkResponse({ type: OffsiteDetailDto })
  get(
    @CurrentUser() me: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<OffsiteDetailDto> {
    return this.offsites.get(me.userId, id);
  }

  @Put(':id/attendance')
  @Scopes('full')
  @ApiOkResponse({ type: OffsiteDetailDto })
  attend(
    @CurrentUser() me: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<OffsiteDetailDto> {
    return this.offsites.attend(me.userId, id);
  }

  @Patch(':id/attendance')
  @Scopes('full')
  @ApiOkResponse({ type: OffsiteDetailDto })
  patch(
    @CurrentUser() me: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AttendancePatchDto,
  ): Promise<OffsiteDetailDto> {
    return this.offsites.patch(me.userId, id, body.showOnProfile);
  }

  @Delete(':id/attendance')
  @HttpCode(204)
  @Scopes('full')
  @ApiNoContentResponse()
  leave(
    @CurrentUser() me: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.offsites.leave(me.userId, id);
  }

  /** Swipe tra gli iscritti (D152): `can_interact` e filtri del feed a ogni candidato. */
  @Get(':id/feed')
  @Scopes('full')
  @ExposesUser({ rule: 'interact', perItem: true })
  @ApiOkResponse({ type: FeedDto })
  feed(
    @CurrentUser() me: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FeedDto> {
    return this.offsites.feedFor(me.userId, id);
  }
}
