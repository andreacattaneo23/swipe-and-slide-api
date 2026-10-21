import { Injectable } from '@nestjs/common';
import { SafetySettings } from './safety-settings.service';

/** Sostituzioni comuni di lettere con cifre o simboli. */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Testo normalizzato per il confronto: minuscolo, senza accenti, lettere ripetute ridotte. */
export function normalizeForFilter(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$]/g, (char) => LEET[char] ?? char)
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filtro delle parole offensive (D73) su bio, risposte alle domande a tema e nome: elenco in
 * `config` (`word_filter.words`), gestito dal backoffice; confronto per parole intere dopo la
 * normalizzazione, per evitare falsi positivi dentro parole innocue. Nessun filtro sulla chat.
 * Usato dai moduli che salvano quei testi: con una corrispondenza la risposta è `422` neutra.
 */
@Injectable()
export class WordFilterService {
  constructor(private readonly settings: SafetySettings) {}

  async isAllowed(text: string | null | undefined): Promise<boolean> {
    if (!text) return true;
    return (
      matches(normalizeForFilter(text), await this.settings.list('word_filter.words')) === false
    );
  }
}

/** Vero se il testo normalizzato contiene una delle espressioni come parole intere. */
export function matches(normalized: string, words: string[]): boolean {
  const padded = ` ${normalized} `;
  return words
    .map((word) => normalizeForFilter(word))
    .filter((word) => word.length > 0)
    .some((word) => padded.includes(` ${word} `));
}
