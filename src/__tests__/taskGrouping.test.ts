import {
  makeCategoryGroups,
  resolveDrop,
  resolveCategoryReorder,
  categoryHeaderRange,
  flattenLaterSections,
  laterTaskOrder,
  isLaterHeader,
  laterSections,
  laterSectionTaskOrder,
  todayTaskOrder,
  unrenderedTail,
  visibleTodayItems,
  visibleLaterSections,
  laterTodaySections,
  categorySpan,
  applyCategoryCollapse,
  categorySectionKeys,
  LATER_TODAY_LABEL,
  type CategoryListItem,
  type TodayListItem,
} from '../utils/taskGrouping';
import type { Task, TaskGroup } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({
      categories: [],
      getCategoryByName: () => null,
    }),
  },
}));

const makeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'group-1',
  title: 'Test Group',
  notes: '',
  tags: [],
  category: null,
  sortOrder: 1,
  collapsed: false,
  completedAt: null,
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  ...overrides,
});

// Helper: flatten the grouped output into a readable [label-or-taskId] sequence.
const seq = (tasks: Task[], categoryOrder?: string[]) =>
  makeCategoryGroups(tasks, categoryOrder).map(item =>
    item.type === 'header' ? `#${item.label}` : item.type === 'group' ? `g-${item.group.id}` : item.task.id,
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

// Readable view of a header/task/group layout.
const layoutSeq = (items: CategoryListItem[]) =>
  items.map(item =>
    item.type === 'header' ? `#${item.label}` : item.type === 'group' ? `g-${item.group.id}` : item.task.id,
  );

describe('makeCategoryGroups — with task groups', () => {
  it('renders each category’s groups before its plain tasks', () => {
    const items = makeCategoryGroups(
      [makeTask({ id: 't-health-1', category: 'health' }), makeTask({ id: 't-work-1', category: 'work' })],
      ['health', 'work'],
      [{ group: makeGroup({ id: 'g-health', category: 'health' }), children: [makeTask({ id: 'c1' })] }],
    );
    expect(layoutSeq(items)).toEqual(['#health', 'g-g-health', 't-health-1', '#work', 't-work-1']);
  });

  // Regression: a category made up ENTIRELY of a group with no loose tasks
  // must still get a header — this is the realistic case ("Health" might
  // contain only a "Take supplements" group).
  it('gives a category a header even when it has a group but no plain tasks', () => {
    const items = makeCategoryGroups(
      [],
      ['health'],
      [{ group: makeGroup({ id: 'g-health', category: 'health' }), children: [makeTask()] }],
    );
    expect(layoutSeq(items)).toEqual(['#health', 'g-g-health']);
  });

  it('sorts multiple groups within the same category by their own sortOrder', () => {
    const items = makeCategoryGroups(
      [],
      ['health'],
      [
        { group: makeGroup({ id: 'second', category: 'health', sortOrder: 2 }), children: [makeTask()] },
        { group: makeGroup({ id: 'first', category: 'health', sortOrder: 1 }), children: [makeTask()] },
      ],
    );
    expect(layoutSeq(items)).toEqual(['#health', 'g-first', 'g-second']);
  });

  it('places an uncategorized group above the header-less loose task group', () => {
    const items = makeCategoryGroups(
      [makeTask({ id: 'loose', category: null })],
      [],
      [{ group: makeGroup({ id: 'g-loose', category: null }), children: [makeTask()] }],
    );
    expect(layoutSeq(items)).toEqual(['g-g-loose', 'loose']);
  });

  it('behaves exactly like the two-argument call when there are no groups', () => {
    const tasks = [makeTask({ id: 't1' })];
    expect(makeCategoryGroups(tasks, [], [])).toEqual(makeCategoryGroups(tasks));
  });
});

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

  // Group headers drag as a single block (see TodayScreen's group onDrag):
  // dropping one under a different header recategorizes it, same rule as a
  // task, and it keeps its children.
  it('recategorizes a dragged group under a different section header', () => {
    const group = makeGroup({ id: 'g1', category: 'health', sortOrder: 1 });
    const child = makeTask({ id: 'c1' });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'work' },
      { type: 'group', group, children: [child] },
    ];
    const { groupUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(groupUpdates).toEqual([{ id: 'g1', category: 'work', sortOrder: 1 }]);
    expect(layoutSeq(settled)).toEqual(['#work', 'g-g1']);
  });

  it('renumbers group sortOrder within a category to match drop order', () => {
    const first = makeGroup({ id: 'first', category: 'health', sortOrder: 2 });
    const second = makeGroup({ id: 'second', category: 'health', sortOrder: 1 });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'group', group: first, children: [] },
      { type: 'group', group: second, children: [] },
    ];
    const { groupUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(groupUpdates).toEqual([
      { id: 'first', category: 'health', sortOrder: 1 },
      { id: 'second', category: 'health', sortOrder: 2 },
    ]);
    expect(layoutSeq(settled)).toEqual(['#health', 'g-first', 'g-second']);
  });

  it('reports no group updates when nothing about a group changed', () => {
    const group = makeGroup({ id: 'g1', category: 'health', sortOrder: 1 });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'health' },
      { type: 'group', group, children: [] },
    ];
    const { groupUpdates } = resolveDrop(reordered, noUpcoming);
    expect(groupUpdates).toEqual([]);
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

describe('laterTodaySections', () => {
  it('buckets ungrouped tasks by segment, with a "none" bucket for tasks with no segment', () => {
    const morning = makeTask({ id: 'a', timeSegments: ['morning'] });
    const evening = makeTask({ id: 'b', timeSegments: ['evening'] });
    const untimed = makeTask({ id: 'c' });
    const sections = laterTodaySections([morning, evening, untimed], []);
    expect(sections.map(s => s.key)).toEqual(['morning', 'evening', 'none']);
    expect(sections.map(s => s.tasks.map(t => t.id))).toEqual([['a'], ['b'], ['c']]);
  });

  // A stack with children split across segments must appear once per matching
  // bucket, carrying its FULL later-today roster each time — not fragment
  // into duplicate headers, and not drop the segment-mismatched sibling.
  it('assigns a stack to every bucket a child matches, once per bucket, with the full roster', () => {
    const morningChild = makeTask({ id: 'child-morning', timeSegments: ['morning'], groupId: 'g1' });
    const eveningChild = makeTask({ id: 'child-evening', timeSegments: ['evening'], groupId: 'g1' });
    const group = makeGroup({ id: 'g1' });
    const sections = laterTodaySections([], [{ group, children: [morningChild, eveningChild] }]);

    expect(sections.map(s => s.key)).toEqual(['morning', 'evening']);
    sections.forEach(section => {
      expect(section.groups).toHaveLength(1);
      expect(section.groups[0].group.id).toBe('g1');
      expect(section.groups[0].children.map(t => t.id)).toEqual(['child-morning', 'child-evening']);
    });
  });
});

describe('laterSections', () => {
  // Noon so the day a date lands on can't flip with the wall clock.
  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };

  it('orders sections by when their tasks surface', () => {
    const far = makeTask({ id: 'far', deferUntil: daysFromNow(3) });
    const near = makeTask({ id: 'near', deferUntil: daysFromNow(1) });
    const sections = laterSections([far, near]);
    expect(sections).toHaveLength(2);
    expect(sections.flatMap(s => s.data.map(t => t.id))).toEqual(['near', 'far']);
  });

  it('collects tasks surfacing on the same day under one section', () => {
    const a = makeTask({ id: 'a', deferUntil: daysFromNow(2) });
    const b = makeTask({ id: 'b', deferUntil: daysFromNow(2) });
    const sections = laterSections([a, b]);
    expect(sections).toHaveLength(1);
    expect(sections[0].data.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('lists a multi-segment task under one section per segment', () => {
    const task = makeTask({ id: 'a', deferUntil: daysFromNow(1), timeSegments: ['morning', 'evening'] });
    const sections = laterSections([task]);
    expect(sections.map(s => s.title.split(' — ')[1])).toEqual(['Morning', 'Evening']);
    expect(sections.every(s => s.data.map(t => t.id).includes('a'))).toBe(true);
  });

  // The sort works on a mapped array of (task, visibleAt) pairs rather than a
  // defensive copy of the input — this is what keeps that safe.
  it('does not reorder the array it was given', () => {
    const input = [
      makeTask({ id: 'a', deferUntil: daysFromNow(3) }),
      makeTask({ id: 'b', deferUntil: daysFromNow(1) }),
    ];
    laterSections(input);
    expect(input.map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('visibleLaterSections', () => {
  const section = (title: string, count: number) => ({
    title,
    data: Array.from({ length: count }, (_, i) => makeTask({ id: `${title}-${i}` })),
  });

  it('includes whole sections up to the task budget', () => {
    const sections = [section('a', 30), section('b', 30), section('c', 30)];
    expect(visibleLaterSections(sections, 60).map(s => s.title)).toEqual(['a', 'b']);
  });

  // A section straddling the budget boundary is included in full rather than
  // cut off mid-section — a header must never render without all its tasks.
  it('includes an entire section that pushes the running count past the budget', () => {
    const sections = [section('a', 40), section('b', 40)];
    expect(visibleLaterSections(sections, 60).map(s => s.title)).toEqual(['a', 'b']);
  });

  it('includes everything when the budget exceeds the total', () => {
    const sections = [section('a', 10), section('b', 10)];
    expect(visibleLaterSections(sections, 60).map(s => s.title)).toEqual(['a', 'b']);
  });
});

describe('laterSectionTaskOrder', () => {
  it('returns ids across sections in order, deduping a multi-segment task', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const order = laterSectionTaskOrder([
      { data: [a, b] },
      { data: [a] },
      { data: [makeTask({ id: 'c' })] },
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('todayTaskOrder', () => {
  it('returns top-level task ids, skipping headers and stacks', () => {
    const items: TodayListItem[] = [
      { type: 'pinned-header' },
      { type: 'pinned-task', task: makeTask({ id: 'p' }) },
      { type: 'header', label: 'Work' },
      { type: 'group', group: makeGroup(), children: [makeTask({ id: 'child' })] },
      { type: 'task', task: makeTask({ id: 'a' }) },
    ];
    expect(todayTaskOrder(items)).toEqual(['p', 'a']);
  });
});

describe('unrenderedTail', () => {
  it('returns the ids the rendered set left out, in their original order', () => {
    expect(unrenderedTail(['a', 'b', 'c', 'd'], ['b', 'a'])).toEqual(['c', 'd']);
  });

  it('returns nothing when everything rendered', () => {
    expect(unrenderedTail(['a', 'b'], ['b', 'a'])).toEqual([]);
  });
});

describe('visibleTodayItems', () => {
  const task = (id: string): TodayListItem => ({ type: 'task', task: makeTask({ id }) });

  it('stops adding task rows once the budget is spent', () => {
    const items: TodayListItem[] = [task('a'), task('b'), task('c'), task('d')];
    expect(visibleTodayItems(items, 2).map(i => (i.type === 'task' ? i.task.id : '?'))).toEqual(['a', 'b']);
  });

  // Headers are exempt: they're cheap, and a category-header drag needs the
  // full run of them present to drag through.
  it('keeps every header even past the budget', () => {
    const items: TodayListItem[] = [
      { type: 'header', label: 'Work' },
      task('a'),
      { type: 'header', label: 'Home' },
      task('b'),
    ];
    const result = visibleTodayItems(items, 1);
    expect(result.map(i => (i.type === 'header' ? `#${i.label}` : i.type === 'task' ? i.task.id : '?')))
      .toEqual(['#Work', 'a', '#Home']);
  });

  // A stack renders each of its children as a TaskItem, so it costs its whole
  // roster — and can't be shown as a fraction of one.
  it('counts a stack as its whole roster and never splits it', () => {
    const items: TodayListItem[] = [
      { type: 'group', group: makeGroup(), children: [makeTask({ id: 'c1' }), makeTask({ id: 'c2' })] },
      task('a'),
    ];
    const result = visibleTodayItems(items, 2);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
  });

  it('returns everything when the budget exceeds the list', () => {
    const items: TodayListItem[] = [task('a'), task('b')];
    expect(visibleTodayItems(items, 60)).toHaveLength(2);
  });
});

describe('categorySpan / applyCategoryCollapse / categorySectionKeys', () => {
  const listItemKey = (item: TodayListItem): string =>
    item.type === 'header' ? `h-${item.label}`
    : item.type === 'group' ? `g-${item.group.id}`
    : item.type === 'task' ? item.task.id
    : item.type;

  it('assigns null before the first header and while under "Later Today"', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const items: TodayListItem[] = [
      { type: 'task', task: a },
      { type: 'header', label: 'Work' },
      { type: 'header', label: LATER_TODAY_LABEL },
      { type: 'task', task: b },
    ];
    expect(categorySpan(items)).toEqual([null, 'Work', null, null]);
  });

  // categorySpan is the shared traversal behind both consumers — assert they
  // agree on what counts as "under a collapsed/real category" for the same
  // input, rather than re-deriving the walk independently.
  it('applyCategoryCollapse and categorySectionKeys agree on which rows are under a real category', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const items: TodayListItem[] = [
      { type: 'task', task: a },
      { type: 'header', label: 'Work' },
      { type: 'task', task: b },
    ];

    const keys = categorySectionKeys(items, listItemKey);
    expect(keys).toEqual(new Set(['b']));

    const collapsed = applyCategoryCollapse(items, new Set(['Work']));
    const collapsedTaskIds = collapsed.filter(i => i.type === 'task').map(i => i.task.id);
    // Every row categorySectionKeys says is "under a real category" (only
    // `b`, since `a` is the header-less loose group) is exactly the row
    // applyCategoryCollapse removes once that category is collapsed.
    expect(collapsedTaskIds).toEqual(['a']);
    expect(keys.has('a')).toBe(false);
  });
});
