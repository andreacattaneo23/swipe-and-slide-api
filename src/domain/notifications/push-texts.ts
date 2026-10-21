// Generato da scripts/push-texts.mjs a partire da testi.js della radice (D209): non modificare a
// mano. Testi delle notifiche push, a tema e senza nomi, foto né anteprime (D65).
export const pushTexts = {
  "notification.match": "Nuovo deal chiuso",
  "notification.message": "Hai un aggiornamento sul progetto",
  "notification.escalation": "Hai ricevuto un'escalation",
  "notification.invite": "Nuova proposta di meeting",
  "invite.accepted": "Meeting confermato",
  "invite.toReschedule": "Il meeting va ripianificato",
  "notification.meetingTomorrow": "Meeting domani",
  "notification.expiry": "Deadline in avvicinamento",
  "reverification.title": "Conferma la tua email aziendale",
  "notification.ooo": "Ancora Out Of Office?",
  "notification.offsite.tomorrow": "Offsite domani",
  "notification.offsite.updated": "Offsite aggiornato",
  "notification.offsite.cancelled": "Offsite annullato",
  "approval.approved": "Onboarding completato: ti diamo il benvenuto a bordo",
  "approval.notification": "C'è un aggiornamento sul tuo profilo",
} as const;

export type PushTextKey = keyof typeof pushTexts;
