import { Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';

/**
 * Esito del controllo automatico (D73): `passed` lascia la foto alla revisione del team
 * (`pending_approval`, D141, D143); `manual` quando il controllo automatico non è disponibile,
 * con lo stesso effetto; `review` la manda alla coda di moderazione; `rejected` la respinge.
 * Nessun esito approva una foto: la approva sempre una persona del team.
 */
export type PhotoCheckResult =
  | { outcome: 'passed' | 'manual' }
  | { outcome: 'rejected' | 'review'; reason: 'explicit_content' | 'violence' };

/**
 * Controllo automatico delle foto al caricamento: solo SafeSearch di Google Cloud Vision nella
 * regione UE, mai funzioni sul volto (D110). Riceve l'immagine già ricodificata e senza metadati.
 */
export interface PhotoChecker {
  check(image: Buffer): Promise<PhotoCheckResult>;
}

export const PHOTO_CHECKER = Symbol('PHOTO_CHECKER');

/**
 * Senza credenziali di Vision (D240): nessun controllo automatico, quindi nessuna decisione
 * automatica; la foto va soltanto alla revisione manuale del team.
 */
export class ManualReviewPhotoChecker implements PhotoChecker {
  check(_image: Buffer): Promise<PhotoCheckResult> {
    return Promise.resolve({ outcome: 'manual' });
  }
}

const LIKELY = new Set(['LIKELY', 'VERY_LIKELY']);
const POSSIBLE = new Set(['POSSIBLE']);

/**
 * Cloud Vision SafeSearch (D73) con l'endpoint UE. Soglie [Proposta]: "probabile" o "molto
 * probabile" per contenuti espliciti o violenza respingono; "possibile" manda in moderazione.
 */
export class VisionPhotoChecker implements PhotoChecker {
  private readonly logger = new Logger(VisionPhotoChecker.name);
  private readonly client: ImageAnnotatorClient;

  constructor(apiEndpoint: string) {
    this.client = new ImageAnnotatorClient({ apiEndpoint });
  }

  async check(image: Buffer): Promise<PhotoCheckResult> {
    const [result] = await this.client.safeSearchDetection({ image: { content: image } });
    const safe = result.safeSearchAnnotation;
    if (!safe) {
      this.logger.warn('Risposta di Vision senza SafeSearch: revisione manuale');
      return { outcome: 'manual' };
    }
    const adult = String(safe.adult ?? '');
    const racy = String(safe.racy ?? '');
    const violence = String(safe.violence ?? '');
    if (LIKELY.has(adult)) return { outcome: 'rejected', reason: 'explicit_content' };
    if (LIKELY.has(violence)) return { outcome: 'rejected', reason: 'violence' };
    if (POSSIBLE.has(adult) || LIKELY.has(racy))
      return { outcome: 'review', reason: 'explicit_content' };
    if (POSSIBLE.has(violence)) return { outcome: 'review', reason: 'violence' };
    return { outcome: 'passed' };
  }
}
