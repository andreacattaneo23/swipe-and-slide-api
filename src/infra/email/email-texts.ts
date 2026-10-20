// Testi delle email del backend (non dell'app: quelli stanno solo in `testi.js`). Neutri e senza
// il nome dell'app verso l'email aziendale (D101, D197). [Proposta] forma esatta da approvare.

export function otpEmail(code: string): { subject: string; text: string } {
  return {
    subject: 'Il tuo codice di verifica',
    text: `Il tuo codice di verifica è ${code}.\nScade tra 10 minuti. Se non l'hai chiesto tu, ignora questa email.`,
  };
}
