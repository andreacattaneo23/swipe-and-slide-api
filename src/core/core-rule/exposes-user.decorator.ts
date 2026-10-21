import { SetMetadata } from '@nestjs/common';

/**
 * Regola di una rotta che espone o coinvolge un altro utente (architettura, "Le funzioni della
 * regola"): `interact` per feed, offsite, profilo dal feed e swipe; `match` per profilo dal match,
 * chat, inviti e Agenda. Il test di copertura delle rotte (RC-26, RC-116) verifica che ogni rotta
 * di quei percorsi la dichiari.
 */
export type RouteRule = 'interact' | 'match';

export type ExposesUserOptions =
  | { rule: 'interact'; param?: string; body?: string }
  | {
      rule: 'match';
      /** Parametro del percorso o campo del corpo con l'identificativo del match. */
      match?: string;
      body?: string;
      /**
       * Lettura anche nella conversazione momentaneamente sospesa (D82): basta partecipare a un
       * match attivo; profilo e scritture richiedono anche gli account visibili (architettura).
       */
      paused?: boolean;
    }
  /**
   * Elenchi (feed, swipe dell'offsite, Agenda): la regola si applica a ogni elemento nella query,
   * nel database; la guard non ha un identificativo da controllare.
   */
  | { rule: 'interact' | 'match'; perItem: true };

export const EXPOSES_USER = 'exposesUser';

export const ExposesUser = (options: ExposesUserOptions) => SetMetadata(EXPOSES_USER, options);
