/**
 * Dati finti dell'adattatore mock, presi dai contenuti fittizi dei mockup 18a–18d (origine F di
 * testi.js): nessuna persona né società reale. Le date sono relative all'avvio, così la coda delle
 * approvazioni mostra sempre tempi credibili.
 */
import type { ApprovalDetail, City, Company } from '../types';

export type MockApproval = Omit<ApprovalDetail, 'photo'>;

const HOUR = 60 * 60_000;

export function buildFixtures(now: Date) {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR).toISOString();
  const due = (hoursAgo: number) => new Date(now.getTime() + (24 - hoursAgo) * HOUR).toISOString();

  const companies: Company[] = [
    company('c-sample', 'Campione & Associati', ['campione.example'], 214, '2026-09-12'),
    company('c-demo', 'Demo Revisione Store', ['demo-revisione.example'], null, '2026-09-02', true),
    company(
      'c-example',
      'Esempio Consulting',
      ['esempioconsulting.example', 'it.esempioconsulting.example'],
      1240,
      '2026-09-25',
    ),
    company('c-model', 'Modello Partners', ['modellopartners.example'], 86, '2026-08-18'),
    company(
      'c-trial',
      'Prova Advisory',
      ['provaadvisory.example', 'prova.example'],
      312,
      '2026-09-03',
    ),
    company(
      'c-fictional',
      'Studio Fittizio',
      ['studiofittizio.example', 'fittizio.example'],
      37,
      '2026-09-28',
    ),
  ];

  const approval = (
    id: string,
    name: string,
    age: number,
    hoursAgo: number,
    attempt: number,
    details: Pick<MockApproval, 'practiceArea' | 'lookingFor' | 'bio'>,
  ): MockApproval => ({
    id,
    name,
    age,
    attempt,
    maxAttempts: 3,
    submittedAt: at(hoursAgo),
    dueAt: due(hoursAgo),
    photos: [
      { id: `${id}-1`, url: null, placeholder: 'terracotta' },
      { id: `${id}-2`, url: null, placeholder: 'sage' },
      { id: `${id}-3`, url: null, placeholder: 'sand' },
    ],
    ...details,
  });

  const approvals: MockApproval[] = [
    approval('r-marco', 'Marco', 33, 21, 1, {
      practiceArea: 'Operations e supply chain',
      lookingFor: 'Un progetto pilota',
      bio: 'Pianifico tutto, tranne le cene: quelle le improvviso. Il sabato mattina corro lungo il fiume.',
    }),
    approval('r-elena', 'Elena', 27, 14, 1, {
      practiceArea: 'Strategia',
      lookingFor: null,
      bio: 'Tra una trasferta e l’altra cerco sempre una libreria nuova.',
    }),
    approval('r-davide', 'Davide', 30, 9, 2, {
      practiceArea: 'Tecnologia',
      lookingFor: 'Un progetto pilota',
      bio: null,
    }),
    approval('r-chiara', 'Chiara', 35, 4, 1, {
      practiceArea: null,
      lookingFor: null,
      bio: 'Il venerdì sera niente slide, solo cinema.',
    }),
    approval('r-paolo', 'Paolo', 41, 2 / 3, 1, {
      practiceArea: 'Finanza',
      lookingFor: null,
      bio: null,
    }),
  ];

  const cities: City[] = [
    { id: 'city-milano', name: 'Milano' },
    { id: 'city-roma', name: 'Roma' },
    { id: 'city-torino', name: 'Torino' },
    { id: 'city-bologna', name: 'Bologna' },
    { id: 'city-napoli', name: 'Napoli' },
    { id: 'city-firenze', name: 'Firenze' },
  ];

  return { companies, approvals, cities, photosCount: 5 };
}

function company(
  id: string,
  name: string,
  domains: string[],
  usersCount: number | null,
  updatedAt: string,
  isDemo = false,
): Company {
  return {
    id,
    name,
    status: 'active',
    isDemo,
    domains,
    usersCount,
    updatedAt: new Date(`${updatedAt}T10:00:00Z`).toISOString(),
    removalFinalAt: null,
  };
}
