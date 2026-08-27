import { addDays } from 'date-fns/addDays';
import { collapseOccurrences, occurrenceFamilyKey, formatOccurrenceCount } from '../utils/searchCollapse';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Buy groceries',
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
  quotaStartedAt: null, quotaAlwaysVisible: false,
  progressCount: 0,
  tags: [],
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
  reminderOffsetDays: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  category: null,
  vacationPause: false, excludeFromSuggestions: false,
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
  emailAddress: null, location: null,
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


const iso = (offsetDays: number) => addDays(new Date(), offsetDays).toISOString();

/** A search result, reduced to what collapseOccurrences actually reads. */
const hit = (task: Task, score = 100) => ({ task, score });

const idsOf = (rows: { task: Task }[]) => rows.map(r => r.task.id);

/** One generated meal-slot row: the shape with no pointer back to yesterday's. */
const mealSlot = (id: string, dayOffset: number, overrides: Partial<Task> = {}) =>
  makeTask({
    id,
    title: 'Breakfast',
    generatedKind: 'mealSlot',
    generatedSourceId: `2026-08-2${id}#breakfast`,
    dueDate: iso(dayOffset),
    ...overrides,
  });

describe('occurrenceFamilyKey', () => {
  it('keys the rows of a dated series together', () => {
    const a = makeTask({ id: 'a', seriesId: 's1' });
    const b = makeTask({ id: 'b', seriesId: 's1' });
    const byId = new Map([a, b].map(t => [t.id, t]));
    expect(occurrenceFamilyKey(a, byId)).toBe(occurrenceFamilyKey(b, byId));
  });

  it('keys a recurring task with its own tombstones', () => {
    const root = makeTask({ id: 'root' });
    const second = makeTask({ id: 'second', previousOccurrenceId: 'root' });
    const third = makeTask({ id: 'third', previousOccurrenceId: 'second' });
    const byId = new Map([root, second, third].map(t => [t.id, t]));
    expect(occurrenceFamilyKey(third, byId)).toBe('occurrence:root');
    expect(occurrenceFamilyKey(second, byId)).toBe('occurrence:root');
  });

  it('keys same-kind, same-title generated tasks together despite unlinked ids', () => {
    const monday = mealSlot('1', 0);
    const tuesday = mealSlot('2', 1);
    const byId = new Map([monday, tuesday].map(t => [t.id, t]));
    expect(occurrenceFamilyKey(monday, byId)).toBe(occurrenceFamilyKey(tuesday, byId));
  });

  it('keeps different generated titles apart', () => {
    const breakfast = mealSlot('1', 0);
    const dinner = mealSlot('2', 0, { title: 'Dinner' });
    const byId = new Map([breakfast, dinner].map(t => [t.id, t]));
    expect(occurrenceFamilyKey(breakfast, byId)).not.toBe(occurrenceFamilyKey(dinner, byId));
  });

  it('keeps two hand-made tasks that merely share a title apart', () => {
    const first = makeTask({ id: 'a', title: 'Call the vet' });
    const second = makeTask({ id: 'b', title: 'Call the vet' });
    const byId = new Map([first, second].map(t => [t.id, t]));
    expect(occurrenceFamilyKey(first, byId)).not.toBe(occurrenceFamilyKey(second, byId));
  });

  it('survives a previousOccurrenceId loop', () => {
    const a = makeTask({ id: 'a', previousOccurrenceId: 'b' });
    const b = makeTask({ id: 'b', previousOccurrenceId: 'a' });
    const byId = new Map([a, b].map(t => [t.id, t]));
    expect(occurrenceFamilyKey(a, byId)).toBe('occurrence:b');
  });
});

describe('collapseOccurrences', () => {
  it('leaves unrelated results alone, each standing only for itself', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Renew passport' }),
      makeTask({ id: 'b', title: 'Book flights' }),
    ];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(idsOf(collapsed)).toEqual(['a', 'b']);
    expect(collapsed.map(r => r.occurrenceCount)).toEqual([1, 1]);
  });

  it('folds a generated task\'s days into one row that counts them', () => {
    const tasks = [mealSlot('1', 0), mealSlot('2', 1), mealSlot('3', 2)];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].occurrenceCount).toBe(3);
  });

  it('shows the soonest upcoming occurrence', () => {
    const tasks = [mealSlot('3', 5), mealSlot('1', 1), mealSlot('2', 3)];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(idsOf(collapsed)).toEqual(['1']);
  });

  it('counts today as upcoming rather than past', () => {
    const tasks = [mealSlot('1', 0), mealSlot('2', 4)];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(idsOf(collapsed)).toEqual(['1']);
  });

  it('falls back to the most recent occurrence when every date is past', () => {
    const tasks = [mealSlot('1', -9), mealSlot('2', -2), mealSlot('3', -5)];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(idsOf(collapsed)).toEqual(['2']);
  });

  it('prefers a live occurrence over a completed one', () => {
    const done = mealSlot('1', 1, { completed: true, completedAt: iso(-1) });
    const live = mealSlot('2', 6);
    const tasks = [done, live];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(idsOf(collapsed)).toEqual(['2']);
    expect(collapsed[0].occurrenceCount).toBe(2);
  });

  it('shows the most recent completion when the whole family is done', () => {
    const tasks = [
      mealSlot('1', -6, { completed: true, completedAt: iso(-6) }),
      mealSlot('2', -2, { completed: true, completedAt: iso(-2) }),
    ];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks);
    expect(idsOf(collapsed)).toEqual(['2']);
  });

  it('holds a just-ticked row in place instead of swapping a sibling in', () => {
    const ticked = mealSlot('1', 0, { completed: true, completedAt: iso(0) });
    const tomorrow = mealSlot('2', 1);
    const tasks = [ticked, tomorrow];
    const collapsed = collapseOccurrences(tasks.map(t => hit(t)), tasks, new Set(['1']));
    expect(idsOf(collapsed)).toEqual(['1']);
  });

  it('keeps the slot the family\'s best-scoring row held', () => {
    const other = makeTask({ id: 'other', title: 'Break the news' });
    const tasks = [mealSlot('1', 3), other, mealSlot('2', 1)];
    // The meal family matched first, so it keeps the first slot even though
    // the row shown for it is the one that sorted last.
    const collapsed = collapseOccurrences(
      [hit(tasks[0], 120), hit(other, 110), hit(tasks[2], 100)],
      tasks
    );
    expect(idsOf(collapsed)).toEqual(['2', 'other']);
  });

  it('walks the occurrence chain through rows the query never matched', () => {
    const root = makeTask({ id: 'root', title: 'Water the plants', dueDate: iso(-4) });
    // The middle row is in the task list but not in the results — a title edit,
    // or a match that landed on another row's notes.
    const middle = makeTask({ id: 'middle', title: 'Water plants (away)', previousOccurrenceId: 'root', dueDate: iso(-2) });
    const latest = makeTask({ id: 'latest', title: 'Water the plants', previousOccurrenceId: 'middle', dueDate: iso(1) });
    const collapsed = collapseOccurrences([hit(root), hit(latest)], [root, middle, latest]);
    expect(collapsed).toHaveLength(1);
    expect(idsOf(collapsed)).toEqual(['latest']);
    expect(collapsed[0].occurrenceCount).toBe(2);
  });

  it('carries the representative\'s own highlight ranges, not a sibling\'s', () => {
    const past = mealSlot('1', -1);
    const next = mealSlot('2', 1);
    const collapsed = collapseOccurrences(
      [{ ...hit(past), titleMatches: [[0, 5]] }, { ...hit(next), titleMatches: [[2, 7]] }],
      [past, next]
    );
    expect(collapsed[0].titleMatches).toEqual([[2, 7]]);
  });

  it('reports nothing for no results', () => {
    expect(collapseOccurrences([], [])).toEqual([]);
  });
});

describe('formatOccurrenceCount', () => {
  it('says nothing for a row that stands only for itself', () => {
    expect(formatOccurrenceCount(1)).toBeNull();
    expect(formatOccurrenceCount(0)).toBeNull();
  });

  it('counts the others, not the row itself', () => {
    expect(formatOccurrenceCount(2)).toBe('1 more date');
    expect(formatOccurrenceCount(5)).toBe('4 more dates');
  });
});
