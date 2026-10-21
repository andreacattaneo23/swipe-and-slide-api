import { randomUUID } from 'node:crypto';

/**
 * Lettura delle email vere da Mailpit (D240): API su `MAILPIT_API` (di base
 * `http://127.0.0.1:8025`). Ogni test usa indirizzi unici, così i messaggi degli altri team e
 * delle altre esecuzioni non interferiscono.
 */
const API = process.env.MAILPIT_API ?? 'http://127.0.0.1:8025';

interface Summary {
  ID: string;
  Created: string;
  Subject: string;
  To: { Address: string }[];
  From: { Address: string };
}

/** Indirizzo unico per un test, su un dominio di fantasia. */
export function uniqueAddress(prefix: string, domain = 'personale.example'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@${domain}`;
}

/** Messaggi ricevuti da un indirizzo, dal più recente. */
export async function messagesTo(address: string): Promise<Summary[]> {
  const response = await fetch(
    `${API}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=50`,
  );
  if (!response.ok) throw new Error(`Mailpit non risponde (${response.status})`);
  const body = (await response.json()) as { messages: Summary[] };
  return body.messages.filter((message) =>
    message.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()),
  );
}

/** Testo di un messaggio. */
export async function messageText(
  id: string,
): Promise<{ text: string; from: string; subject: string }> {
  const response = await fetch(`${API}/api/v1/message/${id}`);
  const body = (await response.json()) as {
    Text: string;
    From: { Address: string };
    Subject: string;
  };
  return { text: body.Text, from: body.From.Address, subject: body.Subject };
}

/**
 * Ultimo codice OTP arrivato all'indirizzo dopo `since` (o il più recente): aspetta fino a 5
 * secondi che l'email arrivi.
 */
export async function latestCode(address: string, since?: Date): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const messages = await messagesTo(address);
    const fresh = messages.find((message) => !since || new Date(message.Created) >= since);
    if (fresh) {
      const { text } = await messageText(fresh.ID);
      const code = text.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Nessun codice arrivato a ${address}`);
}

/** Ultima email arrivata all'indirizzo (oggetto, testo, mittente), aspettando fino a 5 secondi. */
export async function latestMessage(
  address: string,
  since?: Date,
): Promise<{ text: string; from: string; subject: string }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const messages = await messagesTo(address);
    const fresh = messages.find((message) => !since || new Date(message.Created) >= since);
    if (fresh) return messageText(fresh.ID);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Nessuna email arrivata a ${address}`);
}
