import type { CalendarRequest } from '../types';

let mockRows: CalendarRequest[] = [];
let mockDemo = false;
let mockPermission = 'granted';
let mockSettings = { calendarRequestDeviceId: 'me' as string | null, calendarRequestCalendarId: 'cal-1' as string | null };
const mockSave = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../db/database', () => ({
  dbGetAllCalendarRequests: () => mockRows.map(r => ({ ...r })),
  dbGetCalendarRequest: (id: string) => mockRows.find(r => r.id === id) ?? null,
  dbGetDeviceId: () => 'me',
  dbResolveCalendarRequest: (id: string, outcome: Partial<CalendarRequest>) => {
    mockRows = mockRows.map(r => (r.id === id ? { ...r, ...outcome } : r));
  },
  dbDeleteCalendarRequests: (ids: string[]) => {
    mockRows = mockRows.filter(r => !ids.includes(r.id));
  },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));
jest.mock('../utils/calendarSync', () => ({
  getCalendarPermission: () => Promise.resolve(mockPermission),
  saveEventDirect: (fields: unknown) => mockSave(fields),
}));
jest.mock('../utils/calendarEventLink', () => ({
  readExternalEventId: () => Promise.resolve('server-1'),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo }));

import { drainCalendarRequests } from '../utils/calendarRequestDrain';

function request(over: Partial<CalendarRequest> = {}): CalendarRequest {
  const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return {
    id: 'r1',
    title: 'Dentist',
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    allDay: false,
    location: null,
    notes: null,
    status: 'pending',
    failureReason: null,
    eventExternalId: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  mockRows = [request()];
  mockDemo = false;
  mockPermission = 'granted';
  mockSettings = { calendarRequestDeviceId: 'me', calendarRequestCalendarId: 'cal-1' };
  mockSave.mockReset().mockResolvedValue({ id: 'local-1', calendarId: 'cal-1' });
});

describe('drainCalendarRequests', () => {
  it('writes a pending request into the chosen calendar and records the server id', async () => {
    await drainCalendarRequests();
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dentist', calendarId: 'cal-1' }));
    expect(mockRows[0]).toMatchObject({ status: 'written', eventExternalId: 'server-1' });
    expect(mockRows[0].resolvedAt).not.toBeNull();
  });

  it('does nothing on a device that is not the writer', async () => {
    mockSettings.calendarRequestDeviceId = 'other';
    await drainCalendarRequests();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRows[0].status).toBe('pending');
  });

  it('does nothing in demo mode, leaving the request for the real database', async () => {
    mockDemo = true;
    await drainCalendarRequests();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRows[0].status).toBe('pending');
  });

  it('leaves the request pending without calendar access, and never asks', async () => {
    mockPermission = 'undetermined';
    await drainCalendarRequests();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRows[0].status).toBe('pending');
  });

  it('marks a refused write as failed with a reason', async () => {
    mockSave.mockResolvedValue(null);
    await drainCalendarRequests();
    expect(mockRows[0]).toMatchObject({ status: 'failed', failureReason: 'The calendar did not accept it.' });
  });

  it('fails a request that was already over instead of writing it', async () => {
    mockRows = [request({ endAt: new Date(Date.now() - 1000).toISOString() })];
    await drainCalendarRequests();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRows[0].status).toBe('failed');
  });

  it('skips a request cancelled before its turn', async () => {
    mockRows = [request({ status: 'cancelled' })];
    await drainCalendarRequests();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('collapses overlapping calls so a request is written once', async () => {
    await Promise.all([drainCalendarRequests(), drainCalendarRequests(), drainCalendarRequests()]);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
