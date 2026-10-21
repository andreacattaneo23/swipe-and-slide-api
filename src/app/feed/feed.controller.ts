import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { FeedDto, FeedQueryDto } from './feed.dto';
import { FeedService } from './feed.service';

/** Feed (D31, D52): solo persone con `can_interact`, applicata nella query a ogni candidato. */
@ApiTags('feed')
@ApiBearerAuth()
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  @Scopes('full')
  @ExposesUser({ rule: 'interact', perItem: true })
  @ApiOkResponse({ type: FeedDto })
  get(@CurrentUser() me: AuthContext, @Query() query: FeedQueryDto): Promise<FeedDto> {
    return this.feed.feed(me.userId, { tripsOnly: query.filter === 'trips' });
  }
}
