import { BOOK_LEAD_DAYS, bookDueDay, bookEventSourceOf, bookSourceId, bookTaskNotes, bookTaskTitle, wantsBookTask } from '../utils/savedEventTasks';
import type { SavedEvent } from '../utils/savedEvents';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

const event = (over: Partial<SavedEvent> = {}): SavedEvent => ({
  title: 'Optometrist', location: null, place: null, durationMinutes: 60, alertMinutes: null,
  availability: 'busy', calendarTitle: null, at: 1,
  lastStart: new Date(2025, 9, 13, 9).toISOString(), bookEveryMonths: 12, bookDeclinedFor: null,
  ...over,
});

describe('bookSourceId', () => {
  it('names the event and the day of the last one', () => {
    expect(bookSourceId(event())).toBe('optometrist|2025-10-13');
  });

  it('is null with no interval or nothing to count from', () => {
    expect(bookSourceId(event({ bookEveryMonths: null }))).toBeNull();
    expect(bookSourceId(event({ lastStart: null }))).toBeNull();
  });
});

describe('bookDueDay', () => {
  it('is the interval after the last one, less the lead time', () => {
    const due = bookDueDay(event())!;
    const expected = new Date(2026, 9, 13);
    expected.setDate(expected.getDate() - BOOK_LEAD_DAYS);
    expect(due).toEqual(expected);
  });

  it('never lands on or before the last one', () => {
    expect(bookDueDay(event({ bookEveryMonths: 1 }))).toEqual(new Date(2025, 9, 14));
  });
});

describe('wantsBookTask', () => {
  it('asks from the due day on', () => {
    const due = bookDueDay(event())!;
    expect(wantsBookTask(event(), new Date(due.getTime() - 86_400_000))).toBe(false);
    expect(wantsBookTask(event(), due)).toBe(true);
    expect(wantsBookTask(event(), new Date(2027, 0, 1))).toBe(true);
  });

  it('stays quiet for a cycle the person declined, and asks again for the next one', () => {
    const declined = event({ bookDeclinedFor: event().lastStart });
    expect(wantsBookTask(declined, new Date(2027, 0, 1))).toBe(false);
    const nextCycle = { ...declined, lastStart: new Date(2026, 9, 1, 9).toISOString() };
    expect(wantsBookTask(nextCycle, new Date(2027, 9, 1))).toBe(true);
  });

  it('asks nothing without an interval', () => {
    expect(wantsBookTask(event({ bookEveryMonths: null }), new Date(2030, 0, 1))).toBe(false);
  });
});

it('reads its source id off a task of its own kind only', () => {
  expect(bookEventSourceOf({ generatedKind: 'bookEvent', generatedSourceId: 'x|2025-10-13' })).toBe('x|2025-10-13');
  expect(bookEventSourceOf({ generatedKind: 'snackNudge', generatedSourceId: 'x' })).toBeNull();
});

it('says what to do and why', () => {
  expect(bookTaskTitle('Optometrist')).toBe('Book Optometrist');
  expect(bookTaskNotes(event())).toMatch(/^The last one was on .+2025\. Set to every 12 months in Settings › Calendar › Saved events\.$/);
});
