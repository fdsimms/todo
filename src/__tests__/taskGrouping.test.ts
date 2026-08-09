import {
  makeCategoryGroups,
  resolveDrop,
  flattenLaterSections,
  laterTaskOrder,
  isLaterHeader,
  laterSections,
  visibleLaterSections,
  laterTodaySections,
  categorySpan,
  applyCategoryCollapse,
  sectionTaskIds,
  findTaskJumpTarget,
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
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
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
  targetUnit: null,
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
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
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
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  pendingImport: null,
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
  it('slots each group into its category by sortOrder, among the plain tasks', () => {
    const items = makeCategoryGroups(
      [
        makeTask({ id: 't-health-1', category: 'health', sortOrder: 1 }),
        makeTask({ id: 't-health-2', category: 'health', sortOrder: 3 }),
        makeTask({ id: 't-work-1', category: 'work', sortOrder: 4 }),
      ],
      ['health', 'work'],
      [{ group: makeGroup({ id: 'g-health', category: 'health', sortOrder: 2 }), children: [makeTask({ id: 'c1' })] }],
    );
    expect(layoutSeq(items)).toEqual(['#health', 't-health-1', 'g-g-health', 't-health-2', '#work', 't-work-1']);
  });

  // The bug this whole number space exists for: a stack used to head its
  // section no matter what, so a task dropped above one snapped back below it.
  it('renders a task above a group when its sortOrder is lower', () => {
    const items = makeCategoryGroups(
      [makeTask({ id: 'make-bed', category: 'morning', sortOrder: 1 })],
      ['morning'],
      [{ group: makeGroup({ id: 'supplements', category: 'morning', sortOrder: 2 }), children: [makeTask()] }],
    );
    expect(layoutSeq(items)).toEqual(['#morning', 'make-bed', 'g-supplements']);
  });

  it('keeps groups ahead of the tasks when interleaving is off (a non-manual sort)', () => {
    const items = makeCategoryGroups(
      [makeTask({ id: 'make-bed', category: 'morning', sortOrder: 1 })],
      ['morning'],
      [{ group: makeGroup({ id: 'supplements', category: 'morning', sortOrder: 2 }), children: [makeTask()] }],
      { interleaveGroups: false },
    );
    expect(layoutSeq(items)).toEqual(['#morning', 'g-supplements', 'make-bed']);
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

  it('keeps an uncategorized group in the header-less region at the top', () => {
    const items = makeCategoryGroups(
      [makeTask({ id: 'loose', category: null, sortOrder: 2 }), makeTask({ id: 'filed', category: 'health', sortOrder: 3 })],
      ['health'],
      [{ group: makeGroup({ id: 'g-loose', category: null, sortOrder: 1 }), children: [makeTask()] }],
    );
    expect(layoutSeq(items)).toEqual(['g-g-loose', 'loose', '#health', 'filed']);
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
    const { taskOrders, categoryUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(taskOrders).toEqual([{ id: 'workout', sortOrder: 1 }, { id: 'test', sortOrder: 2 }]);
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

  // The reported bug, end to end: "Make bed" dropped above the "Supplements"
  // stack used to come back below it, because the stack's number space and
  // the tasks' had nothing to compare and the layout put stacks first.
  it('keeps a task dropped above a stack above it', () => {
    const group = makeGroup({ id: 'supplements', category: 'morning', sortOrder: 1 });
    const makeBed = makeTask({ id: 'make-bed', category: 'morning', sortOrder: 2 });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'morning' },
      { type: 'task', task: makeBed },
      { type: 'group', group, children: [] },
    ];
    const { taskOrders, groupUpdates, settled } = resolveDrop(reordered, noUpcoming);
    expect(taskOrders).toEqual([{ id: 'make-bed', sortOrder: 1 }]);
    expect(groupUpdates).toEqual([{ id: 'supplements', category: 'morning', sortOrder: 2 }]);
    expect(layoutSeq(settled)).toEqual(['#morning', 'make-bed', 'g-supplements']);
  });

  // The ranks a drop hands out have to survive the round trip through the
  // store, so the gaps left for the stacks are part of what's persisted.
  it('leaves the stacks’ slots as gaps in the task numbering', () => {
    const group = makeGroup({ id: 'supplements', category: 'morning', sortOrder: 9 });
    const reordered: CategoryListItem[] = [
      { type: 'header', label: 'morning' },
      { type: 'task', task: makeTask({ id: 'make-bed', category: 'morning' }) },
      { type: 'group', group, children: [] },
      { type: 'task', task: makeTask({ id: 'shower', category: 'morning' }) },
    ];
    const { taskOrders, groupUpdates } = resolveDrop(reordered, noUpcoming);
    expect(taskOrders).toEqual([{ id: 'make-bed', sortOrder: 1 }, { id: 'shower', sortOrder: 3 }]);
    expect(groupUpdates).toEqual([{ id: 'supplements', category: 'morning', sortOrder: 2 }]);
  });

  it('renumbers group sortOrder to match drop order', () => {
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

describe('categorySpan / applyCategoryCollapse', () => {
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

  // Collapsing a category takes its own rows and nothing else: the
  // header-less loose group at the top belongs to no category, so it stays.
  it('applyCategoryCollapse removes only the rows under the collapsed header', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const items: TodayListItem[] = [
      { type: 'task', task: a },
      { type: 'header', label: 'Work' },
      { type: 'task', task: b },
    ];

    const collapsed = applyCategoryCollapse(items, new Set(['Work']));
    const collapsedTaskIds = collapsed.filter(i => i.type === 'task').map(i => i.task.id);
    expect(collapsedTaskIds).toEqual(['a']);
    // The header itself stays, so it's still tappable to re-expand.
    expect(collapsed.some(i => i.type === 'header' && i.label === 'Work')).toBe(true);
  });
});

describe('findTaskJumpTarget', () => {
  // The screen's own key scheme (TodayScreen.listItemKey), which is what the
  // returned key has to be usable as.
  const listItemKey = (item: TodayListItem): string =>
    item.type === 'pinned-header' ? '__pinned-header__'
    : item.type === 'pinned-task' ? `pin-${item.task.id}`
    : item.type === 'rest-header' ? '__rest-header__'
    : item.type === 'header' ? `h-${item.label}`
    : item.type === 'group' ? `g-${item.group.id}`
    : item.task.id;

  const find = (items: TodayListItem[], id: string) => findTaskJumpTarget(items, id, listItemKey);

  it('finds a loose task and reports no section to open', () => {
    const a = makeTask({ id: 'a' });
    expect(find([{ type: 'task', task: a }], 'a')).toEqual({
      key: 'a',
      category: null,
      groupId: null,
      inRest: false,
    });
  });

  it('names the category a task sits under, so a collapsed one can be opened', () => {
    const a = makeTask({ id: 'a', category: 'Work' });
    const items: TodayListItem[] = [
      { type: 'header', label: 'Work' },
      { type: 'task', task: a },
    ];
    expect(find(items, 'a')).toMatchObject({ key: 'a', category: 'Work' });
  });

  // "Later Today" is a time section, not a collapsible category — nothing to
  // expand, so it must not come back as one.
  it('treats the "Later Today" section as no category', () => {
    const a = makeTask({ id: 'a' });
    const items: TodayListItem[] = [
      { type: 'header', label: LATER_TODAY_LABEL },
      { type: 'task', task: a },
    ];
    expect(find(items, 'a')).toMatchObject({ category: null });
  });

  // A stacked task has no row of its own in this list; its stack's header is
  // the thing that can be scrolled to.
  it('returns the stack heading a task rather than the task', () => {
    const child = makeTask({ id: 'child', groupId: 'group-1' });
    const items: TodayListItem[] = [
      { type: 'header', label: 'Work' },
      { type: 'group', group: makeGroup({ id: 'group-1' }), children: [child] },
    ];
    expect(find(items, 'child')).toEqual({
      key: 'g-group-1',
      category: 'Work',
      groupId: 'group-1',
      inRest: false,
    });
  });

  it('flags a row sitting under "Everything else"', () => {
    const pinned = makeTask({ id: 'p', pinned: true });
    const rest = makeTask({ id: 'r' });
    const items: TodayListItem[] = [
      { type: 'pinned-header' },
      { type: 'pinned-task', task: pinned },
      { type: 'rest-header' },
      { type: 'task', task: rest },
    ];
    expect(find(items, 'r')).toMatchObject({ key: 'r', inRest: true });
  });

  // A pinned row sits above the divider, so it's never inside the collapsible
  // section even though the divider is further down the same list.
  it('does not flag a pinned row as being under "Everything else"', () => {
    const pinned = makeTask({ id: 'p', pinned: true });
    const items: TodayListItem[] = [
      { type: 'pinned-header' },
      { type: 'pinned-task', task: pinned },
      { type: 'rest-header' },
      { type: 'task', task: makeTask({ id: 'r' }) },
    ];
    expect(find(items, 'p')).toEqual({
      key: 'pin-p',
      category: null,
      groupId: null,
      inRest: false,
    });
  });

  // A filter can leave a visible-but-new task out of the list entirely; the
  // caller needs to be able to tell that from "found it".
  it('returns null for a task that has no row at all', () => {
    expect(find([{ type: 'task', task: makeTask({ id: 'a' }) }], 'missing')).toBeNull();
  });
});

describe('sectionTaskIds', () => {
  // What a header needs to leave with its rows: the ids under it, so it can
  // watch the completion batch and go in the same frame they do.
  it('names the tasks under each header', () => {
    const ids = sectionTaskIds([
      { type: 'task', task: makeTask({ id: 'loose' }) },
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
      { type: 'task', task: makeTask({ id: 'w2' }) },
      { type: 'header', label: 'home' },
      { type: 'task', task: makeTask({ id: 'h1' }) },
    ]);
    expect(ids.get('work')).toEqual(['w1', 'w2']);
    expect(ids.get('home')).toEqual(['h1']);
  });

  // The loose group at the top has no header to take away, so its tasks belong
  // to no section at all.
  it('leaves the header-less loose tasks out', () => {
    const ids = sectionTaskIds([
      { type: 'task', task: makeTask({ id: 'loose' }) },
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
    ]);
    expect(ids.size).toBe(1);
    expect([...ids.values()].flat()).not.toContain('loose');
  });

  // A stack is a row with its own children and its own hold — collapsing the
  // header over it would strand the tray under the section above.
  it('drops a section that holds a stack', () => {
    const ids = sectionTaskIds([
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
      { type: 'group', group: makeGroup({ id: 'g1', category: 'work' }), children: [makeTask({ id: 'c1' })] },
      { type: 'task', task: makeTask({ id: 'w2' }) },
      { type: 'header', label: 'home' },
      { type: 'task', task: makeTask({ id: 'h1' }) },
    ]);
    expect(ids.has('work')).toBe(false);
    // The section after it is unaffected — the stack disqualifies its own
    // header, not the rest of the list.
    expect(ids.get('home')).toEqual(['h1']);
  });

  // A collapsed category still renders its header, with none of its rows. It has
  // nothing to leave alongside, and an empty list here would read as "everything
  // under me is going" the moment any batch fired.
  it('drops a header whose rows have been folded away', () => {
    const ids = sectionTaskIds([
      { type: 'header', label: 'work' },
      { type: 'header', label: 'home' },
      { type: 'task', task: makeTask({ id: 'h1' }) },
    ]);
    expect(ids.has('work')).toBe(false);
    expect(ids.get('home')).toEqual(['h1']);
  });

  // Neither divider heads a category, and rows above the first header (the
  // pinned run) belong to no section.
  it('ignores the pinned and "everything else" dividers', () => {
    const ids = sectionTaskIds([
      { type: 'pinned-header' },
      { type: 'pinned-task', task: makeTask({ id: 'p1' }) },
      { type: 'rest-header' },
      { type: 'task', task: makeTask({ id: 'loose' }) },
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
    ]);
    expect(ids.size).toBe(1);
    expect(ids.get('work')).toEqual(['w1']);
  });
});
