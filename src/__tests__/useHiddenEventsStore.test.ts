import { useHiddenEventsStore } from '../store/useHiddenEventsStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { hiddenEventKey } from '../utils/hiddenEvents';
import type { BusyEvent } from '../utils/calendarBusy';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

const event = (overrides: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'evt-1',
  title: 'Standup',
  start: '2026-01-10T09:00:00.000Z',
  end: '2026-01-10T09:15:00.000Z',
  allDay: false,
  calendarId: 'cal-1',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  useHiddenEventsStore.setState({ hiddenByKey: {}, loaded: false });
});

describe('initialize', () => {
  it('starts empty with no stored data', () => {
    useHiddenEventsStore.getState().initialize();
    expect(useHiddenEventsStore.getState().hiddenByKey).toEqual({});
    expect(useHiddenEventsStore.getState().loaded).toBe(true);
  });

  it('loads a persisted hide for an occurrence not yet over', () => {
    const key = hiddenEventKey(event());
    const stored = { [key]: { key, eventId: 'evt-1', eventStart: '2099-01-01T09:00:00.000Z', eventEnd: '2099-01-01T09:15:00.000Z' } };
    (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify(stored));
    useHiddenEventsStore.getState().initialize();
    expect(useHiddenEventsStore.getState().hiddenByKey).toEqual(stored);
  });

  it('prunes a hide whose occurrence has already ended, and persists the prune', () => {
    const key = 'evt-1|2000-01-01T09:00:00.000Z';
    const stored = { [key]: { key, eventId: 'evt-1', eventStart: '2000-01-01T09:00:00.000Z', eventEnd: '2000-01-01T09:15:00.000Z' } };
    (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify(stored));
    useHiddenEventsStore.getState().initialize();
    expect(useHiddenEventsStore.getState().hiddenByKey).toEqual({});
    expect(dbSetSetting).toHaveBeenCalledWith('hidden_calendar_events', JSON.stringify({}));
  });

  it('tolerates corrupt stored JSON by starting empty', () => {
    (dbGetSetting as jest.Mock).mockReturnValue('not json');
    useHiddenEventsStore.getState().initialize();
    expect(useHiddenEventsStore.getState().hiddenByKey).toEqual({});
  });
});

describe('hideEvent', () => {
  it('stores the hide and persists it', () => {
    const e = event();
    useHiddenEventsStore.getState().hideEvent(e);
    const key = hiddenEventKey(e);
    expect(useHiddenEventsStore.getState().hiddenByKey[key]).toMatchObject({ eventId: 'evt-1' });
    expect(dbSetSetting).toHaveBeenCalledWith('hidden_calendar_events', expect.stringContaining(key));
  });

  it('leaves other hidden events alone', () => {
    const e = event();
    const other = event({ id: 'evt-2', start: '2026-01-11T09:00:00.000Z' });
    useHiddenEventsStore.getState().hideEvent(other);
    useHiddenEventsStore.getState().hideEvent(e);
    expect(useHiddenEventsStore.getState().isHidden(e)).toBe(true);
    expect(useHiddenEventsStore.getState().isHidden(other)).toBe(true);
  });
});

describe('unhideEvent', () => {
  it('removes the hide and persists the removal', () => {
    const e = event();
    useHiddenEventsStore.getState().hideEvent(e);
    useHiddenEventsStore.getState().unhideEvent(e);
    expect(useHiddenEventsStore.getState().hiddenByKey).toEqual({});
  });

  it('is a no-op for an event that was never hidden', () => {
    const e = event();
    useHiddenEventsStore.getState().unhideEvent(e);
    expect(dbSetSetting).not.toHaveBeenCalled();
  });

  it('does not unhide a different occurrence of the same series', () => {
    const monday = event({ start: '2026-01-05T09:00:00.000Z' });
    const tuesday = event({ start: '2026-01-06T09:00:00.000Z' });
    useHiddenEventsStore.getState().hideEvent(monday);
    useHiddenEventsStore.getState().hideEvent(tuesday);
    useHiddenEventsStore.getState().unhideEvent(monday);
    expect(useHiddenEventsStore.getState().isHidden(monday)).toBe(false);
    expect(useHiddenEventsStore.getState().isHidden(tuesday)).toBe(true);
  });
});

describe('isHidden', () => {
  it('is true only for an event that was hidden', () => {
    const e = event();
    useHiddenEventsStore.getState().hideEvent(e);
    expect(useHiddenEventsStore.getState().isHidden(e)).toBe(true);
    expect(useHiddenEventsStore.getState().isHidden(event({ id: 'evt-2' }))).toBe(false);
  });
});
