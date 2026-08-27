import {
  RETENTION_OPTIONS,
  parseRetentionDays,
  retentionCutoff,
  retentionLabel,
  selectPurgeableTaskIds,
} from '../utils/retention';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({ dayResetTime: '00:00' })) },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1',
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
  quotaStartedAt: null, quotaAlwaysVisible: false,
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
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
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
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
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
  seriesDefaults: null,
  ...overrides,
});

/** A completed row, stamped `daysAgo` before 2026-06-01. */
const completedDaysAgo = (id: string, daysAgo: number, overrides: Partial<Task> = {}): Task => {
  const at = new Date(2026, 5, 1, 12, 0, 0);
  at.setDate(at.getDate() - daysAgo);
  return makeTask({ id, completed: true, completedAt: at.toISOString(), ...overrides });
};

describe('parseRetentionDays', () => {
  it('reads a stored window back', () => {
    expect(parseRetentionDays('90')).toBe(90);
    expect(parseRetentionDays('365')).toBe(365);
  });

  it('reads an empty or missing value as forever', () => {
    expect(parseRetentionDays('')).toBeNull();
    expect(parseRetentionDays(null)).toBeNull();
  });

  // The failure mode of a garbled value has to be "keep everything" — a
  // number nothing offers must never become a window that deletes.
  it('reads an unrecognised value as forever rather than trusting it', () => {
    expect(parseRetentionDays('7')).toBeNull();
    expect(parseRetentionDays('0')).toBeNull();
    expect(parseRetentionDays('-1')).toBeNull();
    expect(parseRetentionDays('nonsense')).toBeNull();
  });
});

describe('retentionLabel', () => {
  it('labels each option, defaulting to Forever', () => {
    expect(retentionLabel(90)).toBe('3 months');
    expect(retentionLabel(365)).toBe('1 year');
    expect(retentionLabel(null)).toBe('Forever');
  });

  it('covers every offered option', () => {
    RETENTION_OPTIONS.forEach(opt => expect(retentionLabel(opt.value)).toBe(opt.label));
  });
});

describe('retentionCutoff', () => {
  it('is null when retention is off', () => {
    expect(retentionCutoff(null, new Date(2026, 5, 1))).toBeNull();
  });

  it('counts back from the start of the logical day', () => {
    const cutoff = retentionCutoff(90, new Date(2026, 5, 1, 23, 30), '00:00');
    expect(cutoff).toEqual(new Date(2026, 2, 3, 0, 0, 0, 0));
  });

  // Anchoring to the logical day rather than to "now" is what makes the same
  // day's launches agree: opening the app in the morning and again at night
  // has to take the same set of rows.
  it('gives the same cutoff whenever in the day the app is opened', () => {
    const morning = retentionCutoff(90, new Date(2026, 5, 1, 8, 0), '00:00');
    const night = retentionCutoff(90, new Date(2026, 5, 1, 23, 59), '00:00');
    expect(morning).toEqual(night);
  });

  it('honours a non-midnight day reset', () => {
    // 1:00 AM on the 1st with a 2 AM reset is still the 31st's logical day.
    const cutoff = retentionCutoff(90, new Date(2026, 5, 1, 1, 0), '02:00');
    expect(cutoff).toEqual(new Date(2026, 2, 2, 2, 0, 0, 0));
  });
});

describe('selectPurgeableTaskIds', () => {
  const cutoff = new Date(2026, 2, 3, 0, 0, 0, 0); // 90 days before 2026-06-01

  it('takes completions older than the cutoff and leaves newer ones', () => {
    const tasks = [
      completedDaysAgo('old', 200),
      completedDaysAgo('recent', 10),
    ];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual(['old']);
  });

  it('leaves incomplete tasks alone however old they are', () => {
    const tasks = [makeTask({ id: 'live', createdAt: '2020-01-01T00:00:00.000Z' })];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual([]);
  });

  it('leaves a completed row with no completedAt stamp', () => {
    const tasks = [makeTask({ id: 'unstamped', completed: true, completedAt: null })];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual([]);
  });

  // Archiving is an explicit "keep this, out of my way" — the window is about
  // tombstones piling up unasked, not about what the user chose to file.
  it('never takes an archived task', () => {
    const tasks = [completedDaysAgo('filed', 400, { archived: true, archivedAt: '2025-05-01T00:00:00.000Z' })];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual([]);
  });

  // An answered decision task holds a value the user typed and expects to read
  // back, and on a one-off it's the only thing holding it — deleting that is
  // the data-loss case the forever default exists to avoid, arriving months
  // late and silently.
  it('never takes a decision task that recorded an answer', () => {
    const tasks = [
      completedDaysAgo('trip-date', 400, { deliverableKind: 'date', deliverableValue: '2026-09-12T00:00:00.000Z' }),
    ];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual([]);
  });

  // Same protection when the question was the chain step's rather than the
  // task's — a chain step's answer is no less recorded for living on a row
  // whose own deliverableKind is null.
  it("never takes a chain step that recorded an answer", () => {
    const tasks = [
      completedDaysAgo('haircut', 400, {
        deliverableKind: null,
        deliverableValue: '2026-09-12T12:00:00.000Z',
        chainEnabled: true,
        chainIndex: 0,
        chainItems: [
          { id: 'book', title: 'Book haircut', estimatedMinutes: null, deliverableKind: 'date', deliverableDatesNextStep: true },
          { id: 'get', title: 'Get haircut', estimatedMinutes: null },
        ],
      }),
    ];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual([]);
  });

  // Narrow on purpose: nothing was recorded, so the row is an ordinary
  // tombstone and the window means what it says.
  it('takes a decision task that was completed without an answer', () => {
    const tasks = [completedDaysAgo('skipped', 400, { deliverableKind: 'text', deliverableValue: null })];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual(['skipped']);
  });

  // A completed subtask under a live parent is a checked-off step of something
  // still in progress, not history. Subtasks of a purged parent are deleted by
  // dbBulkDeleteTasks' parent_id cascade, so they're never named here.
  it('never names a subtask, purgeable parent or not', () => {
    const tasks = [
      completedDaysAgo('parent', 200),
      completedDaysAgo('sub-of-purged', 200, { parentId: 'parent' }),
      completedDaysAgo('sub-of-live', 200, { parentId: 'live' }),
      makeTask({ id: 'live' }),
    ];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual(['parent']);
  });

  it('takes a whole chain of old occurrences but stops at the live one', () => {
    const tasks = [
      completedDaysAgo('occ1', 300),
      completedDaysAgo('occ2', 200, { previousOccurrenceId: 'occ1' }),
      makeTask({ id: 'live', previousOccurrenceId: 'occ2', streakCount: 42 }),
    ];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual(['occ1', 'occ2']);
  });

  it('takes nothing when everything is inside the window', () => {
    const tasks = [completedDaysAgo('a', 1), completedDaysAgo('b', 89)];
    expect(selectPurgeableTaskIds(tasks, cutoff)).toEqual([]);
  });
});
