import { makeCategoryGroups } from '../utils/taskGrouping';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  dueDate: null,
  deferUntil: null,
  timeSegments: [],
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceFromCompletion: false,
  tags: [],
  category: null,
  sortOrder: 1,
  focused: false,
  priority: 0,
  effort: 0,
  streakCount: 0,
  streakDate: null,
  parentId: null,
  reminderTime: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
  projectId: null,
  vacationPause: false,
  ...overrides,
});

// Helper: flatten the grouped output into a readable [label-or-taskId] sequence.
const seq = (tasks: Task[]) =>
  makeCategoryGroups(tasks).map(item =>
    item.type === 'header' ? `#${item.label}` : item.task.id,
  );

describe('makeCategoryGroups', () => {
  it('renders a plain, header-less list when no task has a category', () => {
    const tasks = [
      makeTask({ id: 'a', category: null }),
      makeTask({ id: 'b', category: null }),
    ];
    expect(seq(tasks)).toEqual(['a', 'b']);
  });

  it('emits a header per named category, preserving task order within each', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'health' }),
      makeTask({ id: 'b', category: 'health' }),
      makeTask({ id: 'c', category: 'work' }),
    ];
    expect(seq(tasks)).toEqual(['#health', 'a', 'b', '#work', 'c']);
  });

  it('labels the uncategorized group "Other" only when a named category exists', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'health' }),
      makeTask({ id: 'b', category: null }),
    ];
    expect(seq(tasks)).toEqual(['#health', 'a', '#Other', 'b']);
  });

  // Regression: the teleport bug. Previously the uncategorized ("Other") group
  // was always appended last, so an uncategorized task dragged above a named
  // section snapped back down on the post-drop regroup. Group order must follow
  // task (sortOrder/drag) order, so "Other" can come first.
  it('orders the "Other" group by first appearance, not always last', () => {
    const tasks = [
      makeTask({ id: 'dragged-to-top', category: null }),
      makeTask({ id: 'workout', category: 'health' }),
    ];
    expect(seq(tasks)).toEqual(['#Other', 'dragged-to-top', '#health', 'workout']);
  });

  it('keeps a category contiguous even if its tasks reappear later in the list', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'health' }),
      makeTask({ id: 'b', category: null }),
      makeTask({ id: 'c', category: 'health' }),
    ];
    // health first appeared at index 0, so both health tasks group there.
    expect(seq(tasks)).toEqual(['#health', 'a', 'c', '#Other', 'b']);
  });
});
