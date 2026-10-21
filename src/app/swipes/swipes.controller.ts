import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { RollbackBodyDto, RollbackResultDto, SwipeBodyDto, SwipeResultDto } from './swipes.dto';
import { SwipesService } from './swipes.service';

/** Approvato, Fuori scope, Escalation e Rollback (D53): regola `interact` sulla persona. */
@ApiTags('swipes')
@ApiBearerAuth()
@Controller('swipes')
export class SwipesController {
  constructor(private readonly swipes: SwipesService) {}

  @Post()
  @HttpCode(200)
  @Scopes('full')
  @ExposesUser({ rule: 'interact', body: 'userId' })
  @ApiOkResponse({ type: SwipeResultDto })
  swipe(@CurrentUser() me: AuthContext, @Body() body: SwipeBodyDto): Promise<SwipeResultDto> {
    return this.swipes.swipe(me.userId, body.userId, body.type, body.offsiteId);
  }

  @Post('rollback')
  @HttpCode(200)
  @Scopes('full')
  @ExposesUser({ rule: 'interact', body: 'userId' })
  @ApiOkResponse({ type: RollbackResultDto })
  rollback(
    @CurrentUser() me: AuthContext,
    @Body() body: RollbackBodyDto,
  ): Promise<RollbackResultDto> {
    return this.swipes.rollback(me.userId, body.userId);
  }
}
