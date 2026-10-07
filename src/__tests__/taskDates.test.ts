/**
 * The two steps of giving a task a set of dates, on their own. The store's
 * applyTaskDates runs them with the device work around them, and
 * useTaskStore.test.ts covers that path.
 */
import { calendarDayKey, datesAnchorStep, datesReconcile, seriesRows } from '../utils/taskDates';
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
const make = (draft: Partial<TaskDraft> & Partial<Task>): Task =>
  ({ ...newTaskFromDraft({ title: 'Walk', ...draft }, '2026-03-01T09:00:00.000Z', ++n, false, `t${n}`), ...draft }) as Task;
const day = (d: number) => new Date(2030, 2, d, 9);

describe('datesAnchorStep', () => {
  it('only re-dates a plain task given one date', () => {
    const t = make({ dueDate: day(10).toISOString() });
    expect(datesAnchorStep(t, [t], [day(12)], undefined, () => 'new')).toEqual({ kind: 'plain', patch: { dueDate: day(12).toISOString() } });
  });

  it('forms a set, keeps the anchor on a date that survived, and drops the repeat', () => {
    const t = make({ dueDate: day(10).toISOString(), recurrenceType: 'weekly' });
    const step = datesAnchorStep(t, [t], [day(15), day(10)], undefined, () => 's1');
    expect(step.kind).toBe('series');
    if (step.kind !== 'series') return;
    expect(step).toMatchObject({ seriesId: 's1', anchorKept: true });
    expect(step.patch).toMatchObject({ dueDate: t.dueDate, seriesId: 's1', recurrenceType: 'none' });
  });

  it('dissolves a set to one date, keeping finished dates as unfiled history', () => {
    const a = make({ dueDate: day(10).toISOString(), seriesId: 's' });
    const b = make({ dueDate: day(15).toISOString(), seriesId: 's' });
    const done = make({ dueDate: day(5).toISOString(), seriesId: 's', completed: true });
    const step = datesAnchorStep(a, [a, b, done], [day(10)], undefined, () => 'x');
    expect(step.kind).toBe('dissolve');
    if (step.kind !== 'dissolve') return;
    expect(step.dropped.map(t => t.id)).toEqual([b.id]);
    expect(step.unfiled).toEqual([{ ...done, seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1 }]);
  });
});

describe('datesReconcile', () => {
  it('adds the dates the set gained and removes the ones it lost, never a finished one', () => {
    const anchor = make({ dueDate: day(10).toISOString(), seriesId: 's' });
    const gone = make({ dueDate: day(12).toISOString(), seriesId: 's' });
    const done = make({ dueDate: day(5).toISOString(), seriesId: 's', completed: true });
    const step = datesAnchorStep(anchor, [anchor, gone, done], [day(10), day(20)], undefined, () => 'x');
    if (step.kind !== 'series') throw new Error('expected a series');
    const plan = datesReconcile(seriesRows([anchor, gone, done], 's'), anchor.id, step, undefined, 40);
    expect(plan.removed.map(t => t.id)).toEqual([gone.id]);
    expect(plan.added.map(t => calendarDayKey(new Date(t.dueDate!)))).toEqual([calendarDayKey(day(20))]);
    expect(plan.added[0].sortOrder).toBe(41);
    expect(plan.rewritten.map(t => t.id).sort()).toEqual([anchor.id, done.id].sort());
  });
});
