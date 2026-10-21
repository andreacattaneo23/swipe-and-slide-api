/**
 * Archivio degli oggetti privati (foto, esportazioni, copie delle segnalazioni, documenti della
 * verifica dell'età D113, copertine degli offsite), compatibile S3 (D240): MinIO in locale e
 * Cloudflare R2 in produzione con lo stesso client (README, "Foto"). Le chiavi sono casuali o
 * percorsi senza dati personali; gli oggetti si leggono solo con URL firmati di breve durata,
 * emessi dal backend dopo il controllo della regola.
 */
export interface SignedUpload {
  url: string;
  method: 'PUT';
  expiresAt: Date;
  maxBytes: number;
}

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Contenuto dell'oggetto, o `null` se non esiste. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** URL firmato per caricare un oggetto, con dimensione massima e scadenza. */
  signedUpload(key: string, ttlSeconds: number, maxBytes: number): Promise<SignedUpload>;
  /** URL firmato per leggere un oggetto. */
  signedDownload(key: string, ttlSeconds: number): Promise<string>;
  /** URL firmato per caricare un oggetto (`PUT`), valido pochi minuti. */
  signedPutUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
  /** URL firmato per leggere un oggetto, valido pochi minuti, mai salvato. */
  signedGetUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
  exists(key: string): Promise<boolean>;
  /** Contenuto dell'oggetto; errore se non esiste. */
  read(key: string): Promise<Buffer>;
  write(key: string, body: Buffer, contentType?: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Chiavi ammesse: minuscole, cifre e separatori, senza risalire le cartelle. */
export const STORAGE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

/** Chiave dell'oggetto ammessa: niente percorsi relativi, doppie barre né caratteri speciali. */
export function validStorageKey(key: string): boolean {
  return STORAGE_KEY.test(key) && !key.includes('..') && !key.includes('//');
}

export function assertStorageKey(key: string): void {
  if (!validStorageKey(key)) throw new Error('Chiave di archivio non valida');
}

/** Durata degli URL firmati (pochi minuti, README). */
export const SIGNED_URL_SECONDS = { upload: 10 * 60, download: 5 * 60 } as const;
