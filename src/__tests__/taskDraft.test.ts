/**
 * Covers the series builders this module holds. `newTaskFromDraft` and
 * `applyTitleRulesToDraft` are exercised through `useTaskStore.test.ts`, which
 * is where they were tested before they moved here and where the call sites
 * that matter still live.
 */
import { buildSeriesRow, reanchorReminder, NO_RECURRENCE } from '../utils/taskDraft';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      dayResetTime: '00:00',
      vacationMode: false,
      newTaskDefaults: {},
    }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

describe('reanchorReminder', () => {
  it('keeps the time of day while moving the day', () => {
    const moved = reanchorReminder('2026-03-01T09:30:00.000Z', new Date('2026-03-08T00:00:00.000Z'));
    const at = new Date(moved.reminderTime!);
    const original = new Date('2026-03-01T09:30:00.000Z');
    expect(at.getHours()).toBe(original.getHours());
    expect(at.getMinutes()).toBe(original.getMinutes());
    expect(at.getDate()).toBe(8);
  });

  it('has nothing to move when there is no reminder', () => {
    expect(reanchorReminder(null, new Date())).toEqual({
      reminderTime: null,
      reminderUtcOffsetMinutes: null,
    });
  });

  // A set of dates shares an hour, not a moment. Recaptured because a reminder
  // moved onto another day may cross a DST boundary (#1205).
  it('recaptures the UTC offset for the instant it landed on', () => {
    const moved = reanchorReminder('2026-03-01T09:30:00.000Z', new Date('2026-08-08T00:00:00.000Z'));
    expect(moved.reminderUtcOffsetMinutes).toBe(new Date(moved.reminderTime!).getTimezoneOffset());
  });

  it('anchors a relative reminder to its offset from the date', () => {
    const moved = reanchorReminder('2026-03-01T09:30:00.000Z', new Date('2026-03-10T00:00:00.000Z'), 2);
    // Two days before the date it was given.
    expect(new Date(moved.reminderTime!).getDate()).toBe(8);
  });
});

describe('NO_RECURRENCE', () => {
  it('clears the rule', () => {
    expect(NO_RECURRENCE.recurrenceType).toBe('none');
    expect(NO_RECURRENCE.recurrenceDays).toEqual([]);
    expect(NO_RECURRENCE.recurrenceCount).toBeNull();
  });

  // A supply counts down by riding onto the successor a completion spawns, and
  // a series row spawns none — so one left on would sit at its starting number
  // for ever while the thing was actually being used.
  it('clears the supply and the streak, which a series row has no way to run', () => {
    expect(NO_RECURRENCE.supplyCount).toBeNull();
    expect(NO_RECURRENCE.showStreak).toBe(false);
    expect(NO_RECURRENCE.streakRequiresWindow).toBe(false);
  });
});

describe('buildSeriesRow', () => {
  const date = new Date('2026-03-15T12:00:00.000Z');

  it('dates the row and files it under the series', () => {
    const row = buildSeriesRow({ title: 'Walk the dog' }, date, 's1');
    expect(row.title).toBe('Walk the dog');
    expect(row.seriesId).toBe('s1');
    expect(row.dueDate).toBe(date.toISOString());
  });

  // Two schedules for one task. Left in place, every row kept the rule and each
  // completed date spawned an extra occupant of the same series.
  it('strips a recurrence rule the source carried', () => {
    const row = buildSeriesRow(
      { title: 'Walk the dog', recurrenceType: 'weekly', recurrenceInterval: 2 },
      date,
      's1',
    );
    expect(row.recurrenceType).toBe('none');
  });

  // Each date stands on its own; a defer on the source would otherwise hide
  // every date in the set behind that one day.
  it('drops a defer and a pin from the source', () => {
    const row = buildSeriesRow({ title: 'Walk the dog', deferUntil: '2026-04-01T00:00:00.000Z', pinned: true }, date, 's1');
    expect(row.deferUntil).toBeNull();
    expect(row.pinned).toBe(false);
  });

  it('carries the repeat when one is given, and happens once without', () => {
    expect(buildSeriesRow({ title: 'X' }, date, 's1').seriesMonthDays).toEqual([]);

    const repeating = buildSeriesRow({ title: 'X' }, date, 's1', { monthDays: [10, 15], repeatMonths: 2 });
    expect(repeating.seriesMonthDays).toEqual([10, 15]);
    expect(repeating.seriesRepeatMonths).toBe(2);
  });

  // A row cloned from one that was itself spawned by a completion would
  // otherwise read as the follow-up to a completion it has nothing to do with,
  // and undoing that completion would delete it. The rollover sets it itself.
  it('does not inherit the completion link', () => {
    const row = buildSeriesRow({ title: 'X', previousOccurrenceId: 'somewhere' }, date, 's1');
    expect(row.previousOccurrenceId).toBeNull();
  });

  it('recomputes a relative deadline against this row\'s own date', () => {
    const row = buildSeriesRow({ title: 'X', deadlineOffsetDays: 2 }, date, 's1');
    // Two days before the row's own date rather than the source's.
    expect(new Date(row.deadline!).getDate()).toBe(13);
  });

  it('leaves a fixed deadline alone, since it is one absolute target', () => {
    const row = buildSeriesRow({ title: 'X', deadline: '2026-05-01T00:00:00.000Z' }, date, 's1');
    expect(row.deadline).toBe('2026-05-01T00:00:00.000Z');
  });

  it('re-anchors the reminder onto this row\'s day', () => {
    const row = buildSeriesRow({ title: 'X', reminderTime: '2026-03-01T09:30:00.000Z' }, date, 's1');
    expect(new Date(row.reminderTime!).getDate()).toBe(15);
  });
});
