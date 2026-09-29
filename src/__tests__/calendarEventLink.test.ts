// #2950: the calendar server's id a meal's or a deadline's event is kept
// under beside its local EventKit id, so a backup restored on a new phone
// finds the old phone's events instead of writing each one again.

const mockCreate = jest.fn();
const mockMove = jest.fn();
const mockDelete = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createAllDayEvent: (...args: unknown[]) => mockCreate(...args),
  moveAllDayEvent: (...args: unknown[]) => mockMove(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDelete(...args),
}));

const mockExternalIds = jest.fn();
const mockEventsWithExternalId = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({
  externalIdentifiers: (ids: string[]) => mockExternalIds(ids),
  eventsWithExternalIdentifier: (id: string) => mockEventsWithExternalId(id),
}), { virtual: true });

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import {
  NO_EVENT_LINK,
  adoptableEventId,
  adoptableTimeBlockId,
  eventsWithExternalId,
  externalIdAfterWrite,
  readExternalEventId,
  writeAllDayEvent,
  type ExternalEventMatch,
} from '../utils/calendarEventLink';

const FIELDS = { title: 'Dinner: Chili', date: new Date(2026, 7, 13) };
const match = (id: string, over: Partial<ExternalEventMatch> = {}): ExternalEventMatch =>
  ({ id, allDay: true, calendarId: 'cal-family', ...over });

beforeEach(() => {
  mockDemoActive = false;
  mockCreate.mockReset().mockResolvedValue('evt-new');
  // EventKit reports the same id back for an event rewritten in place.
  mockMove.mockReset().mockImplementation((id: string) => Promise.resolve(id));
  mockDelete.mockReset().mockResolvedValue(undefined);
  // The server knows every event by "ext-" and its local id.
  mockExternalIds.mockReset().mockImplementation((ids: string[]) =>
    Promise.resolve(Object.fromEntries(ids.map(id => [id, `ext-${id}`]))));
  mockEventsWithExternalId.mockReset().mockResolvedValue([]);
});

describe('adoptableEventId', () => {
  it('adopts the one all-day event found, whichever calendar it is in', () => {
    // The calendar setting isn't in a backup, so a new phone may well have
    // picked it again as another calendar; the rewrite moves the event there.
    expect(adoptableEventId([match('evt-a', { calendarId: 'cal-other' })], 'cal-family')).toBe('evt-a');
  });

  it('adopts nothing when nothing was found', () => {
    expect(adoptableEventId([], 'cal-family')).toBeNull();
  });

  it('never adopts a timed event: both mirrors only write all-day ones', () => {
    expect(adoptableEventId([match('evt-a', { allDay: false })], 'cal-family')).toBeNull();
    // And a timed one beside the all-day one doesn't count as a second copy.
    expect(adoptableEventId([match('evt-a', { allDay: false }), match('evt-b')], 'cal-family')).toBe('evt-b');
  });

  it('chooses between copies by the calendar picked now, as Apple says to', () => {
    const copies = [match('evt-a', { calendarId: 'cal-work' }), match('evt-b', { calendarId: 'cal-family' })];
    expect(adoptableEventId(copies, 'cal-family')).toBe('evt-b');
  });

  it('refuses to guess between copies when the picked calendar doesn\'t settle it', () => {
    expect(adoptableEventId([match('evt-a'), match('evt-b')], 'cal-family')).toBeNull();
    expect(adoptableEventId(
      [match('evt-a', { calendarId: 'cal-work' }), match('evt-b', { calendarId: 'cal-home' })],
      'cal-family',
    )).toBeNull();
    expect(adoptableEventId(
      [match('evt-a', { calendarId: null }), match('evt-b', { calendarId: null })],
      'cal-family',
    )).toBeNull();
  });

  it('counts one event reported twice once', () => {
    expect(adoptableEventId([match('evt-a'), match('evt-a')], 'cal-family')).toBe('evt-a');
  });
});

describe('adoptableTimeBlockId', () => {
  it('adopts exactly one event, timed or all-day, in any calendar', () => {
    expect(adoptableTimeBlockId([match('blk', { allDay: false, calendarId: null })])).toBe('blk');
    expect(adoptableTimeBlockId([match('blk')])).toBe('blk');
    expect(adoptableTimeBlockId([match('blk'), match('blk')])).toBe('blk');
  });

  it('adopts nothing from none or several, since no setting names the block\'s calendar', () => {
    expect(adoptableTimeBlockId([])).toBeNull();
    expect(adoptableTimeBlockId([match('a'), match('b', { calendarId: 'cal-work' })])).toBeNull();
  });
});

describe('externalIdAfterWrite', () => {
  it('takes the id read back for the event just written', () => {
    expect(externalIdAfterWrite('ext-new', 'evt-2', { eventId: 'evt-1', externalId: 'ext-old' })).toBe('ext-new');
  });

  it('keeps the one it knew when the read gave nothing and the event is the same one', () => {
    expect(externalIdAfterWrite(null, 'evt-1', { eventId: 'evt-1', externalId: 'ext-1' })).toBe('ext-1');
  });

  it('keeps nothing for a different event it never read one for', () => {
    expect(externalIdAfterWrite(null, 'evt-2', { eventId: 'evt-1', externalId: 'ext-1' })).toBeNull();
    expect(externalIdAfterWrite(null, 'evt-new', NO_EVENT_LINK)).toBeNull();
  });
});

describe('the bridge door', () => {
  it('reads a server id, and nothing for an id the bridge left out', async () => {
    expect(await readExternalEventId('evt-1')).toBe('ext-evt-1');
    mockExternalIds.mockResolvedValue({});
    expect(await readExternalEventId('evt-1')).toBeNull();
  });

  it('answers nothing when the bridge call fails', async () => {
    mockExternalIds.mockRejectedValue(new Error('no module'));
    mockEventsWithExternalId.mockRejectedValue(new Error('no module'));
    expect(await readExternalEventId('evt-1')).toBeNull();
    expect(await eventsWithExternalId('ext-1')).toEqual([]);
  });

  it('answers nothing, and asks nothing, in demo mode', async () => {
    mockDemoActive = true;
    mockEventsWithExternalId.mockResolvedValue([match('evt-a')]);
    expect(await readExternalEventId('evt-1')).toBeNull();
    expect(await eventsWithExternalId('ext-1')).toEqual([]);
    expect(mockExternalIds).not.toHaveBeenCalled();
    expect(mockEventsWithExternalId).not.toHaveBeenCalled();
  });
});

describe('writeAllDayEvent', () => {
  it('writes a fresh event for a row with none, and links its server id', async () => {
    expect(await writeAllDayEvent(NO_EVENT_LINK, 'cal-family', FIELDS))
      .toEqual({ eventId: 'evt-new', externalId: 'ext-evt-new' });
    expect(mockCreate).toHaveBeenCalledWith('cal-family', FIELDS);
    expect(mockEventsWithExternalId).not.toHaveBeenCalled();
  });

  it('moves the linked event and reads its server id, so a row written before this gains one', async () => {
    expect(await writeAllDayEvent({ eventId: 'evt-1', externalId: null }, 'cal-family', FIELDS))
      .toEqual({ eventId: 'evt-1', externalId: 'ext-evt-1' });
    expect(mockMove).toHaveBeenCalledWith('evt-1', 'cal-family', FIELDS);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps the server id it had when the bridge can\'t read one', async () => {
    mockExternalIds.mockResolvedValue({});
    expect(await writeAllDayEvent({ eventId: 'evt-1', externalId: 'ext-1' }, 'cal-family', FIELDS))
      .toEqual({ eventId: 'evt-1', externalId: 'ext-1' });
  });

  // The restore: the old phone's local id names nothing here, and the old
  // phone's event came down from the calendar account under its server id.
  it('finds the event by its server id when the local id no longer resolves, and adopts it', async () => {
    mockMove.mockImplementation((id: string) => Promise.resolve(id === 'evt-old-phone' ? null : id));
    mockEventsWithExternalId.mockResolvedValue([match('evt-this-phone')]);
    mockExternalIds.mockResolvedValue({});

    const link = await writeAllDayEvent({ eventId: 'evt-old-phone', externalId: 'ext-1' }, 'cal-family', FIELDS);

    expect(link).toEqual({ eventId: 'evt-this-phone', externalId: 'ext-1' });
    expect(mockEventsWithExternalId).toHaveBeenCalledWith('ext-1');
    expect(mockMove).toHaveBeenLastCalledWith('evt-this-phone', 'cal-family', FIELDS);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('still clears the old id before looking, so a refused move leaves no copy behind', async () => {
    mockMove.mockImplementation((id: string) => Promise.resolve(id === 'evt-1' ? null : id));
    mockEventsWithExternalId.mockResolvedValue([]);

    expect(await writeAllDayEvent({ eventId: 'evt-1', externalId: 'ext-1' }, 'cal-family', FIELDS))
      .toEqual({ eventId: 'evt-new', externalId: 'ext-evt-new' });
    expect(mockDelete).toHaveBeenCalledWith('evt-1');
    expect(mockDelete.mock.invocationCallOrder[0])
      .toBeLessThan(mockEventsWithExternalId.mock.invocationCallOrder[0]);
  });

  it('writes a fresh event, as before, when the copies found don\'t settle which is the row\'s', async () => {
    mockMove.mockImplementation((id: string) => Promise.resolve(id === 'evt-old-phone' ? null : id));
    mockEventsWithExternalId.mockResolvedValue([match('evt-a'), match('evt-b')]);

    expect(await writeAllDayEvent({ eventId: 'evt-old-phone', externalId: 'ext-1' }, 'cal-family', FIELDS))
      .toEqual({ eventId: 'evt-new', externalId: 'ext-evt-new' });
    expect(mockMove).toHaveBeenCalledTimes(1);
  });

  it('writes a fresh event beside an adopted one it can\'t move, and leaves the adopted one alone', async () => {
    mockMove.mockResolvedValue(null);
    mockEventsWithExternalId.mockResolvedValue([match('evt-read-only')]);

    expect((await writeAllDayEvent({ eventId: 'evt-old-phone', externalId: 'ext-1' }, 'cal-family', FIELDS)).eventId)
      .toBe('evt-new');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('evt-old-phone');
  });

  it('has nothing to look up for a row that never read a server id', async () => {
    mockMove.mockResolvedValue(null);
    await writeAllDayEvent({ eventId: 'evt-old-phone', externalId: null }, 'cal-family', FIELDS);
    expect(mockEventsWithExternalId).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });

  it('links nothing when every write failed, so the next reconcile tries again', async () => {
    mockMove.mockResolvedValue(null);
    mockCreate.mockResolvedValue(null);
    expect(await writeAllDayEvent({ eventId: 'evt-1', externalId: 'ext-1' }, 'cal-family', FIELDS))
      .toEqual(NO_EVENT_LINK);
  });
});
