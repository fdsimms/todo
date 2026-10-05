import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { cancelCalendarRequest, listCalendarRequests, parseCalendarRequest, requestCalendarEvent } from '../calendarTools';
import { withAgentLedger, type AgentLedgerEntry } from '../agentLedger';
import { describeEffects } from '../confirmWrites';

let mockRaw: ShimDatabase;
jest.mock('expo-sqlite', () => {
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;
beforeAll(() => {
  replica = openReplica(':memory:');
});
beforeEach(() => {
  mockRaw.runSync('DELETE FROM calendar_requests');
  mockRaw.runSync("DELETE FROM settings WHERE key = 'calendarRequestDeviceId'");
});

const writerOn = () => mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendarRequestDeviceId', 'phone-1')");
const NOW = new Date(2026, 9, 5, 12);

describe('parseCalendarRequest', () => {
  it('reads a bare date as an all-day event with an exclusive end', () => {
    const r = parseCalendarRequest({ title: ' Dentist ', start: '2026-10-08' }, NOW);
    expect(r).toEqual({
      title: 'Dentist',
      startAt: new Date(2026, 9, 8).toISOString(),
      endAt: new Date(2026, 9, 9).toISOString(),
      allDay: true,
      location: null,
      notes: null,
    });
  });

  it('takes an all-day end as the last day, inclusive', () => {
    const r = parseCalendarRequest({ title: 'Trip', start: '2026-10-08', end: '2026-10-10' }, NOW);
    expect(r.endAt).toBe(new Date(2026, 9, 11).toISOString());
  });

  it('reads a local date and time in the adopted zone, an hour long by default', () => {
    const r = parseCalendarRequest({ title: 'Call', start: '2026-10-08T14:00' }, NOW);
    expect(r.allDay).toBe(false);
    expect(r.startAt).toBe(new Date(2026, 9, 8, 14).toISOString());
    expect(r.endAt).toBe(new Date(2026, 9, 8, 15).toISOString());
  });

  it('keeps a location and notes, and drops blank ones', () => {
    const r = parseCalendarRequest({ title: 'Call', start: '2026-10-08T14:00', location: ' Main St ', notes: '  ' }, NOW);
    expect(r.location).toBe('Main St');
    expect(r.notes).toBeNull();
  });

  it('refuses what the phone would only refuse later', () => {
    expect(() => parseCalendarRequest({ title: '  ', start: '2026-10-08' }, NOW)).toThrow(/title/);
    expect(() => parseCalendarRequest({ title: 'x', start: 'next tuesday' }, NOW)).toThrow(/not a date/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-02-30' }, NOW)).toThrow(/not a date/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-10-08', end: '2026-10-07' }, NOW)).toThrow(/before the first/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-10-08', end: '2026-10-08T10:00' }, NOW)).toThrow(/last day/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-10-08T14:00', end: '2026-10-08' }, NOW)).toThrow(/ends at a time/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-10-08T14:00', end: '2026-10-08T13:00' }, NOW)).toThrow(/end after/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-10-08T14:00', end: '2026-10-20T13:00' }, NOW)).toThrow(/over a week/);
    expect(() => parseCalendarRequest({ title: 'x', start: '2026-10-04' }, NOW)).toThrow(/already over/);
  });

  it('accepts an all-day event for today, which is not over until midnight', () => {
    expect(parseCalendarRequest({ title: 'x', start: '2026-10-05' }, NOW).allDay).toBe(true);
  });
});

describe('request_calendar_event', () => {
  const ahead = () => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  it('refuses when no device is set to add them', () => {
    expect(() => requestCalendarEvent(replica, { title: 'Dentist', start: ahead() })).toThrow(/No device is set/);
    expect(replica.calendarRequests()).toEqual([]);
  });

  it('queues a pending request and says it is not on the calendar yet', () => {
    writerOn();
    const result = requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    expect(result.request).toMatchObject({ title: 'Dentist', start: ahead(), end: ahead(), allDay: true, status: 'pending' });
    expect(result.note).toMatch(/not on the calendar yet/);
    expect(replica.calendarRequests()).toHaveLength(1);
  });

  it('stamps the row so it travels to the phone', () => {
    writerOn();
    requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    const row = mockRaw.getFirstSync<{ updated_at: string | null }>('SELECT updated_at FROM calendar_requests');
    expect(row?.updated_at).toBeTruthy();
  });

  it('lists newest first, filtered by status, with whether a device is set', () => {
    writerOn();
    requestCalendarEvent(replica, { title: 'First', start: ahead() });
    requestCalendarEvent(replica, { title: 'Second', start: ahead() });
    const all = listCalendarRequests(replica, {});
    expect(all.deviceSetToAddThem).toBe(true);
    expect(all.requests.map(r => r.title)).toEqual(['Second', 'First']);
    expect(listCalendarRequests(replica, { status: 'written' }).requests).toEqual([]);
  });

  it('cancels a pending request and refuses one already written', () => {
    writerOn();
    const { request } = requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    expect(cancelCalendarRequest(replica, { id: request.id }).cancelled.status).toBe('cancelled');
    expect(() => cancelCalendarRequest(replica, { id: request.id })).toThrow(/already cancelled/);

    const other = requestCalendarEvent(replica, { title: 'Call', start: ahead() }).request;
    mockRaw.runSync("UPDATE calendar_requests SET status = 'written' WHERE id = ?", [other.id]);
    expect(() => cancelCalendarRequest(replica, { id: other.id })).toThrow(/already on the calendar/);
    expect(() => cancelCalendarRequest(replica, { id: 'nope' })).toThrow(/No calendar request/);
  });

  it('records the request in the Activity ledger and previews it as a request', () => {
    writerOn();
    const entries: AgentLedgerEntry[] = [];
    const logged = withAgentLedger(replica, e => entries.push(...e));
    const { request } = requestCalendarEvent(logged, { title: 'Dentist', start: ahead() });
    cancelCalendarRequest(logged, { id: request.id });
    expect(entries.map(e => [e.action, e.subject, e.title, e.recordId])).toEqual([
      ['created', 'event', 'Dentist', request.id],
      ['cleared', 'event', 'Dentist', request.id],
    ]);
    expect(describeEffects(entries)).toEqual([
      'Ask the phone to add "Dentist" to the calendar the next time it syncs',
      'Cancel the request to add "Dentist" to the calendar',
    ]);
  });
});
