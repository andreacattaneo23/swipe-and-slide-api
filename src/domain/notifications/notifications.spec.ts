import { inQuietHours, isNight, romeMinutes } from './notifications.service';
import { parseEnvelope } from '../../core/realtime/events';

describe('Fasce della "Modalità in riunione" (D66, D233)', () => {
  it('fasce nello stesso giorno e oltre la mezzanotte', () => {
    expect(inQuietHours([{ start: '09:00', end: '11:00' }], 10 * 60)).toBe(true);
    expect(inQuietHours([{ start: '09:00', end: '11:00' }], 11 * 60)).toBe(false);
    expect(inQuietHours([{ start: '22:00', end: '07:00' }], 23 * 60)).toBe(true);
    expect(inQuietHours([{ start: '22:00', end: '07:00' }], 6 * 60)).toBe(true);
    expect(inQuietHours([{ start: '22:00', end: '07:00' }], 12 * 60)).toBe(false);
    expect(inQuietHours([], 12 * 60)).toBe(false);
  });

  it('notte dei promemoria e ora italiana', () => {
    expect(isNight(23 * 60)).toBe(true);
    expect(isNight(9 * 60)).toBe(false);
    expect(romeMinutes(new Date('2026-07-01T10:30:00Z'))).toBe(12 * 60 + 30);
  });
});

describe('Eventi del tempo reale (D182)', () => {
  const id = '3f9c2a7e-5b1d-4e8a-9c0f-2d6b7a1e4c55';

  it('solo tipo e identificativi: gli altri campi si scartano', () => {
    const parsed = parseEnvelope(
      JSON.stringify({
        userId: id,
        event: { type: 'message', matchId: id, messageId: id, text: 'segreto' },
      }),
    );
    expect(parsed).toEqual({ userId: id, event: { type: 'message', matchId: id, messageId: id } });
  });

  it('tipi sconosciuti, destinatari non validi e testi malformati rifiutati', () => {
    expect(parseEnvelope(JSON.stringify({ userId: id, event: { type: 'typing' } }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ userId: 'x', event: { type: 'tabs' } }))).toBeNull();
    expect(parseEnvelope('{')).toBeNull();
  });
});
