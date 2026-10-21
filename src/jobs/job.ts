import { type INestApplicationContext } from '@nestjs/common';

/** Un processo pianificato (architettura, "Processi pianificati"): idempotente, a lotti brevi. */
export interface Job {
  name: string;
  /** Restituisce solo conteggi, mai dati delle persone. */
  run(context: INestApplicationContext): Promise<Record<string, number>>;
}

/** Processo con la sua cadenza, per gli elenchi dei domini che non usano un servizio Nest. */
export interface JobDefinition extends Job {
  schedule: 'daily' | 'hourly';
}

/** Processo di un servizio Nest: le dipendenze arrivano dal costruttore. */
export interface SourceJob {
  name: string;
  run: () => Promise<number | Record<string, number>>;
}

/** Servizio Nest che fornisce i suoi processi giornalieri e orari. */
export interface JobSource {
  daily(): SourceJob[];
  hourly(): SourceJob[];
}
