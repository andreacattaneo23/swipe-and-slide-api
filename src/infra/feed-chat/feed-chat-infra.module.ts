import { Global, Module } from '@nestjs/common';
import { EnvKeyManagement, KeyManagement, OpenBaoKeyManagement } from '../kms/key-management';
import { ExpoPushSender, PushSender } from '../push/push-sender';
import { FEED_CHAT_CONFIG, type FeedChatConfig, feedChatConfigProvider } from './feed-chat.config';

/**
 * Servizi esterni di feed e chat (D239, D240, D241): custodia della chiave principale dei
 * messaggi (OpenBao in produzione, variabile d'ambiente in sviluppo) e notifiche con Expo Push.
 */
@Global()
@Module({
  providers: [
    feedChatConfigProvider,
    {
      provide: KeyManagement,
      inject: [FEED_CHAT_CONFIG],
      useFactory: (config: FeedChatConfig) => {
        if (config.keyCustody === 'openbao') {
          const { address, token, transitKey } = config.openbao;
          if (!address || !token || !transitKey) {
            throw new Error('OPENBAO_ADDR, OPENBAO_TOKEN e OPENBAO_TRANSIT_KEY obbligatorie');
          }
          return new OpenBaoKeyManagement(address, token, transitKey);
        }
        if (!config.masterKey) throw new Error('MESSAGE_MASTER_KEY mancante con KEY_CUSTODY=env');
        return new EnvKeyManagement(config.masterKey);
      },
    },
    {
      provide: PushSender,
      inject: [FEED_CHAT_CONFIG],
      useFactory: (config: FeedChatConfig) => new ExpoPushSender(config.expoAccessToken),
    },
  ],
  exports: [FEED_CHAT_CONFIG, KeyManagement, PushSender],
})
export class FeedChatInfraModule {}
