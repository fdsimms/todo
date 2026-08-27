import { liveProjectSteps, stepNumbersByTask, slotUpdates } from '../utils/projectOrder';
import {
  registerTaskSource,
  registerProjectSource,
  isSequenceHeld,
  isSequentialProject,
  stepNumberOf,
} from '../utils/blockerRegistry';
import { DEFAULT_NUDGE_CADENCE_DAYS } from '../types';
import type { Project, Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Task',
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
  recurrenceAnchorDate: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  supplyCount: null,
  supplyUnit: null,
  supplyRefillCount: null,
  supplyReorderAt: 1,
  supplyLeadDays: null,
  supplyDeclinedAtCount: null,
  supplyGroceryItemId: null,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  quotaIntervalMinutes: null,
  quotaReminders: false,
  quotaStartedAt: null,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 0,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false, excludeFromSuggestions: false,
  archived: false,
  archivedAt: null,
  timerStartedAt: null,
  actualMinutes: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  waitingOnPersonId: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
  ...overrides,
});

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: 'Project',
  notes: '',
  deadline: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: DEFAULT_NUDGE_CADENCE_DAYS,
  autoSchedule: false,
  sequential: false,
  nudgeOptIn: false,
  reviewDeclinedAt: null,
  backfillDismissedFields: [],
  ...overrides,
});

/** Three steps of p1, deliberately out of array order. */
const steps = () => [
  makeTask({ id: 'c', projectId: 'p1', sortOrder: 30 }),
  makeTask({ id: 'a', projectId: 'p1', sortOrder: 10 }),
  makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
];

describe('liveProjectSteps', () => {
  it('returns the project members in sortOrder', () => {
    expect(liveProjectSteps('p1', steps()).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves out other projects, subtasks, completions and archived rows', () => {
    const tasks = [
      ...steps(),
      makeTask({ id: 'other', projectId: 'p2', sortOrder: 1 }),
      makeTask({ id: 'loose', sortOrder: 1 }),
      makeTask({ id: 'sub', projectId: 'p1', parentId: 'a', sortOrder: 1 }),
      makeTask({ id: 'done', projectId: 'p1', completed: true, sortOrder: 2 }),
      makeTask({ id: 'filed', projectId: 'p1', archived: true, sortOrder: 3 }),
    ];
    expect(liveProjectSteps('p1', tasks).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('stepNumbersByTask', () => {
  it('numbers the live members of each project from 1, independently', () => {
    const numbers = stepNumbersByTask([
      ...steps(),
      makeTask({ id: 'x', projectId: 'p2', sortOrder: 99 }),
      makeTask({ id: 'y', projectId: 'p2', sortOrder: 5 }),
    ]);
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
    expect(numbers.get('c')).toBe(3);
    expect(numbers.get('y')).toBe(1);
    expect(numbers.get('x')).toBe(2);
  });

  it('closes the gap left by a completed step rather than keeping its number', () => {
    const numbers = stepNumbersByTask([
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 10, completed: true }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
      makeTask({ id: 'c', projectId: 'p1', sortOrder: 30 }),
    ]);
    expect(numbers.has('a')).toBe(false);
    expect(numbers.get('b')).toBe(1);
    expect(numbers.get('c')).toBe(2);
  });

  it('has nothing to say about a task with no project', () => {
    expect(stepNumbersByTask([makeTask({ id: 'loose' })]).has('loose')).toBe(false);
  });
});

describe('slotUpdates', () => {
  it('lays the new order into the slots the members already held', () => {
    // 10/20/30 stay 10/20/30 — only who sits in each changes.
    expect(slotUpdates(liveProjectSteps('p1', steps()), ['c', 'a', 'b'])).toEqual([
      { id: 'c', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  it('writes nothing when the order is unchanged', () => {
    expect(slotUpdates(liveProjectSteps('p1', steps()), ['a', 'b', 'c'])).toEqual([]);
  });

  it('never renumbers to 1..N — a project keeps its place in the global order', () => {
    const members = [
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 400 }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 900 }),
    ];
    expect(slotUpdates(members, ['b', 'a'])).toEqual([
      { id: 'b', sortOrder: 400 },
      { id: 'a', sortOrder: 900 },
    ]);
  });

  it('spreads out duplicate slots so a drag has something to persist', () => {
    const members = [
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 5 }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 5 }),
      makeTask({ id: 'c', projectId: 'p1', sortOrder: 5 }),
    ];
    expect(slotUpdates(members, ['c', 'b', 'a'])).toEqual([
      { id: 'b', sortOrder: 6 },
      { id: 'a', sortOrder: 7 },
    ]);
  });

  it('ignores ids that are not members, and leaves out members nobody named', () => {
    expect(slotUpdates(liveProjectSteps('p1', steps()), ['c', 'ghost', 'a'])).toEqual([
      { id: 'c', sortOrder: 10 },
      { id: 'a', sortOrder: 30 },
    ]);
  });

  it('is a no-op for an empty order', () => {
    expect(slotUpdates(liveProjectSteps('p1', steps()), [])).toEqual([]);
  });
});

describe('the sequential gate', () => {
  afterEach(() => {
    registerTaskSource(null);
    registerProjectSource(null);
  });

  const register = (tasks: Task[], projects: Project[]) => {
    registerTaskSource(() => tasks);
    registerProjectSource(() => projects);
  };

  it('holds nothing while the project is an ordinary one', () => {
    register(steps(), [makeProject()]);
    expect(isSequentialProject('p1')).toBe(false);
    expect(steps().some(isSequenceHeld)).toBe(false);
  });

  it('leaves the first step open and holds the rest', () => {
    const tasks = steps();
    register(tasks, [makeProject({ sequential: true })]);
    const held = tasks.filter(isSequenceHeld).map(t => t.id).sort();
    expect(held).toEqual(['b', 'c']);
  });

  it('opens the next step as soon as the one above it is done', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 10, completed: true }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
      makeTask({ id: 'c', projectId: 'p1', sortOrder: 30 }),
    ];
    register(tasks, [makeProject({ sequential: true })]);
    expect(isSequenceHeld(tasks[1])).toBe(false);
    expect(isSequenceHeld(tasks[2])).toBe(true);
  });

  // Archiving a step is a decision about that row, not a pause on the project.
  it('does not let an archived step hold the sequence open', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 10, archived: true }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
    ];
    register(tasks, [makeProject({ sequential: true })]);
    expect(isSequenceHeld(tasks[1])).toBe(false);
  });

  it('holds a subtask of a held step no more than one of an open step', () => {
    const tasks = [
      ...steps(),
      makeTask({ id: 'sub', projectId: 'p1', parentId: 'c', sortOrder: 1 }),
    ];
    register(tasks, [makeProject({ sequential: true })]);
    expect(isSequenceHeld(tasks[tasks.length - 1])).toBe(false);
  });

  it('holds nothing when no sources are registered', () => {
    registerTaskSource(null);
    registerProjectSource(null);
    expect(isSequenceHeld(makeTask({ projectId: 'p1', sortOrder: 99 }))).toBe(false);
    expect(stepNumberOf(makeTask({ projectId: 'p1' }))).toBeUndefined();
  });

  it('picks up a reorder — the gate follows the new first step', () => {
    let tasks = steps();
    registerTaskSource(() => tasks);
    registerProjectSource(() => [makeProject({ sequential: true })]);
    expect(stepNumberOf(tasks[1])).toBe(1); // 'a'

    // The store replaces the array on every write, which is what the index is
    // keyed on — see blockerRegistry.
    tasks = [
      makeTask({ id: 'c', projectId: 'p1', sortOrder: 10 }),
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 20 }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 30 }),
    ];
    expect(stepNumberOf(tasks[0])).toBe(1);
    expect(isSequenceHeld(tasks[0])).toBe(false);
    expect(isSequenceHeld(tasks[1])).toBe(true);
  });
});
