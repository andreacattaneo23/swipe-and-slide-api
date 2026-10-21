import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { InviteDto, InviteFieldsDto, InviteResponseDto, SuggestionDto } from './invites.dto';
import { InvitesService } from './invites.service';

/** "Proponi un meeting" dalla chat (D64, D146, D147): regola `match`, `can_write` e trigger. */
@ApiTags('invites')
@ApiBearerAuth()
@Controller('matches/:id/invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiOkResponse({ type: InviteDto, isArray: true })
  list(@CurrentUser() me: AuthContext, @Param('id') id: string): Promise<InviteDto[]> {
    return this.invites.list(me.userId, id);
  }

  /** Con una proposta già in sospeso `409` con `chat.meeting.pending` (D147). */
  @Post()
  @HttpCode(200)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiOkResponse({ type: InviteDto })
  create(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Body() body: InviteFieldsDto,
  ): Promise<InviteDto> {
    return this.invites.create(me.userId, id, body);
  }

  @Get('suggestions')
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id' })
  @ApiOkResponse({ type: SuggestionDto, isArray: true })
  suggestions(@CurrentUser() me: AuthContext, @Param('id') id: string): Promise<SuggestionDto[]> {
    return this.invites.suggestions(me.userId, id);
  }

  @Post(':inviteId/response')
  @HttpCode(200)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiOkResponse({ type: InviteDto })
  respond(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
    @Body() body: InviteResponseDto,
  ): Promise<InviteDto> {
    return this.invites.respond(me.userId, id, inviteId, body.answer, body.proposal);
  }

  @Delete(':inviteId')
  @HttpCode(204)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiNoContentResponse()
  cancel(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ): Promise<void> {
    return this.invites.cancel(me.userId, id, inviteId);
  }
}
