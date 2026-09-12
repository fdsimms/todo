import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { fetchEvents } from '../utils/calendarSync';
import { isDemoModeActive } from '../utils/demoState';
import type { BusyEvent } from '../utils/calendarBusy';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

jest.mock('../utils/calendarSync', () => ({
  fetchEvents: jest.fn(),
}));

jest.mock('../utils/demoState', () => ({
  isDemoModeActive: jest.fn().mockReturnValue(false),
}));

const event = (id: string, start = '2026-08-27T09:00:00.000Z'): BusyEvent =>
  ({ id, start, end: '2026-08-27T10:00:00.000Z', title: 'Standup', calendarId: 'cal-1' } as BusyEvent);

const readResult = (events: BusyEvent[] = [event('e-1')]) => ({
  events,
  perCalendar: { 'cal-1': { eventCount: events.length, ok: true } },
  calendarsById: { 'cal-1': { title: 'Work', color: '#000' } },
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  useCalendarStore.setState({
    events: [], perCalendar: {}, calendarsById: {}, windowStart: null, windowEnd: null, loaded: false,
    pastEvents: [], pastLoaded: false, pastReadAt: null, handledHistory: {}, handledLoaded: false,
  });
  useSettingsStore.setState({
    calendarReadEnabled: true, calendarIds: ['cal-1'], dayResetTime: '00:00', calendarPeopleHistory: true,
    vacationMode: false, vacationHiddenCalendarIds: [],
  });
});

describe('refresh', () => {
  it('reads the window and marks it loaded', async () => {
    (fetchEvents as jest.Mock).mockResolvedValue(readResult());
    await useCalendarStore.getState().refresh();
    const state = useCalendarStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.events.map(e => e.id)).toEqual(['e-1']);
    expect(state.perCalendar).toEqual({ 'cal-1': { eventCount: 1, ok: true } });
    expect(state.windowStart).not.toBeNull();
  });

  it('clears everything when calendar reading is off, without reading', async () => {
    useSettingsStore.setState({ calendarReadEnabled: false });
    useCalendarStore.setState({ events: [event('stale')], loaded: true });
    await useCalendarStore.getState().refresh();
    expect(fetchEvents).not.toHaveBeenCalled();
    const state = useCalendarStore.getState();
    expect(state.events).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it('clears everything with no calendars chosen', async () => {
    useSettingsStore.setState({ calendarIds: [] });
    await useCalendarStore.getState().refresh();
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().loaded).toBe(false);
  });

  it('leaves out a calendar in vacationHiddenCalendarIds while vacation mode is on', async () => {
    useSettingsStore.setState({
      calendarIds: ['cal-1', 'cal-2'],
      vacationMode: true,
      vacationHiddenCalendarIds: ['cal-2'],
    });
    (fetchEvents as jest.Mock).mockResolvedValue(readResult());
    await useCalendarStore.getState().refresh();
    expect(fetchEvents).toHaveBeenCalledWith(['cal-1'], expect.any(Date), expect.any(Date));
  });

  it('ignores vacationHiddenCalendarIds while vacation mode is off', async () => {
    useSettingsStore.setState({
      calendarIds: ['cal-1', 'cal-2'],
      vacationMode: false,
      vacationHiddenCalendarIds: ['cal-2'],
    });
    (fetchEvents as jest.Mock).mockResolvedValue(readResult());
    await useCalendarStore.getState().refresh();
    expect(fetchEvents).toHaveBeenCalledWith(['cal-1', 'cal-2'], expect.any(Date), expect.any(Date));
  });

  it('clears everything when vacation mode hides every chosen calendar', async () => {
    useSettingsStore.setState({
      calendarIds: ['cal-1'],
      vacationMode: true,
      vacationHiddenCalendarIds: ['cal-1'],
    });
    await useCalendarStore.getState().refresh();
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().loaded).toBe(false);
  });

  // A failed read is not the same as an empty one — see the store's own doc
  // comment on `loaded`. Yesterday's window is a better answer than a
  // confident "nothing on".
  it('keeps the previous window on a failed read and only flips loaded off', async () => {
    (fetchEvents as jest.Mock).mockResolvedValueOnce(readResult([event('e-1')]));
    await useCalendarStore.getState().refresh();
    expect(useCalendarStore.getState().events).toHaveLength(1);

    (fetchEvents as jest.Mock).mockResolvedValueOnce(null);
    await useCalendarStore.getState().refresh();
    const state = useCalendarStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.events).toHaveLength(1);
  });
});

describe('clear', () => {
  it('drops the live window but keeps the answered-history record', () => {
    useCalendarStore.setState({
      events: [event('e-1')], loaded: true, pastEvents: [event('e-2')], pastLoaded: true,
      handledHistory: { 'e-1': '2026-08-01' }, handledLoaded: true,
    });
    useCalendarStore.getState().clear();
    const state = useCalendarStore.getState();
    expect(state.events).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.pastEvents).toEqual([]);
    expect(state.pastLoaded).toBe(false);
    expect(state.handledHistory).toEqual({ 'e-1': '2026-08-01' });
    expect(state.handledLoaded).toBe(true);
  });
});

describe('refreshPast', () => {
  it('reads the past window when the gate allows it', async () => {
    (fetchEvents as jest.Mock).mockResolvedValue(readResult([event('e-old')]));
    await useCalendarStore.getState().refreshPast();
    const state = useCalendarStore.getState();
    expect(state.pastLoaded).toBe(true);
    expect(state.pastEvents.map(e => e.id)).toEqual(['e-old']);
    expect(state.pastReadAt).not.toBeNull();
  });

  it('clears the past window when the person-history setting is off', async () => {
    useSettingsStore.setState({ calendarPeopleHistory: false });
    useCalendarStore.setState({ pastEvents: [event('stale')], pastLoaded: true });
    await useCalendarStore.getState().refreshPast();
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().pastEvents).toEqual([]);
  });

  it('clears the past window during demo mode, even with the setting on', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await useCalendarStore.getState().refreshPast();
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().pastLoaded).toBe(false);
  });

  it('marks pastLoaded false on a failed read', async () => {
    (fetchEvents as jest.Mock).mockResolvedValue(null);
    await useCalendarStore.getState().refreshPast();
    expect(useCalendarStore.getState().pastLoaded).toBe(false);
  });
});

describe('markHistoryHandled', () => {
  it('hydrates from the settings table once, records the answer, and persists it', () => {
    (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify({ 'e-old': '2026-08-01' }));
    useCalendarStore.getState().markHistoryHandled('e-1', '2026-08-27');
    const state = useCalendarStore.getState();
    expect(state.handledLoaded).toBe(true);
    expect(state.handledHistory['e-1']).toBe('2026-08-27');
    expect(state.handledHistory['e-old']).toBe('2026-08-01');
    expect(dbSetSetting).toHaveBeenCalledWith('calendarHistoryHandled', expect.any(String));
  });

  it('does not re-hydrate once the record is already loaded', () => {
    useCalendarStore.setState({ handledHistory: { 'e-1': '2026-08-20' }, handledLoaded: true });
    useCalendarStore.getState().markHistoryHandled('e-2', '2026-08-27');
    expect(dbGetSetting).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().handledHistory).toEqual({
      'e-1': '2026-08-20',
      'e-2': '2026-08-27',
    });
  });

  it('keeps the in-memory record even if persisting throws', () => {
    (dbSetSetting as jest.Mock).mockImplementation(() => { throw new Error('disk full'); });
    expect(() => useCalendarStore.getState().markHistoryHandled('e-1', '2026-08-27')).not.toThrow();
    expect(useCalendarStore.getState().handledHistory['e-1']).toBe('2026-08-27');
  });
});

/**
 * Reads that overlap, and reads that outlive the switch that started them.
 *
 * This store has the most triggers of the four that read from outside the app:
 * the initial mount, the settings subscription and the foreground listener all
 * call `refresh`, and they routinely fire together. See `refreshGuard.ts`.
 */
describe('a read that is no longer the current one', () => {
  const deferredRead = () => {
    let release: (v: unknown) => void = () => {};
    (fetchEvents as jest.Mock).mockReturnValueOnce(
      new Promise(resolve => {
        release = resolve;
      })
    );
    return { release: (v: unknown) => release(v) };
  };

  it('does not put the events back after the feature was switched off', async () => {
    const first = deferredRead();
    const inFlight = useCalendarStore.getState().refresh();
    useCalendarStore.getState().clear();
    first.release(readResult());
    await inFlight;

    const state = useCalendarStore.getState();
    expect(state.events).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.windowStart).toBeNull();
  });

  it('does not put the past window back either', async () => {
    const first = deferredRead();
    const inFlight = useCalendarStore.getState().refreshPast();
    useCalendarStore.getState().clear();
    first.release(readResult());
    await inFlight;

    expect(useCalendarStore.getState().pastEvents).toEqual([]);
    expect(useCalendarStore.getState().pastLoaded).toBe(false);
  });

  // Two refreshes in flight over different windows: the one that started last
  // is the one asking the current question, so it is the one that wins however
  // the two resolve.
  it('lets the later of two overlapping reads win', async () => {
    const first = deferredRead();
    const stale = useCalendarStore.getState().refresh();

    (fetchEvents as jest.Mock).mockResolvedValue(readResult([event('current')]));
    await useCalendarStore.getState().refresh();

    first.release(readResult([event('stale')]));
    await stale;

    expect(useCalendarStore.getState().events.map(e => e.id)).toEqual(['current']);
  });

  // A failed read leaves the previous window in place rather than blanking it,
  // but only while it is still the read anyone is waiting on.
  it('does not blank a newer window with an older read failing', async () => {
    const first = deferredRead();
    const stale = useCalendarStore.getState().refresh();

    (fetchEvents as jest.Mock).mockResolvedValue(readResult([event('current')]));
    await useCalendarStore.getState().refresh();

    first.release(null);
    await stale;

    expect(useCalendarStore.getState().loaded).toBe(true);
  });

  it('lets the next read write normally after a clear', async () => {
    useCalendarStore.getState().clear();
    (fetchEvents as jest.Mock).mockResolvedValue(readResult());
    await useCalendarStore.getState().refresh();
    expect(useCalendarStore.getState().loaded).toBe(true);
  });
});
