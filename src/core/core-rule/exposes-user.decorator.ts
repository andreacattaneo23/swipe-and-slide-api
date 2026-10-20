import { SetMetadata } from '@nestjs/common';

/**
 * Regola di una rotta che espone o coinvolge un altro utente (architettura, "Le funzioni della
 * regola"): `interact` per feed, offsite, profilo dal feed e swipe; `match` per profilo dal match,
 * chat, inviti e Agenda. Il test di copertura delle rotte (RC-26, RC-116) verifica che ogni rotta
 * di quei percorsi la dichiari.
 */
export type RouteRule = 'interact' | 'match';

export type ExposesUserOptions =
  { rule: 'interact'; param?: string; body?: string } | { rule: 'match'; match: string };

export const EXPOSES_USER = 'exposesUser';

export const ExposesUser = (options: ExposesUserOptions) => SetMetadata(EXPOSES_USER, options);
