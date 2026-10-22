import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { cancelCalendarRequest, changeCalendarEvent, listCalendarRequests, parseCalendarRequest, proposeTaskDeviceAction, requestCalendarEvent } from '../calendarTools';
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
  mockRaw.runSync("DELETE FROM settings WHERE key IN ('calendarRequestDeviceId', 'calendarRequestAsksFirst')");
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
    expect(describeEffects(entries, logged.dayKeyOf)).toEqual([
      `Ask the phone to add "Dentist" to the calendar the next time it syncs: ${ahead()}, all day`,
      'Cancel the request to add "Dentist" to the calendar',
    ]);
  });
});

describe('change_calendar_event', () => {
  const ahead = () => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
  };
  const written = () => {
    writerOn();
    const { request } = requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    mockRaw.runSync("UPDATE calendar_requests SET status = 'written', event_external_id = 'ext-1' WHERE id = ?", [request.id]);
    return request;
  };

  it('queues a change that an older build would expire rather than create', () => {
    const target = written();
    const { request } = changeCalendarEvent(replica, { requestId: target.id, title: 'Dentist (moved)' });
    expect(request).toMatchObject({ change: 'update', changes: target.id, status: 'pending', title: 'Dentist (moved)' });
    const row = replica.calendarRequests().find(r => r.id === request.id)!;
    expect(new Date(row.endAt).getTime()).toBe(0);
    expect(row.changes).toEqual({ title: 'Dentist (moved)' });
  });

  it('keeps the event\'s length when only the start moves, and queues a delete', () => {
    const target = written();
    const later = new Date(new Date(target.start).getTime() + 2 * 3600_000).toISOString();
    changeCalendarEvent(replica, { requestId: target.id, start: later });
    const row = replica.calendarRequests().filter(r => r.action === 'update').pop()!;
    expect(new Date(row.changes!.endAt!).getTime() - new Date(row.changes!.startAt!).getTime()).toBe(new Date(target.end).getTime() - new Date(target.start).getTime());
    expect(changeCalendarEvent(replica, { requestId: target.id, delete: true }).request.change).toBe('delete');
  });

  it('refuses a request whose event is not written, or not findable again', () => {
    writerOn();
    const { request } = requestCalendarEvent(replica, { title: 'Call', start: ahead() });
    expect(() => changeCalendarEvent(replica, { requestId: request.id, title: 'x' })).toThrow(/not been added yet/);
    mockRaw.runSync("UPDATE calendar_requests SET status = 'written' WHERE id = ?", [request.id]);
    expect(() => changeCalendarEvent(replica, { requestId: request.id, title: 'x' })).toThrow(/cannot find it again/);
  });
});

describe('asking first', () => {
  const ahead = () => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
  };
  const asksFirst = () => mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendarRequestAsksFirst', 'true')");

  it('leaves an event as a proposal for the person to tap, and says so', () => {
    writerOn();
    asksFirst();
    const { request, note } = requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    expect(request.status).toBe('proposed');
    expect(note).toMatch(/Inbox/);
    expect(listCalendarRequests(replica, { status: 'proposed' }).requests).toHaveLength(1);
  });

  it('keeps sending straight through when the person never turned it on', () => {
    writerOn();
    expect(requestCalendarEvent(replica, { title: 'Dentist', start: ahead() }).request.status).toBe('pending');
  });

  it('takes a proposal back, and makes a change to an unapproved event wait for the event', () => {
    writerOn();
    asksFirst();
    const { request } = requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    expect(() => changeCalendarEvent(replica, { requestId: request.id, title: 'x' })).toThrow(/not been added yet/);
    expect(cancelCalendarRequest(replica, { id: request.id }).cancelled.status).toBe('cancelled');
  });

  it('proposes a change to a written event as well', () => {
    writerOn();
    const { request } = requestCalendarEvent(replica, { title: 'Dentist', start: ahead() });
    mockRaw.runSync("UPDATE calendar_requests SET status = 'written', event_external_id = 'ext-1' WHERE id = ?", [request.id]);
    asksFirst();
    expect(changeCalendarEvent(replica, { requestId: request.id, delete: true }).request.status).toBe('proposed');
  });
});

describe('propose_task_device_action', () => {
  const ahead = (hours = 48) => {
    const d = new Date(Date.now() + hours * 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const withDeadline = () => replica.createTask({ title: 'File taxes', deadline: new Date(Date.now() + 5 * 86400_000).toISOString() });

  it('suggests an alarm without needing a writer device, as a proposal an old build would expire', () => {
    const task = replica.createTask({ title: 'Take out recycling' });
    const { request, note } = proposeTaskDeviceAction(replica, { taskId: task.id, action: 'alarm', at: ahead(), ring: 'persistent' });
    expect(request).toMatchObject({ status: 'proposed', taskAction: 'alarm', taskId: task.id, ring: 'persistent' });
    expect(note).toMatch(/suggested, not set/);
    const row = replica.calendarRequests().find(r => r.id === request.id)!;
    expect(row).toMatchObject({ kind: 'task_alarm', taskId: task.id, title: 'Take out recycling' });
    expect(new Date(row.endAt).getTime()).toBe(0);
  });

  it('suggests a deadline on the calendar only for a task that has a deadline', () => {
    const bare = replica.createTask({ title: 'No date' });
    expect(() => proposeTaskDeviceAction(replica, { taskId: bare.id, action: 'deadline_on_calendar' })).toThrow(/no deadline/);
    const task = withDeadline();
    expect(proposeTaskDeviceAction(replica, { taskId: task.id, action: 'deadline_on_calendar' }).request.taskAction).toBe('deadline_on_calendar');
  });

  it('refuses a time that has passed, a missing time, and a second identical suggestion', () => {
    const task = replica.createTask({ title: 'Call' });
    expect(() => proposeTaskDeviceAction(replica, { taskId: task.id, action: 'alarm' })).toThrow(/needs at/);
    expect(() => proposeTaskDeviceAction(replica, { taskId: task.id, action: 'alarm', at: '2020-01-01T08:00' })).toThrow(/already passed/);
    expect(() => proposeTaskDeviceAction(replica, { taskId: task.id, action: 'alarm', at: '2030-01-01' })).toThrow(/YYYY-MM-DDTHH:MM/);
    proposeTaskDeviceAction(replica, { taskId: task.id, action: 'alarm', at: ahead() });
    expect(() => proposeTaskDeviceAction(replica, { taskId: task.id, action: 'alarm', at: ahead(72) })).toThrow(/already suggested/);
    expect(() => proposeTaskDeviceAction(replica, { taskId: 'nope', action: 'alarm', at: ahead() })).toThrow(/No task/);
  });

  it('records the suggestion in the Activity ledger as a suggestion, and cancelling takes the card back', () => {
    const task = replica.createTask({ title: 'Call', deadline: new Date(Date.now() + 5 * 86400_000).toISOString() });
    const entries: AgentLedgerEntry[] = [];
    const logged = withAgentLedger(replica, e => entries.push(...e));
    const { request } = proposeTaskDeviceAction(logged, { taskId: task.id, action: 'deadline_on_calendar' }, new Date());
    expect(entries[0]).toMatchObject({ action: 'created', subject: 'event', title: 'Call', recordId: request.id });
    expect(entries[0].note).toMatch(/Suggest.*Inbox/);
    expect(cancelCalendarRequest(replica, { id: request.id }).cancelled.status).toBe('cancelled');
  });
});
