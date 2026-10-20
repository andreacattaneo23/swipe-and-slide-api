import {
  alertKey,
  dueLabel,
  formatDay,
  formatNumber,
  isNearDue,
  romeToIso,
  waitingLabel,
} from './time';

const now = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const inHours = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe('tempi della coda delle approvazioni (D141, D144)', () => {
  it('ore e minuti in coda come nei mockup', () => {
    expect(waitingLabel(hoursAgo(21), now)).toBe('In coda da 21 h');
    expect(waitingLabel(hoursAgo(2 / 3), now)).toBe('In coda da 40 min');
  });

  it('tempo che resta alle 24 ore', () => {
    expect(dueLabel(inHours(3), now)).toBe('Scade tra 3 h');
    expect(dueLabel(inHours(23 + 1 / 3), now)).toBe('Scade tra 23 h');
    expect(dueLabel(inHours(0.5), now)).toBe('Scade tra 30 min');
    expect(dueLabel(hoursAgo(1), now)).toBe('Oltre le 24 ore: avviso inviato al team');
  });

  it("avviso al team dalle 20 ore e oltre le 24, mai un'approvazione automatica", () => {
    expect(isNearDue(hoursAgo(19.9), now)).toBe(false);
    expect(isNearDue(hoursAgo(20), now)).toBe(true);
    expect(alertKey(hoursAgo(10), now)).toBeNull();
    expect(alertKey(hoursAgo(21), now)).toBe('backoffice.approvalQueue.notice');
    expect(alertKey(hoursAgo(25), now)).toBe('backoffice.approvalQueue.overdue');
  });
});

describe('date e numeri', () => {
  it('ora di Roma in UTC, con ora legale e solare', () => {
    expect(romeToIso('2026-07-15', '18:30')).toBe('2026-07-15T16:30:00.000Z');
    expect(romeToIso('2026-12-15', '18:30')).toBe('2026-12-15T17:30:00.000Z');
    expect(romeToIso('2026-13-01', '18:30')).not.toBe('2026-13-01T17:30:00.000Z');
    expect(romeToIso('15/10/2026', '18:30')).toBeNull();
  });

  it('giorno per esteso con la maiuscola', () => {
    expect(formatDay('2026-10-15')).toBe('Giovedì 15 ottobre');
  });

  it('separatore delle migliaia anche a quattro cifre', () => {
    expect(formatNumber(1240)).toBe('1.240');
    expect(formatNumber(214)).toBe('214');
  });
});
