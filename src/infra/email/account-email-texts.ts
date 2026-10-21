// Testi delle email di account e sicurezza all'email personale (D67): mai il nome dell'azienda, il
// motivo di una ri-verifica o dati di altre persone; solo testo. [Proposta] forme da approvare,
// come quelle di `email-texts.ts`; le date sono in ora italiana.

const day = (date: Date): string =>
  date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

export type AccountEmail = { subject: string; text: string };

export const accountEmails = {
  workEmailUpdated: (): AccountEmail => ({
    subject: 'La tua email aziendale è stata aggiornata',
    text: "Abbiamo aggiornato l'email aziendale del tuo account Swipe & Slide.\nSe non sei stato tu, scrivi al Supporto.",
  }),
  reverificationStarted: (due: Date): AccountEmail => ({
    subject: 'Conferma la tua email aziendale',
    text: `Per restare visibile su Swipe & Slide conferma la tua email aziendale dall'app entro il ${day(due)}.`,
  }),
  suspended: (deletion: Date): AccountEmail => ({
    subject: 'Il tuo account è in sospeso',
    text: `Non risulta un'email aziendale valida: il tuo account è nascosto. Puoi ripristinarlo dall'app collegando un'email aziendale entro il ${day(deletion)}; dopo lo cancelliamo con tutti i dati.`,
  }),
  deletionSoon: (deletion: Date): AccountEmail => ({
    subject: 'Il tuo account sta per essere cancellato',
    text: `Il tuo account in sospeso sarà cancellato il ${day(deletion)}. Per ripristinarlo collega un'email aziendale dall'app.`,
  }),
  deletionRequested: (final: Date): AccountEmail => ({
    subject: 'Cancellazione dell’account in programma',
    text: `Il tuo account è nascosto e sarà cancellato il ${day(final)}. Fino ad allora puoi annullare la cancellazione accedendo all'app.`,
  }),
  accountDeleted: (): AccountEmail => ({
    subject: 'Il tuo account è stato cancellato',
    text: 'Abbiamo cancellato il tuo account Swipe & Slide e i tuoi dati, salvo quelli previsti dall’informativa.',
  }),
  personalEmailChanged: (): AccountEmail => ({
    subject: 'La tua email personale è stata cambiata',
    text: "L'email personale del tuo account Swipe & Slide è cambiata. Se non sei stato tu, scrivi al Supporto.",
  }),
  signInMethodChanged: (): AccountEmail => ({
    subject: 'Il modo di accesso è stato cambiato',
    text: 'Il modo di accesso al tuo account Swipe & Slide è cambiato. Se non sei stato tu, scrivi al Supporto.',
  }),
  dataExportReady: (expires: Date): AccountEmail => ({
    subject: 'I tuoi dati sono pronti',
    text: `Puoi scaricare i tuoi dati dall'app, nella sezione Account, fino al ${day(expires)}.`,
  }),
};
