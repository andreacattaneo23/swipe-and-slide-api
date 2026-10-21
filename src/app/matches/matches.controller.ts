import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { MatchProfileDto } from '../profile/profile.dto';
import { PeopleService } from '../feed-chat/people.service';
import { MatchDto, MatchListDto, MatchListQueryDto } from './matches.dto';
import { MatchesService } from './matches.service';

/** Scheda Match (D123): elenco, dettaglio, profilo dal match, chiusura. Regola `match`. */
@ApiTags('matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly people: PeopleService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Solo i propri match; ogni elemento descrive l'altra persona solo se il match è attivo. */
  @Get()
  @Scopes('full')
  @ApiOkResponse({ type: MatchListDto })
  list(@CurrentUser() me: AuthContext, @Query() query: MatchListQueryDto): Promise<MatchListDto> {
    return this.matches.list(me.userId, query.cursor, query.limit);
  }

  @Get(':id')
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiOkResponse({ type: MatchDto })
  get(@CurrentUser() me: AuthContext, @Param('id') id: string): Promise<MatchDto> {
    return this.matches.get(me.userId, id);
  }

  /** Deck dal match (D104, D107): profilo e scritture con entrambi gli account visibili. */
  @Get(':id/profile')
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id' })
  @ApiOkResponse({ type: MatchProfileDto })
  async profile(@CurrentUser() me: AuthContext, @Param('id') id: string): Promise<MatchProfileDto> {
    const other = await this.db.execute<{ other: string }>(sql`
      select case when user_a_id = ${me.userId}::uuid then user_b_id else user_a_id end as other
        from matches where id = ${id}::uuid`);
    const deck = other.rows[0] ? await this.people.matchDeck(me.userId, other.rows[0].other) : null;
    if (!deck) throw ApiError.notFound();
    return deck;
  }

  @Post(':id/close')
  @HttpCode(204)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiNoContentResponse()
  close(@CurrentUser() me: AuthContext, @Param('id') id: string): Promise<void> {
    return this.matches.close(me.userId, id);
  }

  /** Match visto: "Deal Closed!" non si ripete e il punto della scheda si spegne [Proposta]. */
  @Post(':id/seen')
  @HttpCode(204)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiNoContentResponse()
  seen(@CurrentUser() me: AuthContext, @Param('id') id: string): Promise<void> {
    return this.matches.markSeen(me.userId, id);
  }
}
