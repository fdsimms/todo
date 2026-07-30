import {
  makeCategoryGroups,
  resolveDrop,
  resolveCategoryReorder,
  categoryHeaderRange,
  flattenLaterSections,
  laterTaskOrder,
  isLaterHeader,
  type CategoryListItem,
} from '../utils/taskGrouping';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  dueDate: null,
  deadline: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  tags: [],
  category: null,
  sortOrder: 1,
  focused: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  parentId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  ...overrides,
});

// Helper: flatten the grouped output into a readable [label-or-taskId] sequence.
const seq = (tasks: Task[], categoryOrder?: string[]) =>
  makeCategoryGroups(tasks, categoryOrder).map(item =>
    item.type === 'header' ? `#${item.label}` : item.task.id,
  );

describe('makeCategoryGroups', () => {
  // Uncategorized tasks are a header-less group at the top, so an all-
  // uncategorized list is simply a flat list with no headers.
  it('renders uncategorized tasks header-less', () => {
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

  it('renders the header-less uncategorized group first, before named categories', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'health' }),
      makeTask({ id: 'b', category: null }),
    ];
    expect(seq(tasks)).toEqual(['b', '#health', 'a']);
  });

  // Regression: groups used to render in first-task-appearance order, which
  // let a drag reshuffle the categories themselves. Group order is now fixed
  // regardless of task order.
  it('keeps group order fixed no matter how tasks are ordered', () => {
    const tasks = [
      makeTask({ id: 'w', category: 'work' }),
      makeTask({ id: 'h', category: 'health' }),
      makeTask({ id: 'u', category: null }),
    ];
    expect(seq(tasks)).toEqual(['u', '#health', 'h', '#work', 'w']);
  });

  it('orders named categories by the provided categoryOrder, with unknowns alphabetical after', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'alpha' }),
      makeTask({ id: 'z', category: 'zeta' }),
      makeTask({ id: 'm', category: 'mid' }),
    ];
    expect(seq(tasks, ['zeta', 'mid'])).toEqual(['#zeta', 'z', '#mid', 'm', '#alpha', 'a']);
  });

  it('keeps a category contiguous even if its tasks are interleaved in the input', () => {
    const tasks = [
      makeTask({ id: 'a', category: 'health' }),
      makeTask({ id: 'b', category: null }),
      makeTask({ id: 'c', category: 'health' }),
    ];
    expect(seq(tasks)).toEqual(['b', '#health', 'a', 'c']);
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
    // No stray "Uncategorized" header: both tasks now sit in HEALTH, in drop order.
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', 'go-outside']);
  });

  // Dragging a task above every header deliberately uncategorizes it, and the
  // the loose top group renders first, so the task stays where it was dropped.
  it('uncategorizes a task dragged above every named header', () => {
    const reordered: CategoryListItem[] = [
      { type: 'task', task: makeTask({ id: 'workout', category: 'health' }) },
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'test', category: 'health' }) },
    ];
    const { categoryUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(categoryUpdates).toEqual([{ id: 'workout', category: null }]);
    expect(layoutSeq(settled)).toEqual(['workout', '#health', 'test']);
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
      { type: 'task', task: test },
      { type: 'header', label: 'health' },
      { type: 'task', task: workout },
    ];
    const { settled } = resolveDrop(reordered, noUpcoming);
    // The store will end up with these task objects, in this order:
    const fromStore = makeCategoryGroups([workout, test]);
    expect(layoutSeq(settled)).toEqual(layoutSeq(fromStore));
  });
});

describe('categoryHeaderRange', () => {
  it('spans from the first to the last real category header', () => {
    const data: CategoryListItem[] = [
      { type: 'task', task: makeTask({ id: 'loose', category: null }) },
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'a', category: 'health' }) },
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'b', category: 'work' }) },
    ];
    expect(categoryHeaderRange(data)).toEqual([1, 3]);
  });

  it('excludes the trailing "Later Today" header from the range', () => {
    const data: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: makeTask({ id: 'a', category: 'health' }) },
      { type: 'header', label: 'work' },
      { type: 'header', label: 'Later Today' },
      { type: 'task', task: makeTask({ id: 'b', category: null }) },
    ];
    expect(categoryHeaderRange(data)).toEqual([0, 2]);
  });

  it('returns null when there are no category headers', () => {
    const data: CategoryListItem[] = [
      { type: 'task', task: makeTask({ id: 'a', category: null }) },
    ];
    expect(categoryHeaderRange(data)).toBeNull();
  });
});

describe('resolveCategoryReorder', () => {
  it('reads the new category order off the dragged header sequence', () => {
    const health = makeTask({ id: 'workout', category: 'health' });
    const work = makeTask({ id: 'meeting', category: 'work' });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'work' },
      { type: 'task', task: work },
      { type: 'header', label: 'health' },
      { type: 'task', task: health },
    ];
    const { categoryOrder, settled } = resolveCategoryReorder(reordered, noUpcoming);
    expect(categoryOrder).toEqual(['work', 'health']);
    expect(layoutSeq(settled)).toEqual(['#work', 'meeting', '#health', 'workout']);
  });

  it('never changes a task\'s own category, even if it ends up spliced mid-drag', () => {
    // The dragged header can transiently land between another section's
    // tasks; only the header sequence should matter, not raw positions.
    const health = makeTask({ id: 'workout', category: 'health' });
    const work1 = makeTask({ id: 'meeting', category: 'work' });
    const work2 = makeTask({ id: 'standup', category: 'work' });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'work' },
      { type: 'task', task: work1 },
      { type: 'header', label: 'health' },
      { type: 'task', task: health },
      { type: 'task', task: work2 },
    ];
    const { categoryOrder, settled } = resolveCategoryReorder(reordered, noUpcoming);
    expect(categoryOrder).toEqual(['work', 'health']);
    expect(layoutSeq(settled)).toEqual(['#work', 'meeting', 'standup', '#health', 'workout']);
  });

  it('keeps upcoming "Later Today" tasks in their own trailing section', () => {
    const health = makeTask({ id: 'workout', category: 'health' });
    const upcoming = makeTask({ id: 'later-task', category: null });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: health },
      { type: 'header', label: 'Later Today' },
      { type: 'task', task: upcoming },
    ];
    const { categoryOrder, settled } = resolveCategoryReorder(reordered, {
      isUpcoming: id => id === 'later-task',
      showUpcoming: true,
    });
    expect(categoryOrder).toEqual(['health']);
    expect(layoutSeq(settled)).toEqual(['#health', 'workout', '#Later Today', 'later-task']);
  });

  // A category with no visible task today never gets a header to drag, so it
  // wouldn't appear in the raw dragged sequence at all. Persisting only that
  // partial order would silently reassign every other category's sortOrder
  // too, so hidden categories must keep their existing relative slot.
  it('keeps a category absent from today\'s headers in its existing relative slot', () => {
    const work = makeTask({ id: 'meeting', category: 'work' });
    const health = makeTask({ id: 'workout', category: 'health' });
    // Only "work" and "health" have a visible task today; "chores" has none
    // and so never appears as a header in the dragged sequence.
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'task', task: health },
      { type: 'header', label: 'work' },
      { type: 'task', task: work },
    ];
    const { categoryOrder } = resolveCategoryReorder(reordered, {
      ...noUpcoming,
      fullCategoryOrder: ['work', 'chores', 'health'],
    });
    expect(categoryOrder).toEqual(['health', 'chores', 'work']);
  });
});

// Readable view of a flattened Later layout.
const laterSeq = (items: ReturnType<typeof flattenLaterSections>) =>
  items.map(item => (item.type === 'header' ? `#${item.label}` : item.task.id));

describe('flattenLaterSections', () => {
  it('flattens sections into header + task items in order', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const c = makeTask({ id: 'c' });
    const flattened = flattenLaterSections([
      { title: 'TODAY — EVENING', data: [a, b] },
      { title: 'TOMORROW — MORNING', data: [c] },
    ]);
    expect(laterSeq(flattened)).toEqual(['#TODAY — EVENING', 'a', 'b', '#TOMORROW — MORNING', 'c']);
  });

  it('gives a unique key to each occurrence of a multi-segment task', () => {
    const a = makeTask({ id: 'a' });
    const flattened = flattenLaterSections([
      { title: 'TOMORROW — MORNING', data: [a] },
      { title: 'TOMORROW — EVENING', data: [a] },
    ]);
    const keys = flattened.filter(i => i.type === 'task').map(i => i.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('marks header items with isLaterHeader', () => {
    const flattened = flattenLaterSections([{ title: 'TODAY — EVENING', data: [makeTask({ id: 'a' })] }]);
    expect(flattened.map(isLaterHeader)).toEqual([true, false]);
  });
});

describe('laterTaskOrder', () => {
  it('returns task ids in flattened order, skipping headers', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const flattened = flattenLaterSections([{ title: 'TODAY — EVENING', data: [a, b] }]);
    expect(laterTaskOrder(flattened)).toEqual(['a', 'b']);
  });

  it('dedupes a task that appears in multiple sections, keeping its first position', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const flattened = flattenLaterSections([
      { title: 'TOMORROW — MORNING', data: [a, b] },
      { title: 'TOMORROW — EVENING', data: [a] },
    ]);
    expect(laterTaskOrder(flattened)).toEqual(['a', 'b']);
  });
});
