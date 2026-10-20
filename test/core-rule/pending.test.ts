// Casi della suite RC che dipendono da moduli non ancora realizzati: restano visibili come
// `todo` finché il modulo non arriva, così non si dimenticano (i numeri non si riusano).
describe('Casi RC in attesa dei moduli', () => {
  it.todo('RC-20 secondo cambio azienda entro 30 giorni rifiutato (WorkIdentityModule)');
  it.todo(
    'RC-22 risposte di profilo, match e chat senza email, company_id né motivo di chiusura (ProfilesModule, MatchesModule, ChatModule)',
  );
  it.todo(
    'RC-25 ri-verifica non completata entro 7 giorni: sospeso dal processo giornaliero (JobsModule)',
  );
  it.todo(
    "RC-44 rimozione del dominio dell'email attiva: ri-verifica e poi sospensione (CompaniesModule, JobsModule)",
  );
  it.todo(
    'RC-47 sottodominio non mappato poi mappato (copertura via API in registration.test.ts per il solo rifiuto)',
  );
  it.todo('RC-61 feed con soli candidati con can_interact (FeedModule)');
  it.todo(
    'RC-67 e RC-68 data di efficacia casuale tra 24 e 47 ore e annullamento (ExcludedCompaniesModule, processo orario)',
  );
  it.todo(
    'RC-72 e RC-73 cambio azienda dal servizio con letture in parallelo (WorkIdentityModule)',
  );
  it.todo(
    'RC-107 chiusura del match con blocked e cancellazione dei like al blocco (BlocksModule)',
  );
  it.todo('RC-120 limiti dello swipe, Rollback e like reciproci simultanei (SwipesModule)');
  it.todo('RC-125 controllo giornaliero di coerenza (JobsModule)');
  it.todo(
    "RC-132 e RC-133 rimozione di un'azienda con intervallo e cancellazione (CompaniesModule)",
  );
  it.todo('RC-186 indicatore "Open space attivo" e GET /me/open-space (OpenSpaceModule)');
  it.todo('RC-197 e RC-198 eventi del tempo reale e canali (RealtimeModule)');
  it.todo('RC-199 e RC-200 lettura motivata e cifratura delle chat (ChatModule, EncryptionModule)');
});
