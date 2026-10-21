/**
 * Codici d'errore di feed, swipe, chat, inviti e offsite: dove l'app mostra un testo dedicato il
 * codice è la chiave di `testi.js` (D238), negli altri casi resta il `404` neutro o `validation`.
 */
export const FeedChatError = {
  /** 429: like del giorno finiti (D54, D177). */
  slidesFinished: 'feed.slides.finished',
  /** 429: escalation del giorno già usata (D54, D130). */
  escalationUsed: 'action.escalation.used',
  /** 409: conversazione momentaneamente sospesa, stesso codice per ogni causa (D82). */
  matchFrozen: 'match.frozen',
  /** 409: c'è già una proposta di meeting in sospeso (D147). */
  meetingPending: 'chat.meeting.pending',
  /** 409: nulla da annullare con il Rollback (ultimo swipe con match o già annullato). */
  nothingToRollback: 'conflict',
} as const;
