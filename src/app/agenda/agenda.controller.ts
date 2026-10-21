import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { InviteDto, NewMeetingDto } from '../invites/invites.dto';
import { InvitesService } from '../invites/invites.service';
import {
  AgendaDto,
  AgendaPeopleItemDto,
  AgendaQueryDto,
  UpcomingDto,
  UpcomingQueryDto,
} from './agenda.dto';
import { AgendaService } from './agenda.service';

/** Scheda Agenda (D145): regola `match` per ogni meeting, applicata nella query. */
@ApiTags('agenda')
@ApiBearerAuth()
@Controller('agenda')
export class AgendaController {
  constructor(
    private readonly agenda: AgendaService,
    private readonly invites: InvitesService,
  ) {}

  @Get()
  @Scopes('full')
  @ExposesUser({ rule: 'match', perItem: true })
  @ApiOkResponse({ type: AgendaDto })
  range(@CurrentUser() me: AuthContext, @Query() query: AgendaQueryDto): Promise<AgendaDto> {
    return this.agenda.range(me.userId, query.from, query.to);
  }

  @Get('upcoming')
  @Scopes('full')
  @ExposesUser({ rule: 'match', perItem: true })
  @ApiOkResponse({ type: UpcomingDto })
  upcoming(@CurrentUser() me: AuthContext, @Query() query: UpcomingQueryDto): Promise<UpcomingDto> {
    return this.agenda.upcoming(me.userId, query.cursor, query.limit);
  }

  @Get('people')
  @Scopes('full')
  @ExposesUser({ rule: 'match', perItem: true })
  @ApiOkResponse({ type: AgendaPeopleItemDto, isArray: true })
  people(@CurrentUser() me: AuthContext): Promise<AgendaPeopleItemDto[]> {
    return this.agenda.invitable(me.userId);
  }

  /** Nuovo meeting: come l'invito dalla chat, più lo scambio di messaggi dei due (D148). */
  @Post('meetings')
  @HttpCode(200)
  @Scopes('full')
  @ExposesUser({ rule: 'match', body: 'matchId' })
  @ApiOkResponse({ type: InviteDto })
  create(@CurrentUser() me: AuthContext, @Body() body: NewMeetingDto): Promise<InviteDto> {
    const { matchId, ...fields } = body;
    return this.invites.create(me.userId, matchId, fields, { requireExchange: true });
  }
}
