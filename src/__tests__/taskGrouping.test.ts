import {
  makeCategoryGroups,
  resolveDrop,
  flattenLaterSections,
  laterTaskOrder,
  isLaterHeader,
  laterSections,
  laterDropZones,
  laterDaySections,
  laterVisibleOrder,
  laterTodaySections,
  categorySpan,
  applyCategoryCollapse,
  sectionTaskIds,
  sectionTasksByLabel,
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
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
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
  recurrenceAnchorDay: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
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
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
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

// A single-segment-per-day helper: no sub-header, since there's nothing
// within the day to distinguish.
const daySection = (title: string, label: string | null, segment: string | null, data: Task[]) => ({
  title,
  dateISO: `2026-01-01T00:00:00.000Z`,
  segments: [{ label, segment, data }],
});

// Readable view of a flattened Later layout.
const laterSeq = (items: ReturnType<typeof flattenLaterSections>) =>
  items.map(item =>
    item.type === 'header' ? `#${item.label}` : item.type === 'subheader' ? `##${item.label}` : item.task.id,
  );

describe('flattenLaterSections', () => {
  it('flattens day sections into header + task items in order', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const c = makeTask({ id: 'c' });
    const flattened = flattenLaterSections([
      daySection('TODAY', 'Evening', 'evening', [a, b]),
      daySection('TOMORROW', 'Morning', 'morning', [c]),
    ]);
    expect(laterSeq(flattened)).toEqual(['#TODAY', 'a', 'b', '#TOMORROW', 'c']);
  });

  // The point of #1162: same-day segments render under ONE date header, with
  // a lighter sub-header per segment rather than a fully separate section.
  it('renders one header per day, with a sub-header per segment when a day has more than one', () => {
    const morning = makeTask({ id: 'morning-task' });
    const evening = makeTask({ id: 'evening-task' });
    const flattened = flattenLaterSections([
      {
        title: 'TODAY',
        dateISO: '2026-01-01T00:00:00.000Z',
        segments: [
          { label: 'Morning', segment: 'morning', data: [morning] },
          { label: 'Evening', segment: 'evening', data: [evening] },
        ],
      },
    ]);
    expect(laterSeq(flattened)).toEqual(['#TODAY', '##Morning', 'morning-task', '##Evening', 'evening-task']);
  });

  // A day with exactly one sub-group has nothing to distinguish, so no
  // sub-header renders — just the day header and its tasks.
  it('omits the sub-header when a day has only one segment', () => {
    const flattened = flattenLaterSections([daySection('TODAY', 'Evening', 'evening', [makeTask({ id: 'a' })])]);
    expect(laterSeq(flattened)).toEqual(['#TODAY', 'a']);
  });

  it('gives a unique key to each occurrence of a multi-segment task', () => {
    const a = makeTask({ id: 'a' });
    const flattened = flattenLaterSections([
      {
        title: 'TOMORROW',
        dateISO: '2026-01-01T00:00:00.000Z',
        segments: [
          { label: 'Morning', segment: 'morning', data: [a] },
          { label: 'Evening', segment: 'evening', data: [a] },
        ],
      },
    ]);
    const keys = flattened.filter(i => i.type === 'task').map(i => i.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('marks header items with isLaterHeader', () => {
    const flattened = flattenLaterSections([daySection('TODAY', 'Evening', 'evening', [makeTask({ id: 'a' })])]);
    expect(flattened.map(isLaterHeader)).toEqual([true, false]);
  });

  // A sub-header is also a boundary for drag confinement — each segment used
  // to be its own independent section, and this keeps that behavior.
  it('marks sub-header items with isLaterHeader too', () => {
    const flattened = flattenLaterSections([
      {
        title: 'TODAY',
        dateISO: '2026-01-01T00:00:00.000Z',
        segments: [
          { label: 'Morning', segment: 'morning', data: [makeTask({ id: 'a' })] },
          { label: 'Evening', segment: 'evening', data: [makeTask({ id: 'b' })] },
        ],
      },
    ]);
    expect(flattened.map(isLaterHeader)).toEqual([true, true, false, true, false]);
  });
});

describe('laterTaskOrder', () => {
  it('returns task ids in flattened order, skipping headers', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const flattened = flattenLaterSections([daySection('TODAY', 'Evening', 'evening', [a, b])]);
    expect(laterTaskOrder(flattened)).toEqual(['a', 'b']);
  });

  it('dedupes a task that appears in multiple sections, keeping its first position', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const flattened = flattenLaterSections([
      {
        title: 'TOMORROW',
        dateISO: '2026-01-01T00:00:00.000Z',
        segments: [
          { label: 'Morning', segment: 'morning', data: [a, b] },
          { label: 'Evening', segment: 'evening', data: [a] },
        ],
      },
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

  const flatIds = (sections: ReturnType<typeof laterSections>) =>
    sections.flatMap(day => day.segments.flatMap(s => s.data.map(t => t.id)));

  it('orders day sections by when their tasks surface', () => {
    const far = makeTask({ id: 'far', deferUntil: daysFromNow(3) });
    const near = makeTask({ id: 'near', deferUntil: daysFromNow(1) });
    const sections = laterSections([far, near]);
    expect(sections).toHaveLength(2);
    expect(flatIds(sections)).toEqual(['near', 'far']);
  });

  it('collects tasks surfacing on the same day under one day section', () => {
    const a = makeTask({ id: 'a', deferUntil: daysFromNow(2) });
    const b = makeTask({ id: 'b', deferUntil: daysFromNow(2) });
    const sections = laterSections([a, b]);
    expect(sections).toHaveLength(1);
    expect(sections[0].segments).toHaveLength(1);
    expect(sections[0].segments[0].data.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('lists a multi-segment task under one segment per matching time-of-day, within the same day section', () => {
    const task = makeTask({ id: 'a', deferUntil: daysFromNow(1), timeSegments: ['morning', 'evening'] });
    const sections = laterSections([task]);
    expect(sections).toHaveLength(1);
    expect(sections[0].segments.map(s => s.label)).toEqual(['Morning', 'Evening']);
    expect(sections[0].segments.every(s => s.data.map(t => t.id).includes('a'))).toBe(true);
  });

  // The whole point of #1162: a day with tasks in different segments is
  // still ONE header-worthy day section, with several sub-groups inside it —
  // not several independent day sections.
  it('groups different-segment tasks on the same day into one day section with several sub-groups', () => {
    const morning = makeTask({ id: 'morning-task', deferUntil: daysFromNow(1), timeSegments: ['morning'] });
    const evening = makeTask({ id: 'evening-task', deferUntil: daysFromNow(1), timeSegments: ['evening'] });
    const sections = laterSections([morning, evening]);
    expect(sections).toHaveLength(1);
    expect(sections[0].segments.map(s => s.label)).toEqual(['Morning', 'Evening']);
    expect(sections[0].segments.map(s => s.data.map(t => t.id))).toEqual([['morning-task'], ['evening-task']]);
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

  it('gives a near day section the calendar day its tasks surface on', () => {
    const near = makeTask({ id: 'near', deferUntil: daysFromNow(1) });
    const sections = laterSections([near]);
    expect(sections[0].dateISO).not.toBeNull();
    expect(new Date(sections[0].dateISO!).toDateString()).toBe(new Date(near.deferUntil!).toDateString());
  });

  // Past a week out, formatGroupHeader collapses to a month label (see its own
  // comment) — so two different calendar days that land in the same distant
  // month share one section with no single date to drop a task onto.
  it('has no dateISO once same-month tasks have collapsed into one section', () => {
    const now = new Date();
    const anchor = new Date(now.getFullYear(), now.getMonth() + 2, 5, 12, 0, 0, 0);
    const nextDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1, 12, 0, 0, 0);
    const a = makeTask({ id: 'a', deferUntil: anchor.toISOString() });
    const b = makeTask({ id: 'b', deferUntil: nextDay.toISOString() });
    const sections = laterSections([a, b]);
    expect(sections).toHaveLength(1);
    expect(sections[0].dateISO).toBeNull();
  });

  // #1145: a fresh 0/x quota task has no timeSegments/windowStart of its own,
  // so isUpcomingToday's on-pace fast path is what's supposed to keep it out
  // of a manufactured time-of-day sub-header — it belongs in the headerless
  // "later today" bucket alongside anything else with no segment, not under
  // Night just because the pace ramp happens to resolve to a late clock time.
  it('puts a 0/x on-pace quota task in the headerless bucket, never under a manufactured time-of-day segment', () => {
    mockSettingsState.dayResetTime = '04:00';
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 4, 0, 0)); // exactly dayResetTime, as reported
    const task = makeTask({
      id: 'quota',
      dueDate: new Date(2025, 5, 10, 4, 0, 0).toISOString(),
      targetCount: 8,
      targetUnit: 'glasses',
      progressCount: 0,
    });
    const sections = laterSections([task]);
    expect(sections).toHaveLength(1);
    expect(sections[0].segments).toHaveLength(1);
    expect(sections[0].segments[0].label).toBeNull();
    expect(sections[0].segments[0].data.map(t => t.id)).toEqual(['quota']);
    jest.useRealTimers();
    mockSettingsState.dayResetTime = '00:00';
  });

  // The day header is cached per calendar date inside the pass (it used to be
  // recomputed per task). Two guards on that cache: it must not merge adjacent
  // days into whichever label it saw first...
  it('keeps consecutive days in their own sections, several tasks per day', () => {
    const tasks = [1, 2, 3].flatMap(day =>
      ['a', 'b'].map(suffix => makeTask({ id: `d${day}${suffix}`, deferUntil: daysFromNow(day) })),
    );
    const sections = laterSections(tasks);
    expect(sections).toHaveLength(3);
    expect(new Set(sections.map(s => s.title)).size).toBe(3);
    expect(sections.map(s => s.segments[0].data.map(t => t.id))).toEqual([
      ['d1a', 'd1b'],
      ['d2a', 'd2b'],
      ['d3a', 'd3b'],
    ]);
  });

  // ...and it must not outlive the call, or a label would be stuck at whatever
  // it meant relative to the day the app was opened on.
  it('relabels the same date once the clock has rolled onto it', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 12, 0, 0));
    const task = makeTask({ id: 'a', deferUntil: new Date(2025, 5, 11, 12, 0, 0).toISOString() });
    expect(laterSections([task])[0].title).toMatch(/^Tomorrow/);
    jest.setSystemTime(new Date(2025, 5, 11, 12, 0, 0));
    expect(laterSections([task])[0].title).toMatch(/^Today/);
    jest.useRealTimers();
  });
});

describe('laterDropZones', () => {
  const task = makeTask({ id: 't1' });

  it('gives a header zone the day it heads as a schedule payload', () => {
    const items: ReturnType<typeof flattenLaterSections> = [
      { type: 'header', label: 'Thursday', key: 'h-Thursday', dateISO: '2026-01-08T00:00:00.000Z' },
      { type: 'task', task, key: 't1' },
    ];
    const zones = laterDropZones(items);
    expect(zones[0]).toEqual({
      kind: 'header',
      key: 'h-Thursday',
      category: null,
      schedule: { dueDate: '2026-01-08T00:00:00.000Z', timeSegments: [], windowStart: null, windowEnd: null, label: 'Thursday' },
    });
  });

  it('inherits the header schedule for the task rows under it', () => {
    const items: ReturnType<typeof flattenLaterSections> = [
      { type: 'header', label: 'Thursday', key: 'h-Thursday', dateISO: '2026-01-08T00:00:00.000Z' },
      { type: 'task', task, key: 't1' },
    ];
    const zones = laterDropZones(items);
    expect(zones[1]).toEqual({
      kind: 'task',
      key: 't1',
      category: null,
      schedule: { dueDate: '2026-01-08T00:00:00.000Z', timeSegments: [], windowStart: null, windowEnd: null, label: 'Thursday' },
    });
  });

  it('carries a sub-header\'s own segment/window, not the day header\'s', () => {
    const items: ReturnType<typeof flattenLaterSections> = [
      { type: 'header', label: 'Thursday', key: 'h-Thursday', dateISO: '2026-01-08T00:00:00.000Z' },
      {
        type: 'subheader',
        label: 'Morning',
        key: 'sh-Thursday-Morning',
        segment: 'morning',
        dateISO: '2026-01-08T00:00:00.000Z',
        windowStart: null,
        windowEnd: null,
      },
      { type: 'task', task, key: 't1' },
    ];
    const zones = laterDropZones(items);
    expect(zones[2]).toEqual({
      kind: 'task',
      key: 't1',
      category: null,
      schedule: {
        dueDate: '2026-01-08T00:00:00.000Z',
        timeSegments: ['morning'],
        windowStart: null,
        windowEnd: null,
        label: 'Thursday · Morning',
      },
    });
  });

  it('gives a header/task whose day has collapsed past one-per-day a no-target rest zone', () => {
    const items: ReturnType<typeof flattenLaterSections> = [
      { type: 'header', label: 'September', key: 'h-September', dateISO: null },
      { type: 'task', task, key: 't1' },
    ];
    const zones = laterDropZones(items);
    expect(zones).toEqual([
      { kind: 'rest', key: 'h-September' },
      { kind: 'rest', key: 't1' },
    ]);
  });
});

describe('laterDaySections task budget', () => {
  // Pinned so the three days below stay inside formatGroupHeader's
  // one-header-per-day range instead of collapsing into a month label.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 12, 0, 0));
  });
  afterEach(() => jest.useRealTimers());

  const day = (offset: number, count: number, segments: string[] = []) =>
    Array.from({ length: count }, (_, i) => ({
      task: makeTask({ id: `d${offset}-${i}`, timeSegments: segments as any }),
      visibleAt: new Date(2025, 5, 10 + offset, 12, 0, 0),
    }));

  it('includes whole day sections up to the task budget', () => {
    const result = laterDaySections([...day(1, 30), ...day(2, 30), ...day(3, 30)], 60);
    expect(result.sections).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  // A day straddling the budget boundary is included in full rather than cut
  // off mid-day — a header must never render without all its tasks.
  it('includes an entire day that pushes the running count past the budget', () => {
    const result = laterDaySections([...day(1, 40), ...day(2, 40)], 60);
    expect(result.sections.map(s => s.segments[0].data.length)).toEqual([40, 40]);
    expect(result.hasMore).toBe(false);
  });

  it('includes everything, and reports no more, when the budget exceeds the total', () => {
    const result = laterDaySections([...day(1, 10), ...day(2, 10)], 60);
    expect(result.sections).toHaveLength(2);
    expect(result.hasMore).toBe(false);
  });

  // The budget counts placements across every sub-group in a day, not just the
  // first — a day with morning+evening tasks totalling over budget must still
  // be counted as one whole day, not split mid-day.
  it('counts every segment placement in a day towards the budget', () => {
    const result = laterDaySections(
      [...day(1, 20, ['morning']), ...day(1, 20, ['evening']), ...day(2, 30)],
      30,
    );
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].segments.map(s => s.label)).toEqual(['Morning', 'Evening']);
    expect(result.hasMore).toBe(true);
  });

  // A multi-segment task is a row under each of its sub-headers, so it costs
  // the budget once per placement rather than once per task.
  it('charges a multi-segment task once per placement', () => {
    const result = laterDaySections(
      [...day(1, 2, ['morning', 'evening']), ...day(2, 5)],
      4,
    );
    expect(result.sections).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('groups everything with no budget given', () => {
    const result = laterDaySections([...day(1, 30), ...day(2, 30), ...day(3, 30)]);
    expect(result.sections).toHaveLength(3);
    expect(result.hasMore).toBe(false);
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
    item.type === 'header' ? `h-${item.label}`
    : item.type === 'group' ? `g-${item.group.id}`
    : item.type === 'context' ? item.row.id
    : item.task.id;

  const find = (items: TodayListItem[], id: string) => findTaskJumpTarget(items, id, listItemKey);

  it('finds a loose task and reports no section to open', () => {
    const a = makeTask({ id: 'a' });
    expect(find([{ type: 'task', task: a }], 'a')).toEqual({
      key: 'a',
      category: null,
      groupId: null,
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
    });
  });

  // A pinned task is still an ordinary row of its own category section — the
  // pinned block above the list is a second copy, and isn't in this data. So a
  // jump aims at the row in place, which is where the task actually lives.
  it('aims at a pinned task\'s row in its own category section', () => {
    const pinned = makeTask({ id: 'p', category: 'Work', pinned: true });
    const items: TodayListItem[] = [
      { type: 'header', label: 'Work' },
      { type: 'task', task: pinned },
    ];
    expect(find(items, 'p')).toEqual({
      key: 'p',
      category: 'Work',
      groupId: null,
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

  // The header-less loose run at the top of the list belongs to no section, so
  // nothing can collapse over it.
  it('ignores rows above the first header', () => {
    const ids = sectionTaskIds([
      { type: 'task', task: makeTask({ id: 'loose' }) },
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
    ]);
    expect(ids.size).toBe(1);
    expect(ids.get('work')).toEqual(['w1']);
  });
});

describe('sectionTasksByLabel', () => {
  // What a header's own pin toggle acts on: the rows sitting under it, which is
  // today's work rather than everything filed under the category.
  it('collects the tasks under each header', () => {
    const sections = sectionTasksByLabel([
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
      { type: 'task', task: makeTask({ id: 'w2' }) },
      { type: 'header', label: 'home' },
      { type: 'task', task: makeTask({ id: 'h1' }) },
    ]);
    expect(sections.get('work')?.map(t => t.id)).toEqual(['w1', 'w2']);
    expect(sections.get('home')?.map(t => t.id)).toEqual(['h1']);
  });

  // A stack's tray is the row on screen, and it sits under its own
  // group.category — so its children belong to that section whatever their own
  // category says. sectionTaskIds abandons such a section; this one must not,
  // or long-pressing a header made entirely of a stack would do nothing.
  it("counts a stack's children towards the section its tray sits in", () => {
    const sections = sectionTasksByLabel([
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1', category: 'work' }) },
      {
        type: 'group',
        group: makeGroup({ id: 'g1', category: 'work' }),
        children: [makeTask({ id: 'c1', category: 'home' }), makeTask({ id: 'c2', category: 'work' })],
      },
      { type: 'header', label: 'home' },
      { type: 'task', task: makeTask({ id: 'h1', category: 'home' }) },
    ]);
    expect(sections.get('work')?.map(t => t.id)).toEqual(['w1', 'c1', 'c2']);
    expect(sections.get('home')?.map(t => t.id)).toEqual(['h1']);
  });

  // The loose run at the top has no header to act on it.
  it('ignores rows above the first header', () => {
    const sections = sectionTasksByLabel([
      { type: 'task', task: makeTask({ id: 'loose' }) },
      { type: 'header', label: 'work' },
      { type: 'task', task: makeTask({ id: 'w1' }) },
    ]);
    expect(sections.size).toBe(1);
    expect(sections.get('work')?.map(t => t.id)).toEqual(['w1']);
  });

  // A calendar event or an uncooked meal isn't a task, so it can't be pinned —
  // and a category holding nothing else has an empty section, which is how the
  // header says it has nothing to pin.
  it('skips context rows and leaves their section empty', () => {
    const sections = sectionTasksByLabel([
      { type: 'header', label: 'work' },
      {
        type: 'context',
        row: {
          id: 'event-1',
          sourceId: '1',
          kind: 'event',
          title: 'Standup',
          caption: '9:00 AM',
          category: 'work',
          now: false,
        },
      },
    ]);
    expect(sections.get('work')).toEqual([]);
  });

  // A collapsed header has had its rows folded away by the time `data` is
  // built, so the screen resolves this against `listItems` instead — but the
  // walk itself must still report an emptied section honestly rather than
  // carrying the previous label's rows into it.
  it('reports an emptied section as empty', () => {
    const sections = sectionTasksByLabel([
      { type: 'header', label: 'work' },
      { type: 'header', label: 'home' },
      { type: 'task', task: makeTask({ id: 'h1' }) },
    ]);
    expect(sections.get('work')).toEqual([]);
    expect(sections.get('home')?.map(t => t.id)).toEqual(['h1']);
  });
});
