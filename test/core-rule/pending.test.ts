// Casi della suite RC che dipendono da moduli non ancora realizzati: restano visibili come
// `todo` finché il modulo non arriva, così non si dimenticano (i numeri non si riusano). I casi
// del profilo e dell'account sono nelle suite di integrazione `profile`, `privacy` e `account`.
describe('Casi RC in attesa dei moduli', () => {
  it.todo(
    'RC-47 sottodominio non mappato poi mappato (copertura via API in registration.test.ts per il solo rifiuto)',
  );
  it.todo(
    "RC-200 cifratura applicativa: backup senza custodia della chiave (l'esportazione è in account.test.ts)",
  );
});
