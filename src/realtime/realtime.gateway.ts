import { type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { type WebSocket } from 'ws';
import { verifyAccessToken } from '../core/auth/access-token-verifier';
import { type RealtimeEnvelope } from '../core/realtime/events';
import { APP_CONFIG, type AppConfig } from '../infra/config/config';
import { ChannelState } from '../infra/realtime-bus/channel-state';
import { RealtimeBus } from '../infra/realtime-bus/realtime-bus';
import { FEED_CHAT_CONFIG, type FeedChatConfig } from '../infra/feed-chat/feed-chat.config';

/**
 * Codici di chiusura del canale. `4001`: token scaduto, non valido o sessione revocata; l'app
 * rinnova il token e si riconnette (protocollo dell'app, `socketChannel.ts`).
 */
export const CLOSE = {
  unauthorized: 4001,
  forbidden: 4403,
  sessionEnded: 4000,
  tooManyMessages: 4429,
} as const;

const AUTH_TIMEOUT_MS = 5_000;
/** Battito sotto i 30 secondi, anche per il proxy di Cloudflare (D241). */
const HEARTBEAT_MS = 25_000;
const MAX_CLIENT_MESSAGES = 20; // per finestra di 10 secondi

interface Channel {
  key: string;
  socket: WebSocket;
  userId: string;
  sessionId: string;
  expiry: NodeJS.Timeout;
  alive: boolean;
}

/**
 * Gateway WebSocket del servizio `realtime` (D180, D182, D190, D230, D231): canale personale di un
 * utente autenticato con il token di accesso (sessioni `full` e `approval`), consegna degli eventi
 * arrivati da Redis, chiusura alla scadenza del token, alla revoca della sessione e con l'evento
 * `session`. Non legge il database e non decide nulla: i destinatari li ha già decisi il backend
 * con la regola core. Nessun evento di presenza o di digitazione verso gli utenti (D63).
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Realtime');
  private readonly channels = new Map<string, Map<string, Channel>>();
  private readonly pending = new Map<WebSocket, Channel | null>();
  private unsubscribe: (() => void) | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FEED_CHAT_CONFIG) private readonly feedChat: FeedChatConfig,
    private readonly bus: RealtimeBus,
    private readonly state: ChannelState,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.bus.subscribe((envelope) => this.deliver(envelope));
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const byKey of this.channels.values()) {
      for (const channel of byKey.values()) await this.drop(channel, 1001);
    }
  }

  /**
   * Token nell'intestazione `Authorization`, oppure nel primo messaggio, in una delle due forme:
   * `{"type":"auth","token":…}` o, come il gateway di NestJS e l'app, `{"event":"auth","data":
   * {"token":…}}`. Il server risponde `{"type":"ready"}`.
   */
  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    this.pending.set(socket, null);
    let counter = 0;
    const window = setInterval(() => (counter = 0), 10_000);
    window.unref();
    socket.on('close', () => clearInterval(window));
    socket.on('message', (raw) => {
      counter += 1;
      if (counter > MAX_CLIENT_MESSAGES) {
        socket.close(CLOSE.tooManyMessages);
        return;
      }
      let message: { type?: unknown; event?: unknown; token?: unknown; data?: unknown };
      try {
        message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : '') as typeof message;
      } catch {
        return;
      }
      const type = message.type ?? message.event;
      const data =
        typeof message.data === 'object' && message.data !== null
          ? (message.data as { token?: unknown })
          : message;
      if (type === 'auth' && typeof data.token === 'string' && this.pending.get(socket) === null) {
        void this.authenticate(socket, data.token);
      } else if (type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
    });
    socket.on('pong', () => {
      const channel = this.pending.get(socket);
      if (channel) channel.alive = true;
    });
    const header = request.headers.authorization ?? '';
    if (header.startsWith('Bearer ')) {
      void this.authenticate(socket, header.slice(7));
      return;
    }
    setTimeout(() => {
      if (this.pending.get(socket) === null && socket.readyState === socket.OPEN) {
        socket.close(CLOSE.unauthorized);
      }
    }, AUTH_TIMEOUT_MS).unref();
  }

  async handleDisconnect(socket: WebSocket): Promise<void> {
    const channel = this.pending.get(socket);
    this.pending.delete(socket);
    if (channel) await this.forget(channel);
  }

  private async authenticate(socket: WebSocket, token: string): Promise<void> {
    const claims = await verifyAccessToken(token, this.config.jwtAccessSigningKey);
    if (!claims || claims.expiresAt <= Date.now()) {
      socket.close(CLOSE.unauthorized);
      return;
    }
    if (claims.scope !== 'full' && claims.scope !== 'approval') {
      socket.close(CLOSE.forbidden);
      return;
    }
    // Sessione revocata nella cache L2; con la cache non raggiungibile si rifiuta (D233)
    if (await this.state.isSessionRevoked(claims.sessionId)) {
      socket.close(CLOSE.unauthorized);
      return;
    }
    if (socket.readyState !== socket.OPEN) return;
    const channel: Channel = {
      key: `${this.feedChat.instanceId}:${randomUUID()}`,
      socket,
      userId: claims.userId,
      sessionId: claims.sessionId,
      alive: true,
      // Alla scadenza del token il canale si chiude e l'app si riconnette dopo il rinnovo
      expiry: setTimeout(
        () => void this.drop(channel, CLOSE.unauthorized),
        claims.expiresAt - Date.now(),
      ),
    };
    channel.expiry.unref();
    this.pending.set(socket, channel);
    const byKey = this.channels.get(channel.userId) ?? new Map<string, Channel>();
    byKey.set(channel.key, channel);
    this.channels.set(channel.userId, byKey);
    await this.state.addPresence(channel.userId, channel.key);
    socket.send(JSON.stringify({ type: 'ready' }));
  }

  private deliver(envelope: RealtimeEnvelope): void {
    const byKey = this.channels.get(envelope.userId);
    if (!byKey) return;
    const event = envelope.event;
    for (const channel of byKey.values()) {
      if (event.type === 'session') {
        if (!event.sessionId || event.sessionId === channel.sessionId) {
          channel.socket.send(JSON.stringify({ type: 'session' }));
          void this.drop(channel, CLOSE.sessionEnded);
        }
        continue;
      }
      if (channel.socket.readyState === channel.socket.OPEN) {
        channel.socket.send(JSON.stringify(event));
      }
    }
  }

  /** Battito: chiude i canali che non rispondono e rinnova la presenza degli altri. */
  private async beat(): Promise<void> {
    const alive: { userId: string; channelKey: string }[] = [];
    for (const byKey of this.channels.values()) {
      for (const channel of byKey.values()) {
        if (!channel.alive) {
          channel.socket.terminate();
          await this.forget(channel);
          continue;
        }
        channel.alive = false;
        channel.socket.ping();
        // Ping applicativo ogni 25 secondi: tiene viva la connessione attraverso Cloudflare (D241)
        if (channel.socket.readyState === channel.socket.OPEN) {
          channel.socket.send(JSON.stringify({ type: 'ping' }));
        }
        alive.push({ userId: channel.userId, channelKey: channel.key });
      }
    }
    await this.state.refreshPresence(alive);
  }

  private async drop(channel: Channel, code: number): Promise<void> {
    if (channel.socket.readyState === channel.socket.OPEN) channel.socket.close(code);
    await this.forget(channel);
  }

  private async forget(channel: Channel): Promise<void> {
    clearTimeout(channel.expiry);
    const byKey = this.channels.get(channel.userId);
    if (byKey?.delete(channel.key)) {
      if (byKey.size === 0) this.channels.delete(channel.userId);
      await this.state.removePresence(channel.userId, channel.key);
    }
  }

  /** Numero di canali aperti nell'istanza, solo per la salute e i test. */
  openChannels(): number {
    let count = 0;
    for (const byKey of this.channels.values()) count += byKey.size;
    return count;
  }
}
