import { addDays } from 'date-fns/addDays';
import { buildDeloadPlan, deloadUpdates } from '../utils/deloadPlan';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ getCategoryByName: () => null }),
  },
}));

const BASE: Task = {
  id: 'task-1',
  title: 'Test',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: new Date().toISOString(),
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
  sortOrder: 0,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  reminderTime: null,
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
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
  blockedById: null,
};

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const today = new Date();

describe('buildDeloadPlan', () => {
  describe('proposals', () => {
    it('proposes a future destination for a movable task', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, dueDate: today.toISOString() });
      const plan = buildDeloadPlan([task], [task]);

      expect(plan.proposals).toHaveLength(1);
      const [p] = plan.proposals;
      expect(p.selected).toBe(true);
      expect(p.blocker).toBeNull();
      expect(p.date).not.toBeNull();
      expect(p.date!.getTime()).toBeGreaterThan(today.getTime());
      expect(p.reason).toBeTruthy();
    });

    it('orders proposals biggest-first so the top row recovers the most time', () => {
      const small = makeTask({ id: 'small', estimatedMinutes: 15 });
      const big = makeTask({ id: 'big', estimatedMinutes: 90 });
      const mid = makeTask({ id: 'mid', estimatedMinutes: 45 });

      const plan = buildDeloadPlan([small, big, mid], [small, big, mid]);
      expect(plan.proposals.map(p => p.task.id)).toEqual(['big', 'mid', 'small']);
    });

    it('falls back to the effort bucket when a task has no explicit estimate', () => {
      // effort 3 === S === 30 canonical minutes
      const task = makeTask({ id: 'a', effort: 3, estimatedMinutes: null });
      const plan = buildDeloadPlan([task], [task]);
      expect(plan.proposals[0].minutes).toBe(30);
    });

    it('ignores subtasks, completed and archived tasks', () => {
      const sub = makeTask({ id: 'sub', parentId: 'a', estimatedMinutes: 30 });
      const done = makeTask({ id: 'done', completed: true, estimatedMinutes: 30 });
      const gone = makeTask({ id: 'gone', archived: true, estimatedMinutes: 30 });
      const real = makeTask({ id: 'real', estimatedMinutes: 30 });

      const plan = buildDeloadPlan([sub, done, gone, real], [sub, done, gone, real]);
      expect(plan.proposals.map(p => p.task.id)).toEqual(['real']);
      expect(plan.currentMinutes).toBe(30);
    });
  });

  describe('greedy re-scoring', () => {
    it('spreads tasks across days instead of stacking them all on the lightest one', () => {
      // Four identical tasks: scored against an untouched list they would all
      // pick the same day, which would defeat the point of lightening the day.
      const tasks = Array.from({ length: 4 }, (_, i) =>
        makeTask({ id: `t${i}`, estimatedMinutes: 30, dueDate: today.toISOString() })
      );

      const plan = buildDeloadPlan(tasks, tasks);
      const days = plan.proposals.map(p => isoDate(p.date!));
      expect(new Set(days).size).toBe(4);
    });

    it('does not let a blocked task occupy a destination day', () => {
      const pinned = makeTask({ id: 'pinned', pinned: true, estimatedMinutes: 90 });
      const movable = makeTask({ id: 'movable', estimatedMinutes: 30 });

      const plan = buildDeloadPlan([pinned, movable], [pinned, movable]);
      const movableProposal = plan.proposals.find(p => p.task.id === 'movable')!;

      // With nothing else scheduled, the movable task should still get the
      // nearest day — the pinned row must not have consumed it.
      expect(isoDate(movableProposal.date!)).toBe(isoDate(addDays(today, 1)));
    });
  });

  describe('blockers', () => {
    it.each([
      ['pinned', { pinned: true }],
      ['running', { timerStartedAt: new Date().toISOString() }],
      ['urgent', { priority: 4 as const }],
      ['quota', { targetCount: 8 }],
      ['chain', { chainEnabled: true, chainItems: [{ id: 'c1', title: 'a', notes: '' }], chainIndex: 1 }],
    ])('blocks a %s task outright', (blocker, overrides) => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, ...overrides });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.blocker).toBe(blocker);
      expect(p.date).toBeNull();
      expect(p.selected).toBe(false);
      expect(p.blockerLabel).toBeTruthy();
    });

    it('lists a streak task as movable but unchecked, naming the streak', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, streakCount: 12 });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.blocker).toBe('streak');
      expect(p.blockerLabel).toBe('12-day streak');
      expect(p.selected).toBe(false);
      // Soft — the user can still opt in, so a destination is offered.
      expect(p.date).not.toBeNull();
    });

    it('leaves a task with banked countdown time unchecked but movable', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, timedMinutes: 15, timerElapsedSeconds: 300 });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.blocker).toBe('started');
      expect(p.blockerLabel).toBe('Already started');
      expect(p.selected).toBe(false);
      expect(p.date).not.toBeNull();
    });

    it('treats an untouched timed task as ordinary', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, timedMinutes: 15, timerElapsedSeconds: 0 });
      const plan = buildDeloadPlan([task], [task]);
      expect(plan.proposals[0].blocker).toBeNull();
      expect(plan.proposals[0].selected).toBe(true);
    });

    it('leaves a high-priority task unchecked but movable', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, priority: 3 });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.blocker).toBe('high-priority');
      expect(p.selected).toBe(false);
      expect(p.date).not.toBeNull();
    });

    it('does not treat a first-day streak as a streak worth protecting', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, streakCount: 1 });
      const plan = buildDeloadPlan([task], [task]);
      expect(plan.proposals[0].blocker).toBeNull();
      expect(plan.proposals[0].selected).toBe(true);
    });

    it('blocks a task whose deadline is today', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, deadline: today.toISOString() });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.blocker).toBe('deadline');
      expect(p.date).toBeNull();
      expect(p.selected).toBe(false);
    });

    it('allows a task with a comfortably distant deadline to move', () => {
      const task = makeTask({
        id: 'a',
        estimatedMinutes: 30,
        deadline: addDays(today, 30).toISOString(),
      });
      const plan = buildDeloadPlan([task], [task]);
      expect(plan.proposals[0].blocker).toBeNull();
      expect(plan.proposals[0].date).not.toBeNull();
    });
  });

  describe('mode', () => {
    it('defers a recurring task so its schedule grid is not rotated', () => {
      const task = makeTask({
        id: 'a',
        estimatedMinutes: 30,
        recurrenceType: 'weekly',
        dueDate: today.toISOString(),
      });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.mode).toBe('defer');
      const updates = deloadUpdates(p)!;
      expect(updates.deferUntil).toBe(p.date!.toISOString());
      expect(updates.dueDate).toBeUndefined();
    });

    it('defers a series member so its hand-picked date survives', () => {
      const task = makeTask({
        id: 'a',
        estimatedMinutes: 30,
        seriesId: 'series-1',
        seriesMonthDays: [10, 15],
        dueDate: today.toISOString(),
      });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.mode).toBe('defer');
      const updates = deloadUpdates(p)!;
      expect(updates.dueDate).toBeUndefined();
      expect(updates.deferUntil).toBe(p.date!.toISOString());
    });

    it('reschedules a one-off task so it does not arrive labelled overdue', () => {
      const task = makeTask({ id: 'a', estimatedMinutes: 30, dueDate: today.toISOString() });
      const plan = buildDeloadPlan([task], [task]);
      const [p] = plan.proposals;

      expect(p.mode).toBe('reschedule');
      const updates = deloadUpdates(p)!;
      expect(updates.dueDate).toBe(p.date!.toISOString());
      expect(updates.deferUntil).toBeNull();
    });

    it('returns no updates for a task that cannot move', () => {
      const task = makeTask({ id: 'a', pinned: true, estimatedMinutes: 30 });
      const plan = buildDeloadPlan([task], [task]);
      expect(deloadUpdates(plan.proposals[0])).toBeNull();
    });
  });

  describe('totals', () => {
    it('reports the day total and what it becomes after the checked moves', () => {
      const a = makeTask({ id: 'a', estimatedMinutes: 90 });
      const b = makeTask({ id: 'b', estimatedMinutes: 30 });
      const pinned = makeTask({ id: 'pinned', estimatedMinutes: 60, pinned: true });

      const plan = buildDeloadPlan([a, b, pinned], [a, b, pinned]);

      expect(plan.currentMinutes).toBe(180);
      // Only a and b are checked; the pinned hour stays.
      expect(plan.projectedMinutes).toBe(60);
    });

    it('leaves the total untouched when nothing can move', () => {
      const pinned = makeTask({ id: 'p', estimatedMinutes: 45, pinned: true });
      const plan = buildDeloadPlan([pinned], [pinned]);

      expect(plan.currentMinutes).toBe(45);
      expect(plan.projectedMinutes).toBe(45);
    });

    it('returns an empty plan for an empty day', () => {
      const plan = buildDeloadPlan([], []);
      expect(plan.proposals).toEqual([]);
      expect(plan.currentMinutes).toBe(0);
      expect(plan.projectedMinutes).toBe(0);
    });
  });
});
