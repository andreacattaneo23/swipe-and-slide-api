import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import {
  MessagesDto,
  MessagesQueryDto,
  ReadBodyDto,
  SendMessageDto,
  SentMessageDto,
} from './chat.dto';
import { ChatService } from './chat.service';

/** Messaggi e conferme di lettura (D63): regola `match`, invio anche con `can_write` e trigger. */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('matches/:id')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Lettura consentita anche nella conversazione sospesa (D82). */
  @Get('messages')
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiOkResponse({ type: MessagesDto })
  list(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Query() query: MessagesQueryDto,
  ): Promise<MessagesDto> {
    return this.chat.list(me.userId, id, query);
  }

  /** Nella conversazione sospesa risponde `409` con `match.frozen`, uguale per ogni causa. */
  @Post('messages')
  @HttpCode(200)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiOkResponse({ type: SentMessageDto })
  send(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ): Promise<SentMessageDto> {
    return this.chat.send(me.userId, id, body.text, body.clientMessageId);
  }

  @Post('reads')
  @HttpCode(204)
  @Scopes('full')
  @ExposesUser({ rule: 'match', match: 'id', paused: true })
  @ApiNoContentResponse()
  read(
    @CurrentUser() me: AuthContext,
    @Param('id') id: string,
    @Body() body: ReadBodyDto,
  ): Promise<void> {
    return this.chat.markRead(me.userId, id, body.messageId);
  }
}
