/**
 * Testi del backoffice che testi.js non ha ancora: [Proposta], da approvare (D209).
 *
 * Servono alle schermate di accesso, ai messaggi di errore dei moduli e alle forme generali dei
 * testi fittizi dei mockup (per esempio "In coda da 21 h · tentativo 1 di 3", origine F). Dopo
 * l'approvazione entrano in docs/design/sorgente/mockup/testi.js con la stessa chiave, si rilancia
 * `npm run texts` e si tolgono da qui; un test controlla che le chiavi non siano già in it.ts.
 * Tra parentesi graffe i valori che inserisce il backoffice; la forma singolare ha il suffisso .one.
 */
export const proposedTexts = {
  // Accesso dell'operatore: email, codice all'email e secondo fattore (D88, D231)
  'backoffice.signIn.title': 'Accesso al backoffice',
  'backoffice.signIn.body':
    "Usa l'email del team: ti mandiamo un codice, poi ti chiediamo il secondo fattore.",
  'backoffice.signIn.send': 'Invia il codice',
  'backoffice.signIn.neutral': "Se l'indirizzo è di un operatore, riceverai un codice.",
  'backoffice.signIn.code.title': "Codice dall'email",
  'backoffice.signIn.code.body': 'Abbiamo inviato un codice di 6 cifre a {email}.',
  'backoffice.signIn.code.label': 'Codice di verifica',
  'backoffice.signIn.totp.title': 'Secondo fattore',
  'backoffice.signIn.totp.body': "Inserisci il codice di 6 cifre dell'app di autenticazione.",
  'backoffice.signIn.totp.label': 'Codice del secondo fattore',
  'backoffice.signIn.submit': 'Accedi',
  'backoffice.signIn.restart': "Ricomincia dall'email",
  'backoffice.signIn.expired': "La procedura di accesso è scaduta: ricomincia dall'email.",
  'backoffice.signOut': 'Esci',
  'backoffice.support': 'Supporto',
  'backoffice.nav.label': 'Sezioni del backoffice',

  // Errori dei moduli (D91, D93)
  'backoffice.error.explanation': 'Scrivi la motivazione: è obbligatoria.',
  'backoffice.error.reason': 'Scegli il motivo del rifiuto.',
  'backoffice.error.name': "Il nome non corrisponde a quello dell'azienda.",
  'backoffice.error.code': 'Il codice ha 6 cifre.',
  'backoffice.error.totp': 'Codice del secondo fattore non valido.',
  'backoffice.error.required': 'Campo obbligatorio.',
  'backoffice.error.domain': 'Dominio non valido, per esempio azienda.it.',
  'backoffice.error.domainTaken': "Questo dominio è già di un'altra azienda.",
  'backoffice.error.conflict': "L'elemento è cambiato nel frattempo: ricarica la pagina.",
  'backoffice.error.forbidden': 'Il tuo ruolo non permette questa azione.',

  // Sezioni non ancora disponibili
  'backoffice.placeholder': 'Questa sezione arriva in una delle prossime fasi.',

  // Aziende (D84, D85, D93, D111, D120)
  'backoffice.count.value': '{companies} aziende · {domains} domini',
  'backoffice.removing': 'In rimozione',
  'backoffice.removing.until': 'Cancellazione il {date}',
  'backoffice.removal.cancel': 'Annulla la rimozione',
  'backoffice.removal.started': "Rimozione avviata: gli account si cancellano dopo l'intervallo.",
  'backoffice.removal.cancelled': 'Rimozione annullata: gli account tornano come prima.',
  'backoffice.removalModal.title.value': 'Rimuovi {name}',
  'backoffice.removalModal.accounts.value': '{count} account coinvolti',
  'backoffice.removalModal.accounts.under10': 'meno di 10 account coinvolti',
  'backoffice.newCompany.title': 'Nuova azienda',
  'backoffice.newCompany.domains.hint':
    'Uno per riga, in minuscolo. I sottodomini vanno aggiunti uno per uno.',
  'backoffice.newCompany.submit': "Aggiungi l'azienda",
  'backoffice.newCompany.created': 'Azienda aggiunta.',
  'backoffice.empty.companies': 'Nessuna azienda corrisponde alla ricerca.',

  // Approvazioni (D141–D144)
  'backoffice.approvalQueue.nameAge': '{name}, {age}',
  'backoffice.approvalQueue.waiting.hours': 'In coda da {count} h',
  'backoffice.approvalQueue.waiting.minutes': 'In coda da {count} min',
  'backoffice.approvalQueue.attemptOf': 'tentativo {attempt} di {total}',
  'backoffice.approvalQueue.attemptOf.title': 'Tentativo {attempt} di {total}',
  'backoffice.approvalQueue.dueIn': 'Scade tra {count} h',
  'backoffice.approvalQueue.dueIn.minutes': 'Scade tra {count} min',
  'backoffice.approvalQueue.overdue': 'Oltre le 24 ore: avviso inviato al team',
  'backoffice.approvalQueue.empty': 'Nessun profilo in attesa.',
  'backoffice.approvalQueue.select': 'Scegli un profilo dalla coda.',
  'backoffice.approvalQueue.reason.placeholder': 'Scegli un motivo',
  'backoffice.approvalQueue.approved': 'Profilo approvato.',
  'backoffice.approvalQueue.rejected': "Profilo rifiutato: la motivazione è nell'app.",
  'backoffice.approvalQueue.photo': 'Foto {count} di {total}',
  'reason.inappropriatePhotos': 'Foto inappropriate',
  'reason.fakeProfile': 'Profilo falso',
  'reason.disallowedText': 'Testi non ammessi',
  'reason.revealsCompany': "Dati che rivelano l'azienda o i clienti",

  // Offsite (D150, D153, D167)
  'backoffice.offsiteForm.field.city': 'Città',
  'backoffice.offsiteForm.field.start': 'Inizio',
  'backoffice.offsiteForm.field.end': 'Fine',
  'backoffice.offsiteForm.capacity.unit': 'persone',
  'backoffice.offsiteForm.cover.empty':
    'Nessuna copertina: il caricamento arriva con le API di amministrazione.',
  'backoffice.offsiteForm.savedDraft': 'Bozza salvata.',
  'backoffice.offsiteForm.published': 'Offsite pubblicato.',
  'backoffice.offsiteForm.error.dates': "L'orario di fine viene dopo quello di inizio.",
} as const;
