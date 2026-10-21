// Testi delle email del backend per sicurezza, moderazione e amministrazione (team B3, D239)
// [Proposta]: da approvare e portare nella fonte dei testi. Tono chiaro e serio nei flussi di
// sicurezza (D69); nessun nome di altre persone, nessun motivo della ri-verifica (D72) e nessuna
// motivazione del rifiuto dell'approvazione, che si legge solo nell'app (D142).

export interface EmailText {
  subject: string;
  text: string;
}

type Params = Record<string, unknown>;

const SANCTION_TITLES: Record<string, string> = {
  warning: 'Hai ricevuto un avviso',
  disciplinary_suspension: 'Il tuo account è sospeso per 7 giorni',
  expulsion: 'Il tuo account è stato chiuso',
};

/** Indirizzo pubblico del ricorso con il codice (pagina web, da definire al deploy). */
export const APPEAL_URL = process.env.APPEAL_URL ?? 'https://swipe-and-slide.example/ricorso';

const appealLink = (code: unknown) =>
  typeof code === 'string' && code
    ? `\n\nPuoi presentare un ricorso entro 6 mesi da questo collegamento: ${APPEAL_URL}?codice=${code}`
    : '';

/** Testi degli avvisi all'utente (`user_notices`), all'email personale. */
export function noticeEmail(template: string, params: Params): EmailText | null {
  switch (template) {
    case 'sanction.decided': {
      const title = SANCTION_TITLES[String(params.type)] ?? 'Una decisione sul tuo account';
      return {
        subject: title,
        text:
          `${title}.\n\nMotivo: ${text(params.explanation)}\n\n` +
          'Trovi la decisione anche nell’app, dove puoi presentare un ricorso.' +
          appealLink(params.appealCode),
      };
    }
    case 'sanction.revoked':
      return {
        subject: 'Una decisione sul tuo account è stata annullata',
        text: 'Abbiamo annullato una decisione sul tuo account. L’account torna com’era.',
      };
    case 'sanction.ended':
      return {
        subject: 'La sospensione del tuo account è terminata',
        text: 'La sospensione del tuo account è terminata: puoi usare di nuovo l’app.',
      };
    case 'appeal.decided':
      return {
        subject: 'Abbiamo esaminato il tuo ricorso',
        text:
          params.outcome === 'accepted'
            ? `Abbiamo accolto il tuo ricorso.\n\n${text(params.explanation)}`
            : `Abbiamo esaminato il tuo ricorso e confermato la decisione.\n\n${text(params.explanation)}`,
      };
    case 'age_verification.requested':
      return {
        subject: 'Serve una verifica della tua età',
        text:
          'Per continuare a usare l’account dobbiamo verificare che tu sia maggiorenne. ' +
          'Apri l’app e segui le istruzioni: il documento si cancella appena registrato l’esito.',
      };
    case 'approval.rejected':
      return {
        subject: 'C’è un aggiornamento sul tuo profilo',
        text: 'C’è un aggiornamento sul tuo profilo. Apri l’app per vederlo.',
      };
    case 'approval.blocked':
      return {
        subject: 'C’è un aggiornamento sul tuo profilo',
        text:
          'Non possiamo approvare il tuo profilo e l’account verrà chiuso. ' +
          'Le tue email non potranno essere usate per una nuova iscrizione per 2 anni.' +
          appealLink(params.appealCode),
      };
    case 'approval.deletion_soon':
      return {
        subject: 'Il tuo profilo verrà cancellato',
        text:
          'Il tuo profilo non è stato ripresentato dopo l’ultimo aggiornamento: tra qualche ' +
          'giorno l’account verrà cancellato. Apri l’app se vuoi correggerlo.',
      };
    case 'company_removal.started':
      return {
        subject: 'Il tuo account verrà chiuso',
        text:
          'L’azienda del tuo account non è più tra quelle disponibili. Il tuo account non è ' +
          `più visibile e verrà cancellato il ${formatDate(params.finalAt)}.`,
      };
    case 'company_removal.cancelled':
      return {
        subject: 'Il tuo account è di nuovo attivo',
        text: 'La chiusura del tuo account è stata annullata: l’account torna com’era.',
      };
    case 'reverification.started':
      return {
        subject: 'Conferma la tua email aziendale',
        text: 'Apri l’app per confermare la tua email aziendale con un codice entro 7 giorni.',
      };
    default:
      return null;
  }
}

/** Risposta neutra alla lista d'attesa, uguale per azienda aggiunta o non aggiunta (D95). */
export function waitlistAnswerEmail(): EmailText {
  return {
    subject: 'La tua richiesta di aggiunta',
    text:
      'Abbiamo esaminato la tua richiesta di aggiungere un’azienda. Prova di nuovo a ' +
      'registrarti con la tua email aziendale: se non è ancora possibile, la tua azienda non è ' +
      'tra quelle disponibili. La richiesta è stata cancellata.',
  };
}

/** Avviso al team con i soli conteggi (approvazioni, moderazione, processi). */
export function teamAlertEmail(kind: string, counts: Record<string, unknown>): EmailText {
  const lines = Object.entries(counts).map(([key, value]) => `- ${key}: ${String(value)}`);
  return { subject: `[backoffice] ${kind}`, text: `Conteggi:\n${lines.join('\n')}` };
}

function formatDate(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return 'giorno indicato nell’app';
  return date.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
