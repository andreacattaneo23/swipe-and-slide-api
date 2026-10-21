import { AgendaController } from '../agenda/agenda.controller';
import { AgendaService } from '../agenda/agenda.service';
import { ChatController } from '../chat/chat.controller';
import { ChatService } from '../chat/chat.service';
import { FeedController } from '../feed/feed.controller';
import { FeedBatchCache } from '../feed/feed-cache';
import { FeedService } from '../feed/feed.service';
import { InvitesController } from '../invites/invites.controller';
import { InvitesService } from '../invites/invites.service';
import { MatchesController } from '../matches/matches.controller';
import { MatchesService } from '../matches/matches.service';
import { NotificationsController } from '../notifications/notifications.controller';
import { AppOffsitesController } from '../offsites/offsites.controller';
import { AppOffsitesService } from '../offsites/offsites.service';
import { SwipesController } from '../swipes/swipes.controller';
import { SwipesService } from '../swipes/swipes.service';
import { PeopleService } from './people.service';

/**
 * Feed, swipe, match, chat, inviti, Agenda, offsite e notifiche dell'app (team B2, D239). Le
 * liste entrano nel modulo radice di `app-api`, così il test di copertura delle rotte (RC-26,
 * RC-116) le controlla insieme alle altre.
 */
export const FEED_CHAT_CONTROLLERS = [
  FeedController,
  SwipesController,
  MatchesController,
  ChatController,
  InvitesController,
  AgendaController,
  AppOffsitesController,
  NotificationsController,
];

export const FEED_CHAT_PROVIDERS = [
  PeopleService,
  FeedBatchCache,
  FeedService,
  SwipesService,
  MatchesService,
  ChatService,
  InvitesService,
  AgendaService,
  AppOffsitesService,
];
