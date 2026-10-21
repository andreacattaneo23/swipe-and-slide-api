/**
 * Codici d'errore e di esito dell'API del profilo e dell'account che `testi.js` non ha ancora:
 * [Proposta], da approvare (D209, D238: i codici d'errore sono le chiavi dei testi). Dopo
 * l'approvazione entrano in docs/design/sorgente/mockup/testi.js con la stessa chiave e si
 * tolgono da qui. Tra parentesi graffe i valori che l'app inserisce dai campi dell'errore.
 */
export const proposedErrorTexts = {
  'excludedCompanies.invalid':
    "Questa azienda non si può aggiungere: scegline un'altra dall'elenco.",
  'excluded.error.max': "Hai già 15 aziende escluse: per aggiungerne un'altra togline una.",
  'photos.tooLarge': 'La foto è troppo grande: scegline una più leggera.',
  'photos.invalid': "Questo file non è una foto che possiamo usare: scegline un'altra.",
  'photos.notUploaded': 'Il caricamento della foto non è finito: riprova.',
  'photos.max': "Hai già 6 foto: per aggiungerne un'altra togline una.",
  'profile.ageRange.invalid': "L'età minima non può superare quella massima.",
  'interest.limit.reached': 'Puoi scegliere fino a 5 interessi.',
  'profile.questions.limit.reached': 'Puoi rispondere al massimo a 3 domande.',
  'identity.confirmation.required':
    "Per continuare conferma che sei tu con il codice all'email personale.",
  'companyChange.error.notDifferent': 'Questa è già la tua email aziendale.',
  'deletion.notRequested': "Non c'è nessuna cancellazione da annullare.",
  'dataExport.limit':
    'Puoi chiedere i tuoi dati una volta ogni 7 giorni: potrai farlo di nuovo {date}.',
  'settings.access.method.same': 'Usi già questo modo di accesso.',
  'settings.access.personalEmail.onlyEmail':
    "L'email personale si cambia così solo se accedi con l'email: con Apple o Google cambia il modo di accesso.",
} as const;

export type ProposedErrorCode = keyof typeof proposedErrorTexts;
