/**
 * The skip rule on its own, since the MCP server calls it with no store around
 * it. useTaskStore.test.ts still covers skipNextRecurrence through the store.
 */
import { deadlineOnto, skipPatch } from '../utils/taskSkip';
import { newTaskFromDraft } from '../utils/taskDraft';
import type { Task, TaskDraft } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', vacationMode: false, newTaskDefaults: {}, activeHoursStart: '08:00', activeHoursEnd: '22:00', holidaySet: 'us', customHolidays: [] }),
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

describe('skipPatch', () => {
  it('has nothing to do for a task that does not repeat', () => {
    expect(skipPatch(make({ dueDate: new Date(2026, 2, 10).toISOString() }), '00:00')).toBeNull();
  });

  it('moves a weekly task a week on, counts a counted repeat down, and keeps the grid anchor', () => {
    const task = make({ dueDate: new Date(2030, 2, 10, 9).toISOString(), recurrenceType: 'weekly', recurrenceDays: [], recurrenceCount: 3 });
    const patch = skipPatch(task, '00:00')!;
    expect(new Date(patch.dueDate!).getDate()).toBe(17);
    expect(patch.recurrenceCount).toBe(2);
    expect(patch).toMatchObject({ deferUntil: null, postponeCount: 0, recurrenceAnchorDay: task.recurrenceAnchorDay });
  });

  // Thursdays from Nov 21, 2030; the 28th is Thanksgiving.
  it('moves an occurrence off a holiday and writes the rule\'s own day as the anchor', () => {
    const task = make({ dueDate: new Date(2030, 10, 21, 9).toISOString(), recurrenceType: 'weekly', recurrenceDays: [4], recurrenceHolidays: 'move' });
    expect(task.recurrenceHolidays).toBe('move');
    const patch = skipPatch(task, '00:00')!;
    expect(new Date(patch.dueDate!).getDate()).toBe(29);
    expect(new Date(patch.recurrenceAnchorDate!).getDate()).toBe(28);
  });

  it('clears the anchor again on an ordinary skip', () => {
    const task = { ...make({ dueDate: new Date(2030, 10, 29, 9).toISOString(), recurrenceType: 'weekly', recurrenceDays: [4], recurrenceHolidays: 'move' }), recurrenceAnchorDate: new Date(2030, 10, 28, 9).toISOString() };
    const patch = skipPatch(task, '00:00')!;
    expect(new Date(patch.dueDate!).getDate()).toBe(5);
    expect(patch.recurrenceAnchorDate).toBeNull();
  });

  it('only moves a mid-chain step along when steps do not follow the schedule', () => {
    const task = make({
      dueDate: new Date(2030, 2, 10).toISOString(), recurrenceType: 'weekly',
      chainEnabled: true, chainItems: [{ title: 'A' }, { title: 'B' }] as Task['chainItems'], chainIndex: 0,
    });
    const patch = skipPatch(task, '00:00')!;
    expect(patch.chainIndex).toBe(1);
    expect(patch.dueDate).toBeUndefined();
  });
});

describe('deadlineOnto', () => {
  it('recomputes a relative deadline and keeps a fixed one', () => {
    const due = new Date(2030, 2, 20);
    expect(new Date(deadlineOnto(make({ deadlineOffsetDays: 2 }), due)!).getDate()).toBe(18);
    const fixed = new Date(2030, 1, 1).toISOString();
    expect(deadlineOnto(make({ deadline: fixed }), due)).toBe(fixed);
  });
});
