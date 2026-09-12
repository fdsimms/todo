import { buildCompletion, completionRefusal, type CompletionContext } from '../utils/taskCompletion';
import type { Task } from '../types';

// Same stubs bulkCompletion.test.ts uses: the completion core reaches
// visibilityUtils, which reaches the settings and category stores and, through
// them, expo-sqlite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      dayResetTime: '00:00',
      morningStart: '06:00',
      afternoonStart: '12:00',
      eveningStart: '18:00',
      nightStart: '21:00',
      activeHoursStart: '08:00',
      activeHoursEnd: '22:00',
      vacationMode: false,
      newTaskDefaults: {},
    }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Task', notes: '', completed: false, completedAt: null, missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date().toISOString(), seenAt: null, dueDate: null, deadline: null,
  deadlineOffsetDays: null, deadlineMonthDay: null, deferUntil: null,
  timeSegments: [], windowStart: null, windowEnd: null, personIds: [],
  recurrenceType: 'none', recurrenceInterval: 1, recurrenceDays: [],
  recurrenceMonthDay: null, recurrenceWeekOrdinal: null, recurrenceAnchorDay: null, recurrenceAnchorDate: null, recurrenceEndDate: null,
  recurrenceCount: null, recurrenceFromCompletion: false,
  targetCount: null, progressCount: 0, targetUnit: null, allowOvershoot: false,
  supplyCount: null, supplyUnit: null, supplyRefillCount: null, supplyReorderAt: 1,
  supplyLeadDays: null, supplyDeclinedAtCount: null, supplyGroceryItemId: null,
  tags: [], category: null, sortOrder: 0, pinned: false, pinnedOrder: 0, priority: 0, effort: 0,
  estimatedMinutes: null, reminderTime: null, reminderKind: 'notification', reminderOffsetDays: null, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null, linkUrl: null,
  phoneNumber: null, emailAddress: null, location: null, blockedById: null, waitingOnPersonId: null,
  deliverableKind: null, deliverableValue: null, generatedKind: null, generatedSourceId: null,
  deadlineOnCalendar: false, calendarEventId: null,
  logCompletionToCalendar: false, completionCalendarEventId: null, timeBlockEventId: null,
  pendingImport: null, backfillDismissedFields: [],
  streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null, priorBestStreak: 0,
  polarity: 'positive',
  slipCount: 0,
  slipDate: null,
  penaltyMinutes: null,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  gatesApps: false,
  showStreak: false, streakRequiresWindow: false,
  parentId: null, groupId: null, projectId: null,
  chainEnabled: false, chainIndex: 0, chainItems: [], chainStepOnSchedule: false, vacationPause: false, excludeFromSuggestions: false,
  followUpTaskEveryN: null, followUpTaskTitle: null, followUpTaskDraft: null,
  followUpTaskOneAtATime: false, followUpTaskTally: 0, previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  archived: false, archivedAt: null, timerStartedAt: null, actualMinutes: null,
  timedMinutes: null, timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null, completionTimerMinutes: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null,
  previousOccurrenceId: null,
  seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1, seriesDefaults: null,
  postponeCount: 0, postponeMuted: false, driftingSince: null,
  quotaIntervalMinutes: null, quotaReminders: false, quotaStartedAt: null, quotaAlwaysVisible: false,
  quotaPeriod: 'day',
  ...overrides,
});

const context = (over: Partial<CompletionContext> = {}): CompletionContext => ({
  dayResetTime: '00:00',
  vacationMode: false,
  now: new Date('2026-03-10T09:00:00.000Z'),
  allTasks: [],
  subtasks: [],
  ...over,
});

/** The rows, with the refusal already ruled out — every case below expects one. */
function build(task: Task, options?: Parameters<typeof buildCompletion>[1], ctx?: Partial<CompletionContext>) {
  const built = buildCompletion(task, options, context({ allTasks: [task], ...ctx }));
  if (!built) throw new Error('expected a completion');
  return built;
}

describe('completionRefusal', () => {
  it('lets an ordinary task through', () => {
    expect(completionRefusal(makeTask())).toBeNull();
  });

  it('refuses one that is already completed', () => {
    expect(completionRefusal(makeTask({ completed: true }))).toMatch(/already completed/);
  });

  // There is no tap that finishes "don't smoke" — see Task.polarity.
  it('refuses a negative habit and points at the slip instead', () => {
    expect(completionRefusal(makeTask({ polarity: 'negative' }))).toMatch(/slip/);
  });

  it('refuses a recurring task that is not due yet', () => {
    const later = new Date();
    later.setDate(later.getDate() + 5);
    const task = makeTask({ recurrenceType: 'weekly', dueDate: later.toISOString() });
    expect(completionRefusal(task)).toMatch(/not due yet/);
  });

  // The store returns early on all three; buildCompletion has to agree, or a
  // caller that skipped the check could complete something the app refuses.
  it('is the same answer buildCompletion gives', () => {
    for (const task of [
      makeTask({ completed: true }),
      makeTask({ polarity: 'negative' }),
    ]) {
      expect(completionRefusal(task)).not.toBeNull();
      expect(buildCompletion(task, {}, context())).toBeNull();
    }
  });
});

describe('buildCompletion', () => {
  it('marks the row completed and stamps the time', () => {
    const { completed } = build(makeTask());
    expect(completed.completed).toBe(true);
    expect(completed.completedAt).toBe('2026-03-10T09:00:00.000Z');
    expect(completed.missedAt).toBeNull();
  });

  // The morning check-in's case: "yes, I did this last night".
  it('backdates only the completed row, never the successor', () => {
    const task = makeTask({ recurrenceType: 'daily', dueDate: '2026-03-10T12:00:00.000Z' });
    const { completed, nextTask } = build(task, { completedAt: '2026-03-09T22:00:00.000Z' });

    expect(completed.completedAt).toBe('2026-03-09T22:00:00.000Z');
    // createdAt stays keyed to the real moment the work was recorded.
    expect(nextTask!.createdAt).toBe('2026-03-10T09:00:00.000Z');
  });

  it('records a miss as a completion that is also a miss', () => {
    const { completed } = build(makeTask(), { missed: true });
    expect(completed.completed).toBe(true);
    expect(completed.missedAt).toBe('2026-03-10T09:00:00.000Z');
  });

  it('writes nothing, so a caller decides whether the rows land', () => {
    // The whole contract: it returns rows. A test that had to stand a database
    // up to check a completion would be testing the store instead.
    const { completed, nextTask } = build(makeTask({ recurrenceType: 'daily', dueDate: '2026-03-10T12:00:00.000Z' }));
    expect(completed).not.toBe(nextTask);
    expect(typeof completed.id).toBe('string');
  });

  describe('the successor', () => {
    it('is spawned for a recurring task, with a fresh id and the next date', () => {
      const task = makeTask({ recurrenceType: 'daily', dueDate: '2026-03-10T12:00:00.000Z' });
      const { nextTask } = build(task);

      expect(nextTask).not.toBeNull();
      expect(nextTask!.id).not.toBe(task.id);
      expect(nextTask!.completed).toBe(false);
      expect(nextTask!.previousOccurrenceId).toBe(task.id);
    });

    it('is not spawned for a one-off', () => {
      expect(build(makeTask()).nextTask).toBeNull();
    });

    // #1953: the successor's date came off the grid, so it is the grid's
    // anchor again.
    it('drops the defer and the grid anchor the completed occurrence carried', () => {
      const task = makeTask({
        recurrenceType: 'daily',
        dueDate: '2026-03-10T12:00:00.000Z',
        deferUntil: '2026-03-11T12:00:00.000Z',
        recurrenceAnchorDate: '2026-03-01T12:00:00.000Z',
      });
      const { nextTask } = build(task);
      expect(nextTask!.deferUntil).toBeNull();
      expect(nextTask!.recurrenceAnchorDate).toBeNull();
    });

    it('starts a fresh occurrence with no answer to the question it still asks', () => {
      const task = makeTask({
        recurrenceType: 'daily',
        dueDate: '2026-03-10T12:00:00.000Z',
        deliverableKind: 'text',
      });
      const { completed, nextTask } = build(task, { deliverableValue: 'Blue' });

      expect(completed.deliverableValue).toBe('Blue');
      // The question carries, the answer does not.
      expect(nextTask!.deliverableKind).toBe('text');
      expect(nextTask!.deliverableValue).toBeNull();
    });

    it('carries subtasks over unchecked', () => {
      const task = makeTask({ id: 'parent', recurrenceType: 'daily', dueDate: '2026-03-10T12:00:00.000Z' });
      const sub = makeTask({ id: 'sub', parentId: 'parent', completed: true });
      const { nextTask, nextSubtasks } = build(task, {}, { subtasks: [sub] });

      expect(nextSubtasks).toHaveLength(1);
      expect(nextSubtasks[0].completed).toBe(false);
      expect(nextSubtasks[0].parentId).toBe(nextTask!.id);
      expect(nextSubtasks[0].id).not.toBe('sub');
    });
  });

  describe('the supply', () => {
    const supplyTask = (over: Partial<Task> = {}) => makeTask({
      recurrenceType: 'monthly',
      dueDate: '2026-03-10T12:00:00.000Z',
      supplyCount: 3,
      ...over,
    });

    it('spends one unit per completed occurrence', () => {
      expect(build(supplyTask()).nextTask!.supplyCount).toBe(2);
    });

    // The rule worth not re-deriving: a missed occurrence burns a cycle of the
    // schedule but emphatically not a filter, because nobody changed one.
    it('spends nothing on a miss, unlike the repeat count', () => {
      const { nextTask } = build(supplyTask({ recurrenceCount: 5 }), { missed: true });
      expect(nextTask!.supplyCount).toBe(3);
      expect(nextTask!.recurrenceCount).toBe(4);
    });

    it('floors at zero rather than going negative', () => {
      expect(build(supplyTask({ supplyCount: 0 })).nextTask!.supplyCount).toBe(0);
    });
  });

  describe('the chain', () => {
    const chained = (over: Partial<Task> = {}) => makeTask({
      chainEnabled: true,
      chainItems: [
        { id: 'c1', title: 'Wash', estimatedMinutes: null },
        { id: 'c2', title: 'Dry', estimatedMinutes: null },
        { id: 'c3', title: 'Fold', estimatedMinutes: null },
      ],
      ...over,
    });

    it('advances one step and spawns the next immediately', () => {
      const { nextTask, advancesBySchedule } = build(chained());
      expect(nextTask!.chainIndex).toBe(1);
      // Mid-chain the recurrence's own bookkeeping does not apply.
      expect(advancesBySchedule).toBe(false);
    });

    it('ends after the last step of a chain that does not repeat', () => {
      expect(build(chained({ chainIndex: 2 })).nextTask).toBeNull();
    });

    it('wraps to the first step when the chain repeats', () => {
      const task = chained({ chainIndex: 2, recurrenceType: 'weekly', dueDate: '2026-03-10T12:00:00.000Z' });
      const { nextTask, advancesBySchedule } = build(task);
      expect(nextTask!.chainIndex).toBe(0);
      expect(advancesBySchedule).toBe(true);
    });

    // A miss ends the whole attempt rather than reading as having done step 2.
    it('ends the attempt on a mid-chain miss', () => {
      expect(build(chained(), { missed: true }).nextTask).toBeNull();
    });

    // "repeat 10 times" means ten times through the chain, not ten steps.
    it('burns a cycle of the repeat count only at the wrap', () => {
      const mid = build(chained({ recurrenceType: 'weekly', dueDate: '2026-03-10T12:00:00.000Z', recurrenceCount: 4 }));
      expect(mid.nextTask!.recurrenceCount).toBe(4);

      const wrap = build(chained({ chainIndex: 2, recurrenceType: 'weekly', dueDate: '2026-03-10T12:00:00.000Z', recurrenceCount: 4 }));
      expect(wrap.nextTask!.recurrenceCount).toBe(3);
    });

    it('keeps a pinned chain step pinned through the run', () => {
      expect(build(chained({ pinned: true })).nextTask!.pinned).toBe(true);
    });

    // A date answer that was told to pass itself on places the next step, over
    // both the schedule's guess and "the day this one got done".
    it('lets a date answer place the next step when the step opted in', () => {
      const task = makeTask({
        chainEnabled: true,
        chainIndex: 0,
        chainItems: [
          { id: 'c1', title: 'Book haircut', estimatedMinutes: null, deliverableKind: 'date', deliverableDatesNextStep: true },
          { id: 'c2', title: 'Get haircut', estimatedMinutes: null },
        ],
      });
      const { nextTask } = build(task, { deliverableValue: '2026-04-02T12:00:00.000Z' });
      expect(nextTask!.dueDate?.slice(0, 10)).toBe('2026-04-02');
    });
  });

  describe('the streak', () => {
    it('advances on a recurring completion', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const task = makeTask({
        recurrenceType: 'daily',
        dueDate: new Date().toISOString(),
        streakCount: 4,
        streakDate: yesterday.toISOString(),
      });
      const { completed } = build(task);
      expect(completed.streakCount).toBe(5);
      expect(completed.previousStreakCount).toBe(4);
    });

    it('breaks on a miss, and carries the break onto the successor', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const task = makeTask({
        recurrenceType: 'daily',
        dueDate: new Date().toISOString(),
        streakCount: 4,
        streakDate: yesterday.toISOString(),
      });
      const { completed, nextTask } = build(task, { missed: true });
      expect(completed.streakCount).toBe(0);
      // The streak lives on whichever row is running it, so the successor has
      // to carry the break or it would read as unbroken.
      expect(nextTask!.streakCount).toBe(0);
    });

    it('leaves the streak of a one-off task alone', () => {
      expect(build(makeTask({ streakCount: 3 })).completed.streakCount).toBe(3);
    });
  });

  describe('the deliverable answer', () => {
    // The "nobody asked" read, which is exactly what the MCP layer refuses.
    it('keeps whatever was there when no answer is passed', () => {
      const task = makeTask({ deliverableKind: 'text', deliverableValue: 'Old' });
      expect(build(task, {}).completed.deliverableValue).toBe('Old');
    });

    it('records an answer that was given', () => {
      const task = makeTask({ deliverableKind: 'text', deliverableValue: 'Old' });
      expect(build(task, { deliverableValue: 'New' }).completed.deliverableValue).toBe('New');
    });

    it('treats an explicit null as declining, clearing what was there', () => {
      const task = makeTask({ deliverableKind: 'text', deliverableValue: 'Old' });
      expect(build(task, { deliverableValue: null }).completed.deliverableValue).toBeNull();
    });
  });

  describe('the follow-up task', () => {
    const everyThird = (tally: number) => makeTask({
      title: 'Practice',
      followUpTaskEveryN: 3,
      followUpTaskTitle: 'Rosin the bow',
      followUpTaskTally: tally,
    });

    it('is not earned before the Nth completion', () => {
      const { followUpTask, completed } = build(everyThird(0));
      expect(followUpTask).toBeNull();
      expect(completed.followUpTaskTally).toBe(1);
    });

    it('is earned on the Nth, and names the task that earned it', () => {
      const { followUpTask } = build(everyThird(2));
      expect(followUpTask).not.toBeNull();
      expect(followUpTask!.title).toBe('Rosin the bow');
      expect(followUpTask!.followUpTaskSourceTitle).toBe('Practice');
    });

    // The tally counts completions, and a miss is not one.
    it('is not earned by a miss', () => {
      expect(build(everyThird(2), { missed: true }).followUpTask).toBeNull();
    });

    // Opt-in per rule rather than blanket: a rule whose draft does not pause
    // for a vacation still fires on one.
    it('is withheld during a vacation when the rule asked to be, leaving the tally where it was', () => {
      const task = {
        ...everyThird(2),
        followUpTaskDraft: { vacationPause: true } as Task['followUpTaskDraft'],
      };
      const built = buildCompletion(task, {}, context({ allTasks: [task], vacationMode: true }));
      expect(built!.followUpTask).toBeNull();
      // Not reset, so the first completion after the vacation fires for real.
      expect(built!.completed.followUpTaskTally).toBe(2);
    });

    it('is withheld while one of its own is still outstanding', () => {
      const task = everyThird(2);
      const outstanding = makeTask({ id: 'open', title: 'Rosin the bow' });
      const built = buildCompletion(
        { ...task, followUpTaskOneAtATime: true },
        {},
        context({ allTasks: [task, outstanding] }),
      );
      expect(built!.followUpTask).toBeNull();
    });
  });

  describe('the dated series', () => {
    it('waits for every date in the set before laying out the next one', () => {
      const first = makeTask({
        id: 'a', seriesId: 's1', seriesMonthDays: [10, 15], seriesRepeatMonths: 1,
        dueDate: '2026-03-10T12:00:00.000Z',
      });
      // Every row of a set carries the repeat, because buildSeriesRow puts it
      // on each one — whichever date is finished last is what triggers the
      // rollover, so any of them has to be able to.
      const second = makeTask({
        id: 'b', seriesId: 's1', seriesMonthDays: [10, 15], seriesRepeatMonths: 1,
        dueDate: '2026-03-15T12:00:00.000Z',
      });

      // The 15th is still outstanding, so finishing the 10th conjures nothing.
      expect(build(first, {}, { allTasks: [first, second] }).rolledOver).toEqual([]);

      // Whichever date is finished last is the one that triggers it.
      const done = { ...first, completed: true };
      const { rolledOver } = build(second, {}, { allTasks: [done, second] });
      expect(rolledOver).toHaveLength(2);
      expect(rolledOver.every(r => r.previousOccurrenceId === 'b')).toBe(true);
    });

    it('rebuilds from the stored day numbers rather than shifting the dates', () => {
      const only = makeTask({
        id: 'a', seriesId: 's1', seriesMonthDays: [31], seriesRepeatMonths: 1,
        dueDate: '2026-01-31T12:00:00.000Z',
      });
      const { rolledOver } = build(only, {}, { allTasks: [only] });
      expect(rolledOver).toHaveLength(1);
      // February clamps the 31st to the 28th for this set. What matters is
      // that the clamp does not feed forward: the stored day number is still
      // 31, so March comes back as the 31st rather than drifting to the 28th
      // for ever. Same fix getNextSeriesDates applies for a dated series.
      expect(new Date(rolledOver[0].dueDate!).getDate()).toBe(28);
      expect(rolledOver[0].seriesMonthDays).toEqual([31]);
    });
  });
});
