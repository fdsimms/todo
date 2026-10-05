/**
 * The pure half of updateTask, now that it lives here. useTaskStore.test.ts
 * still covers every rule through the store, which is where the device work
 * around it is; these pin the extracted functions on their own, since the MCP
 * server calls them with no store around them at all.
 */
import { mergeTaskUpdate, nextPinnedOrder, seriesFanOutRows, type TaskUpdateContext } from '../utils/taskUpdate';
import { newTaskFromDraft } from '../utils/taskDraft';
import type { Task, TaskDraft } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', vacationMode: false, newTaskDefaults: {}, activeHoursStart: '08:00', activeHoursEnd: '22:00' }),
  },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: jest.fn(() => ({ categories: [], getCategoryByName: jest.fn().mockReturnValue(null) })) },
}));
jest.mock('../store/useProjectStore', () => ({
  useProjectStore: { getState: jest.fn(() => ({ getProjectById: jest.fn().mockReturnValue(null) })) },
}));

let n = 0;
const make = (draft: Partial<TaskDraft>): Task =>
  newTaskFromDraft({ title: 'Task', ...draft }, '2026-03-01T09:00:00.000Z', ++n, false, `t${n}`);

const ctx: TaskUpdateContext = { scope: 'series', freshPinnedOrder: 7, dayResetTime: '00:00' };

describe('mergeTaskUpdate', () => {
  it('applies the patch and leaves the rest of the row alone', () => {
    const t = make({ notes: 'keep' });
    const next = mergeTaskUpdate(t, { title: 'Renamed' }, ctx);
    expect(next.title).toBe('Renamed');
    expect(next.notes).toBe('keep');
  });

  it('clears the grid anchor when the schedule is written', () => {
    const t = { ...make({ recurrenceType: 'monthly', dueDate: '2026-01-31T12:00:00.000Z' }), recurrenceAnchorDate: '2026-01-31T12:00:00.000Z' };
    expect(mergeTaskUpdate(t, { dueDate: '2026-02-10T12:00:00.000Z' }, ctx).recurrenceAnchorDate).toBeNull();
  });

  // The editor writes every schedule field on every save, so "named" and
  // "changed" have to differ here: a retitle that re-states the same day and
  // rule is a re-save, and a pulled-forward task keeps the grid it was pulled
  // off. A different day, a cleared date or a changed rule is a new schedule.
  it('keeps the grid anchor on a same-day re-save that re-states the schedule', () => {
    const t = { ...make({ recurrenceType: 'weekly', dueDate: '2026-03-03T12:00:00.000Z' }), recurrenceAnchorDate: '2026-03-05T12:00:00.000Z' };
    const next = mergeTaskUpdate(t, { title: 'Renamed', dueDate: '2026-03-03T12:00:00.000Z', recurrenceType: 'weekly' }, ctx);
    expect(next.recurrenceAnchorDate).toBe('2026-03-05T12:00:00.000Z');
  });

  it('clears the grid anchor when the rule changes or the date is cleared', () => {
    const t = { ...make({ recurrenceType: 'weekly', dueDate: '2026-03-03T12:00:00.000Z' }), recurrenceAnchorDate: '2026-03-05T12:00:00.000Z' };
    expect(mergeTaskUpdate(t, { dueDate: '2026-03-03T12:00:00.000Z', recurrenceType: 'monthly' }, ctx).recurrenceAnchorDate).toBeNull();
    expect(mergeTaskUpdate(t, { dueDate: null }, ctx).recurrenceAnchorDate).toBeNull();
  });

  it('re-derives the anchor day from a newly written date', () => {
    // Local noon, not a `...Z` literal: the anchor day is read in local time,
    // and Feb 10 12:00 UTC is already Feb 11 in UTC+14, where CI runs.
    const t = make({ recurrenceType: 'monthly', dueDate: new Date(2026, 0, 31, 12).toISOString() });
    expect(mergeTaskUpdate(t, { dueDate: new Date(2026, 1, 10, 12).toISOString() }, ctx).recurrenceAnchorDay).toBe(10);
  });

  it('leaves the anchors alone on an edit that is not about the schedule', () => {
    const t = { ...make({ recurrenceType: 'monthly', dueDate: '2026-02-28T12:00:00.000Z' }), recurrenceAnchorDay: 31 };
    expect(mergeTaskUpdate(t, { notes: 'x' }, ctx).recurrenceAnchorDay).toBe(31);
  });

  it('stamps a pin rank only on the transition to pinned', () => {
    const t = make({});
    expect(mergeTaskUpdate(t, { pinned: true }, ctx).pinnedOrder).toBe(7);
    const pinned = { ...t, pinned: true, pinnedOrder: 2 };
    expect(mergeTaskUpdate(pinned, { pinned: true }, ctx).pinnedOrder).toBe(2);
  });

  it('drops a follow-up rule once the task no longer repeats', () => {
    const t = make({ recurrenceType: 'weekly', followUpTaskEveryN: 3, followUpTaskTitle: 'Deep clean' });
    expect(t.followUpTaskEveryN).toBe(3);
    const next = mergeTaskUpdate(t, { recurrenceType: 'none' }, ctx);
    expect(next.followUpTaskEveryN).toBeNull();
    expect(next.followUpTaskTitle).toBeNull();
  });

  it('restarts the streak when polarity changes', () => {
    const t = { ...make({}), streakCount: 9 };
    expect(mergeTaskUpdate(t, { polarity: 'negative' }, ctx).streakCount).toBe(0);
  });

  it('keeps the old content as series defaults on an occurrence-only edit', () => {
    const t = make({ title: 'Original' });
    const next = mergeTaskUpdate(t, { title: 'Just this once' }, { ...ctx, scope: 'occurrence' });
    expect(next.seriesDefaults).toEqual({ title: 'Original' });
  });
});

describe('seriesFanOutRows', () => {
  const series = (date: string, over: Partial<Task> = {}) => ({ ...make({ dueDate: date }), seriesId: 's1', ...over });

  it('copies content fields onto the later open dates only', () => {
    const edited = { ...series('2026-03-10T12:00:00.000Z'), notes: 'bring keys' };
    const earlier = series('2026-03-05T12:00:00.000Z');
    const later = series('2026-03-15T12:00:00.000Z');
    const done = series('2026-03-20T12:00:00.000Z', { completed: true });
    const rows = seriesFanOutRows(edited, { notes: 'bring keys' }, [edited, earlier, later, done]);
    expect(rows.map(r => r.id)).toEqual([later.id]);
    expect(rows[0].notes).toBe('bring keys');
    expect(rows[0].dueDate).toBe(later.dueDate);
  });

  it('writes nothing for a field that is not content, or outside a series', () => {
    const edited = series('2026-03-10T12:00:00.000Z');
    const later = series('2026-03-15T12:00:00.000Z');
    expect(seriesFanOutRows(edited, { dueDate: '2026-03-11T12:00:00.000Z' }, [edited, later])).toEqual([]);
    expect(seriesFanOutRows({ ...edited, seriesId: null }, { notes: 'x' }, [edited, later])).toEqual([]);
  });

  it('never leaves a date waiting on itself', () => {
    const edited = series('2026-03-10T12:00:00.000Z');
    const later = series('2026-03-15T12:00:00.000Z');
    const rows = seriesFanOutRows({ ...edited, blockedById: later.id }, { blockedById: later.id }, [edited, later]);
    expect(rows[0].blockedById).toBeNull();
  });
});

describe('nextPinnedOrder', () => {
  it('is one past the highest pinned rank, ignoring unpinned rows', () => {
    expect(nextPinnedOrder([{ ...make({}), pinned: true, pinnedOrder: 4 }, { ...make({}), pinned: false, pinnedOrder: 9 }])).toBe(5);
  });
});
