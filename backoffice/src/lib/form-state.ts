/** Stato dei moduli gestiti dalle azioni lato server, letto dai componenti con useActionState. */
export interface FormState {
  status: 'idle' | 'error' | 'success';
  /** Testo già risolto da t(): il componente lo mostra così com'è. */
  message?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** Valori da rimettere nei campi dopo un errore (mai codici né segreti). */
  values?: Partial<Record<string, string>>;
}

export const initialFormState: FormState = { status: 'idle' };
