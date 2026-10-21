import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { NotificationsService } from '../../domain/notifications/notifications.service';
import { DeviceDto, NotificationPreferencesDto, TabsDto } from './notifications.dto';

const INSTALLATION = /^[A-Za-z0-9_-]{8,100}$/;

/** Preferenze delle notifiche, token push e punti delle schede: solo dati propri. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('me/notifications/preferences')
  @Scopes('full', 'approval')
  @ApiOkResponse({ type: NotificationPreferencesDto })
  async preferences(@CurrentUser() me: AuthContext): Promise<NotificationPreferencesDto> {
    return this.notifications.preferences(me.userId);
  }

  @Put('me/notifications/preferences')
  @Scopes('full', 'approval')
  @ApiOkResponse({ type: NotificationPreferencesDto })
  async update(
    @CurrentUser() me: AuthContext,
    @Body() body: NotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const disabled = [...new Set(body.disabledTypes)];
    const quiet = body.quietHours.map(({ start, end }) => ({ start, end }));
    await this.db.execute(sql`
      insert into notification_preferences (user_id, disabled_types, previews, quiet_hours, updated_at)
      values (${me.userId}::uuid, ${`{${disabled.join(',')}}`}::text[], ${body.previews},
              ${JSON.stringify(quiet)}::jsonb, now())
      on conflict (user_id) do update
         set disabled_types = excluded.disabled_types, previews = excluded.previews,
             quiet_hours = excluded.quiet_hours, updated_at = now()`);
    return this.notifications.preferences(me.userId);
  }

  /** Registra o aggiorna il token push di un'installazione dell'app. */
  @Put('me/devices/:installationId')
  @HttpCode(204)
  @Scopes('full', 'approval')
  @ApiNoContentResponse()
  async device(
    @CurrentUser() me: AuthContext,
    @Param('installationId') installationId: string,
    @Body() body: DeviceDto,
  ): Promise<void> {
    if (!INSTALLATION.test(installationId))
      throw ApiError.badRequest('validation', { fields: ['installationId'] });
    await this.db.transaction(async (tx) => {
      // Un token appartiene a un solo account: se il telefono cambia account, passa al nuovo
      await tx.execute(sql`delete from devices where push_token = ${body.pushToken}
                             and not (user_id = ${me.userId}::uuid and installation_id = ${installationId})`);
      await tx.execute(sql`
        insert into devices (user_id, installation_id, push_token, platform)
        values (${me.userId}::uuid, ${installationId}, ${body.pushToken}, ${body.platform})
        on conflict (user_id, installation_id) do update
           set push_token = excluded.push_token, platform = excluded.platform, updated_at = now()`);
    });
  }

  @Delete('me/devices/:installationId')
  @HttpCode(204)
  @Scopes('full', 'approval', 'limited')
  @ApiNoContentResponse()
  async removeDevice(
    @CurrentUser() me: AuthContext,
    @Param('installationId') installationId: string,
  ): Promise<void> {
    await this.db.execute(sql`delete from devices where user_id = ${me.userId}::uuid
                                and installation_id = ${installationId}`);
  }

  /** Punti e numeri delle proprie schede (evento `tabs`): mai dati di altre persone. */
  @Get('tabs')
  @Scopes('full')
  @ApiOkResponse({ type: TabsDto })
  async tabs(@CurrentUser() me: AuthContext): Promise<TabsDto> {
    const result = await this.db.execute<{
      unread: number;
      new_matches: boolean;
      agenda: boolean;
    }>(sql`
      with mine as (
        select m.* from matches m
         where m.status = 'active' and ${me.userId}::uuid in (m.user_a_id, m.user_b_id)
           and account_visible(m.user_a_id) and account_visible(m.user_b_id))
      select (select count(*)::int from messages x join mine on mine.id = x.match_id
               where x.sender_id <> ${me.userId}::uuid and x.read_at is null) as unread,
             exists (select 1 from mine where (case when user_a_id = ${me.userId}::uuid
                                                    then user_a_seen_at else user_b_seen_at end) is null) as new_matches,
             exists (select 1 from invites i join mine on mine.id = i.match_id
                      where i.status = 'pending' and i.proposed_by <> ${me.userId}::uuid
                        and i.seen_at is null) as agenda`);
    const row = result.rows[0]!;
    return {
      unreadMessages: Number(row.unread),
      newMatches: row.new_matches,
      agendaDot: row.agenda,
    };
  }
}
