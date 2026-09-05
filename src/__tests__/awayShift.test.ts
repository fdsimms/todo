import type { Task } from '../types';

// awayShift reaches dateUtils, which reaches the settings store, which reaches
// expo-sqlite. Same stub the other pure tests use.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

import {
  awayShiftUpdates,
  buildAwayShiftPlan,
  describeAwayShift,
  hasAnchoredMember,
} from '../utils/awayShift';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);
const iso = (y: number, m: number, d: number) => at(y, m, d).toISOString();

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  title: 'Task',
  notes: '',
  completed: false,
  completedAt: null,
  archived: false,
  parentId: null,
  dueDate: null,
  deferUntil: null,
  recurrenceType: 'none',
  recurrenceAnchorDate: null,
  seriesId: null,
  // Everything deloadBlockerFor reads, at its "nothing in the way" value —
  // `targetCount: undefined` alone reads as a daily target and hard-blocks
  // every row.
  pinned: false,
  timerStartedAt: null,
  timerElapsedSeconds: 0,
  priority: 0,
  targetCount: null,
  chainEnabled: false,
  chainItems: [],
  chainIndex: 0,
  streakCount: 0,
  personIds: [],
  ...over,
} as unknown as Task);

/** The trip moved from the 10th to the 12th: two days later. */
const shift = (tasks: Task[]) => buildAwayShiftPlan(tasks, at(2026, 6, 10), at(2026, 6, 12));

describe('buildAwayShiftPlan', () => {
  it('is empty when the departure did not move', () => {
    const plan = buildAwayShiftPlan([task({ dueDate: iso(2026, 6, 5) })], at(2026, 6, 10), at(2026, 6, 10));
    expect(plan.deltaDays).toBe(0);
    expect(plan.proposals).toEqual([]);
  });

  it('moves a dated member by the delta', () => {
    const plan = shift([task({ dueDate: iso(2026, 6, 5) })]);
    expect(plan.deltaDays).toBe(2);
    expect(plan.proposals[0].destination!.getDate()).toBe(7);
    expect(plan.proposals[0].selected).toBe(true);
  });

  it('moves earlier when the trip came forward', () => {
    const plan = buildAwayShiftPlan([task({ dueDate: iso(2026, 6, 8) })], at(2026, 6, 10), at(2026, 6, 7));
    expect(plan.deltaDays).toBe(-3);
    expect(plan.proposals[0].destination!.getDate()).toBe(5);
  });

  it('skips an undated member rather than scheduling it', () => {
    // Inventing a date out of the trip's own would schedule work the user
    // deliberately left unscheduled.
    expect(shift([task()]).proposals).toEqual([]);
  });

  it('skips completed, archived rows and subtasks', () => {
    const plan = shift([
      task({ dueDate: iso(2026, 6, 5), completed: true }),
      task({ dueDate: iso(2026, 6, 5), archived: true }),
      task({ dueDate: iso(2026, 6, 5), parentId: 'parent' }),
    ]);
    expect(plan.proposals).toEqual([]);
  });

  it('reads the effective date, so a deferred row moves from where it shows', () => {
    const plan = shift([task({ dueDate: iso(2026, 6, 1), deferUntil: iso(2026, 6, 5) })]);
    expect(plan.proposals[0].from.getDate()).toBe(5);
    expect(plan.proposals[0].destination!.getDate()).toBe(7);
  });

  it('lands every destination at midday', () => {
    const plan = shift([task({ dueDate: iso(2026, 6, 5) })]);
    expect(plan.proposals[0].destination!.getHours()).toBe(12);
  });

  it('orders the furthest-out row first', () => {
    const plan = shift([
      task({ id: 'near', dueDate: iso(2026, 6, 2) }),
      task({ id: 'far', dueDate: iso(2026, 6, 8) }),
    ]);
    expect(plan.proposals.map(p => p.task.id)).toEqual(['far', 'near']);
  });
});

describe('awayShiftUpdates', () => {
  it('is null for a row nothing can move', () => {
    const plan = shift([task({ dueDate: iso(2026, 6, 5) })]);
    expect(awayShiftUpdates({ ...plan.proposals[0], destination: null })).toBeNull();
  });

  it('reschedules a plain task', () => {
    const plan = shift([task({ dueDate: iso(2026, 6, 5) })]);
    const updates = awayShiftUpdates(plan.proposals[0])!;
    expect(updates.dueDate).toBe(iso(2026, 6, 7));
    expect(updates.deferUntil).toBeNull();
  });

  it('defers a recurring member pushed out, leaving its grid alone', () => {
    const plan = shift([task({ dueDate: iso(2026, 6, 5), recurrenceType: 'daily' })]);
    expect(awayShiftUpdates(plan.proposals[0])).toEqual({ deferUntil: iso(2026, 6, 7) });
  });

  it('keeps an anchor when a recurring member is pulled forward', () => {
    // The reason the pull arm had to come out of TaskItem: a shift is the
    // first caller that moves an anchored row backwards.
    const plan = buildAwayShiftPlan(
      [task({ dueDate: iso(2026, 6, 8), recurrenceType: 'daily' })],
      at(2026, 6, 10), at(2026, 6, 7),
    );
    const updates = awayShiftUpdates(plan.proposals[0])!;
    expect(updates.dueDate).toBe(iso(2026, 6, 5));
    expect(updates.recurrenceAnchorDate).toBe(iso(2026, 6, 8));
  });
});

describe('describeAwayShift', () => {
  it('counts the rows and names the direction', () => {
    expect(describeAwayShift(shift([
      task({ dueDate: iso(2026, 6, 5) }),
      task({ dueDate: iso(2026, 6, 6) }),
    ]))).toBe('2 tasks move 2 days later');
  });

  it('reads singular for one row and one day', () => {
    const plan = buildAwayShiftPlan([task({ dueDate: iso(2026, 6, 5) })], at(2026, 6, 10), at(2026, 6, 11));
    expect(describeAwayShift(plan)).toBe('1 task moves 1 day later');
  });

  it('says earlier when the trip came forward', () => {
    const plan = buildAwayShiftPlan([task({ dueDate: iso(2026, 6, 5) })], at(2026, 6, 10), at(2026, 6, 8));
    expect(describeAwayShift(plan)).toBe('1 task moves 2 days earlier');
  });
});

describe('hasAnchoredMember', () => {
  it('is true only when a recurring member would move', () => {
    expect(hasAnchoredMember(shift([task({ dueDate: iso(2026, 6, 5) })]))).toBe(false);
    expect(hasAnchoredMember(shift([
      task({ dueDate: iso(2026, 6, 5), recurrenceType: 'daily' }),
    ]))).toBe(true);
  });
});
