import { texts } from './it';
import { proposedTexts } from './proposed';

/**
 * Accesso ai testi del backoffice: solo da it.ts (copiato da testi.js) e dalle proposte in attesa
 * di approvazione (proposed.ts). Nessun testo visibile si scrive nei componenti.
 */
const allTexts = { ...proposedTexts, ...texts } as const;

export type TextKey = keyof typeof allTexts;
export type TextParams = Record<string, string | number>;

/** Restituisce il testo della chiave, con i valori tra parentesi graffe sostituiti. */
export function t(key: TextKey, params?: TextParams): string {
  const template: string = allTexts[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Come t(), ma sceglie la forma singolare `.one` quando count vale 1 e la chiave esiste. */
export function tCount(key: TextKey, count: number, params?: TextParams): string {
  const singular = `${key}.one`;
  const chosen = count === 1 && singular in allTexts ? (singular as TextKey) : key;
  return t(chosen, { count, ...params });
}

/** Vero se la chiave esiste (utile per le chiavi costruite, come i motivi del rifiuto). */
export function hasText(key: string): key is TextKey {
  return key in allTexts;
}
