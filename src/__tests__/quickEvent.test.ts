import { eventMarkerText, parseQuickEvent } from '../utils/quickEvent';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

// Friday Sep 25 2026, 2:25pm.
const now = new Date(2026, 8, 25, 14, 25);
const today = new Date(2026, 8, 25, 0);
const people = [
  { id: 'p1', name: 'Dustin Reyes', nickname: '' },
  { id: 'p2', name: 'Ansley', nickname: '' },
];
const names: Record<string, string> = { p1: 'Dustin', p2: 'Ansley' };
const opts = { people, nameOf: (id: string) => names[id] ?? null, now, today, wallClock: now };

describe('parseQuickEvent', () => {
  it('reads a day, a clock time and a person', () => {
    const draft = parseQuickEvent('lunch w/ @dustin sat 12pm', opts);
    expect(draft.title).toBe('lunch w/ Dustin');
    expect(draft.start).toEqual(new Date(2026, 8, 26, 12, 0));
    expect(draft.end).toEqual(new Date(2026, 8, 26, 13, 0));
    expect(draft.personIds).toEqual(['p1']);
    expect(draft.scheduled).toBe(true);
  });

  it('names everybody mentioned', () => {
    const draft = parseQuickEvent('beach with @dustin and @ansley tomorrow', opts);
    expect(draft.title).toBe('beach with Dustin and Ansley');
    expect(draft.personIds).toEqual(['p1', 'p2']);
  });

  it('uses a representative hour for a day-part word', () => {
    const draft = parseQuickEvent('dinner tomorrow evening', opts);
    expect(draft.start.getHours()).toBe(19);
    expect(draft.start.getDate()).toBe(26);
  });

  it('falls back to 9:00 on a day with no time', () => {
    const draft = parseQuickEvent('dentist monday', opts);
    expect(draft.start).toEqual(new Date(2026, 8, 28, 9, 0));
  });

  it('falls back to the next whole hour today when nothing is read', () => {
    const draft = parseQuickEvent('coffee', opts);
    expect(draft.title).toBe('coffee');
    expect(draft.start).toEqual(new Date(2026, 8, 25, 15, 0));
    expect(draft.scheduled).toBe(false);
  });

  it('leaves an unknown @token as typed and links nobody', () => {
    const draft = parseQuickEvent('call @zed', opts);
    expect(draft.title).toBe('call @zed');
    expect(draft.personIds).toEqual([]);
  });
});

describe('eventMarkerText', () => {
  it('returns the rest of a line that starts with "event:"', () => {
    expect(eventMarkerText('event: lunch w/ @dustin sat 12pm')).toBe('lunch w/ @dustin sat 12pm');
    expect(eventMarkerText('  Event:dinner')).toBe('dinner');
  });

  it('leaves ordinary titles alone', () => {
    expect(eventMarkerText('event planning')).toBeNull();
    expect(eventMarkerText('book the event: venue')).toBeNull();
  });
});
