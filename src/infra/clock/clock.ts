import { Injectable } from '@nestjs/common';

/**
 * Orologio del servizio: nei test si sostituisce per simulare il tempo (architettura, "Principi
 * della suite"). Le scadenze scritte nel database usano comunque `now()` del server.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
