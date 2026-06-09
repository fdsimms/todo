import { makeCategoryGroups, resolveDrop, type CategoryListItem } from '../utils/taskGrouping';
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
  // Every group always gets a header — including the uncategorized "Other"
  // group — so a task is never rendered in a header-less region and the
  // headings can't all disappear once every task is uncategorized.
  it('always heads the uncategorized group with "Other", even with no named category', () => {
    const tasks = [
      makeTask({ id: 'a', category: null }),
      makeTask({ id: 'b', category: null }),
    ];
    expect(seq(tasks)).toEqual(['#Other', 'a', 'b']);
  });

  it('emits a header per named category, preserving task order within each', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'health' }),
      makeTask({ id: 'b', category: 'health' }),
      makeTask({ id: 'c', category: 'work' }),
    ];
    expect(seq(tasks)).toEqual(['#health', 'a', 'b', '#work', 'c']);
  });

  it('heads the uncategorized group with "Other" alongside named categories', () => {
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

// Readable view of a header/task layout.
const layoutSeq = (items: CategoryListItem[]) =>
  items.map(item => (item.type === 'header' ? `#${item.label}` : item.task.id));

const noUpcoming = { isUpcoming: () => false, showUpcoming: false };

describe('resolveDrop', () => {
  it('persists the dropped order and rebuilds matching groups', () => {
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'workout', category: 'health' }) },
      { type: 'task', task: makeTask({ id: 'test', category: 'health' }) },
    ];
    const { taskIds, categoryUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(taskIds).toEqual(['workout', 'test']);
    expect(categoryUpdates).toEqual([]);
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', 'test']);
  });

  it('recategorizes a task dropped under a different section header', () => {
    // "Go outside" (uncategorized) dragged up under the HEALTH header.
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'workout', category: 'health' }) },
      { type: 'task', task: makeTask({ id: 'go-outside', category: null }) },
    ];
    const { categoryUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(categoryUpdates).toEqual([{ id: 'go-outside', category: 'health' }]);
    // No stray "Other" header: both tasks now sit in HEALTH, in drop order.
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', 'go-outside']);
  });

  // Regression: dragging a categorized task to the very top (above every
  // header) used to make it uncategorized and spawn a phantom "Other" header
  // wedged into the list. A task above the first header now keeps its category.
  it('does NOT spawn a phantom "Other" header when a task is dragged to the top', () => {
    const reordered: CategoryListItem[] = [
      { type: 'task', task: makeTask({ id: 'workout', category: 'health' }) },
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'test', category: 'health' }) },
    ];
    const { categoryUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(categoryUpdates).toEqual([]);
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', 'test']);
  });

  it('uncategorizes a task dropped under the "Other" header', () => {
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'workout', category: 'health' }) },
      { type: 'header', label: 'Other' },
      { type: 'task', task: makeTask({ id: 'test', category: 'health' }) },
    ];
    const { categoryUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(categoryUpdates).toEqual([{ id: 'test', category: null }]);
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', '#Other', 'test']);
  });

  it('keeps upcoming "Later Today" tasks in their own section, never recategorized', () => {
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'workout', category: 'health' }) },
      { type: 'header', label: 'Later Today' },
      { type: 'task', task: makeTask({ id: 'upcoming', category: null }) },
    ];
    const { categoryUpdates, settled } = resolveDrop(reordered, {
      isUpcoming: id => id === 'upcoming',
      showUpcoming: true,
    });
    expect(categoryUpdates).toEqual([]);
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', '#Later Today', 'upcoming']);
  });

  it('produces a settled layout identical to a fresh regroup of the same tasks', () => {
    // This invariant is what lets the screen skip the post-drop resync without
    // the visible list drifting from the store-derived list.
    const workout = makeTask({ id: 'workout', category: 'health' });
    const test = makeTask({ id: 'test', category: null });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: workout },
      { type: 'header', label: 'Other' },
      { type: 'task', task: test },
    ];
    const { settled } = resolveDrop(reordered, noUpcoming);
    // The store will end up with these task objects, in this order:
    const fromStore = makeCategoryGroups([workout, test]);
    expect(layoutSeq(settled)).toEqual(layoutSeq(fromStore));
  });
});
