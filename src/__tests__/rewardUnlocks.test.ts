import type { CoinEntry, RewardUnlock, Task } from '../types';
import {
  addPlayTime,
  cleanPlayMinutes,
  cleanUnlockSharePct,
  coinsEarnedToday,
  coinsShortOf,
  coinsStillOpenToday,
  describePlayMinutes,
  formatPlayClock,
  playState,
  playedToday,
  repointRequired,
  requiredToday,
  startPlay,
  statusOfUnlock,
  stopPlay,
  unlockStatus,
  workShareDone,
} from '../utils/rewardUnlocks';
import { BALANCE_RESET_LABEL } from '../utils/rewards';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const TODAY = new Date(2026, 10, 4); // a Wednesday
const KEY = '2026-11-04';
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m);

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, completed: false, completedAt: null, missedAt: null, parentId: null, previousOccurrenceId: null,
  seriesId: null, generatedKind: null, polarity: 'positive', estimatedMinutes: 30, difficulty: null, bountyPushes: null,
  createdAt: '2026-11-01T00:00:00.000Z', ...extra,
} as unknown as Task);

const unlock = (extra: Partial<RewardUnlock> = {}): RewardUnlock => ({
  id: 'u', title: 'Switch', glyph: null, createdAt: '', sharePct: 60, requiredTaskIds: [], playMinutes: 120,
  freeOnWeekends: false, freeOnVacation: false, guardsTaskId: null, pin: null,
  playDay: null, playUsedMs: 0, playExtraMs: 0, playStartedAt: null, ...extra,
});

const earn = (amount: number, when: Date, extra: Partial<CoinEntry> = {}): CoinEntry => ({
  id: `${amount}-${when.getTime()}`, kind: 'earn', amount, at: when.toISOString(), taskId: 't', rewardId: null, label: 'x', ...extra,
});

describe('cleaning', () => {
  it('keeps the share and the play time in range', () => {
    expect(cleanUnlockSharePct(0)).toBe(5);
    expect(cleanUnlockSharePct(120)).toBe(100);
    expect(cleanUnlockSharePct(undefined)).toBe(60);
    expect(cleanPlayMinutes(0)).toBeNull();
    expect(cleanPlayMinutes(13 * 60)).toBe(12 * 60);
  });
});

describe("today's work", () => {
  it('counts only earnings made today, and no reset', () => {
    const entries = [
      earn(5, at(9)),
      earn(3, new Date(2026, 10, 3, 22)),
      earn(4, at(10), { kind: 'loss' }),
      earn(9, at(11), { taskId: null, label: BALANCE_RESET_LABEL }),
    ];
    expect(coinsEarnedToday(entries, TODAY)).toBe(5);
  });

  it('counts what open tasks would pay, leaving out habits, subtasks and done ones', () => {
    const open = [
      task('a', { estimatedMinutes: 30 }),
      task('b', { completed: true }),
      task('c', { parentId: 'a' }),
      task('d', { polarity: 'negative' } as Partial<Task>),
      task('e', { difficulty: 'trivial' }),
    ];
    expect(coinsStillOpenToday(open)).toBe(coinsStillOpenToday([task('a', { estimatedMinutes: 30 })]));
    expect(coinsStillOpenToday([task('e', { difficulty: 'trivial' })])).toBe(0);
  });

  it('reads an empty day as done', () => {
    expect(workShareDone(0, 0)).toBe(1);
    expect(workShareDone(6, 4)).toBe(0.6);
  });

  it('says how many coins are left to earn', () => {
    expect(coinsShortOf(60, 6, 4)).toBe(0);
    expect(coinsShortOf(60, 3, 7)).toBe(3);
  });
});

describe('required tasks', () => {
  it('asks only for a required task due today, and any occurrence counts', () => {
    const first = task('w1', { completed: true, completedAt: '2026-11-01T09:00:00.000Z' });
    const second = task('w2', { previousOccurrenceId: 'w1' });
    const result = requiredToday(['w1'], [first, second], [second], TODAY);
    expect(result.pending.map(t => t.id)).toEqual(['w2']);
  });

  it('is met once it is done today', () => {
    const done = task('w2', { previousOccurrenceId: 'w1', completed: true, completedAt: at(8).toISOString() });
    const next = task('w3', { previousOccurrenceId: 'w2' });
    const result = requiredToday(['w2'], [done, next], [], TODAY);
    expect(result.pending).toEqual([]);
    expect(result.done.map(t => t.id)).toEqual(['w2']);
  });

  it('does not count a miss as done', () => {
    const missed = task('w2', { completed: true, completedAt: at(8).toISOString(), missedAt: at(8).toISOString() });
    const result = requiredToday(['w2'], [missed], [], TODAY);
    expect(result.done).toEqual([]);
  });

  it('asks nothing of a task not due today', () => {
    expect(requiredToday(['w1'], [task('w1')], [], TODAY)).toEqual({ pending: [], done: [] });
  });

  it('still finds the family once the stored row has been purged', () => {
    const next = task('w2', { previousOccurrenceId: 'w1' });
    expect(requiredToday(['w1'], [next], [next], TODAY).pending.map(t => t.id)).toEqual(['w2']);
  });

  it('moves a requirement to the newest row', () => {
    const first = task('w1', { completed: true, createdAt: '2026-11-01T00:00:00.000Z' });
    const second = task('w2', { previousOccurrenceId: 'w1', createdAt: '2026-11-02T00:00:00.000Z' });
    expect(repointRequired(['w1'], [first, second])).toEqual(['w2']);
    expect(repointRequired(['w2'], [first, second])).toBeNull();
  });
});

describe('unlockStatus', () => {
  const inputs = { earned: 6, open: 4, pending: [] as Task[], weekend: false, vacation: false, played: false };

  it('opens once the share of the work is done', () => {
    expect(unlockStatus(unlock(), inputs).kind).toBe('open');
    expect(unlockStatus(unlock(), { ...inputs, earned: 3, open: 7 })).toMatchObject({ kind: 'locked', coinsShort: 3 });
  });

  it('stays locked while a required task is outstanding', () => {
    expect(unlockStatus(unlock(), { ...inputs, pending: [task('w')] }).kind).toBe('locked');
  });

  it('is free on a weekend or on vacation when set to be', () => {
    const locked = { ...inputs, earned: 0, open: 10 };
    expect(unlockStatus(unlock({ freeOnWeekends: true }), { ...locked, weekend: true })).toEqual({ kind: 'free', reason: 'weekend' });
    expect(unlockStatus(unlock({ freeOnVacation: true }), { ...locked, vacation: true })).toEqual({ kind: 'free', reason: 'vacation' });
    expect(unlockStatus(unlock(), { ...locked, weekend: true }).kind).toBe('locked');
  });

  it('stays open for the day once play has started', () => {
    expect(unlockStatus(unlock(), { ...inputs, earned: 0, open: 10, played: true }).kind).toBe('open');
  });

  it('reads the whole world for one unlock', () => {
    const world = { entries: [earn(10, at(9))], tasks: [], onToday: [], todayStart: TODAY, todayKey: KEY, vacation: false };
    expect(statusOfUnlock(unlock(), world).status.kind).toBe('open');
  });
});

describe('play time', () => {
  it('runs from a start until the allowance is used', () => {
    const started = { ...unlock(), ...startPlay(unlock(), at(19), KEY) };
    const mid = playState(started, at(20), KEY);
    expect(mid).toMatchObject({ running: true, remainingMs: 60 * 60_000 });
    expect(mid.endsAt).toEqual(at(21));
    expect(playState(started, at(21, 30), KEY)).toMatchObject({ running: false, remainingMs: 0 });
    expect(playedToday(started, KEY)).toBe(true);
  });

  it('carries on from what is left after a stop', () => {
    let u = { ...unlock(), ...startPlay(unlock(), at(19), KEY) };
    u = { ...u, ...stopPlay(u, at(20), KEY) };
    expect(u.playUsedMs).toBe(60 * 60_000);
    u = { ...u, ...startPlay(u, at(21), KEY) };
    expect(playState(u, at(21), KEY).endsAt).toEqual(at(22));
  });

  it('adds time to today, picking up again if it had run out', () => {
    let u = { ...unlock(), ...startPlay(unlock(), at(19), KEY) };
    u = { ...u, ...addPlayTime(u, 15, at(21, 30), KEY) };
    const state = playState(u, at(21, 30), KEY);
    expect(state).toMatchObject({ running: true, remainingMs: 15 * 60_000 });
    expect(state.endsAt).toEqual(at(21, 45));
  });

  it('starts each day afresh', () => {
    const yesterday = unlock({ playDay: '2026-11-03', playUsedMs: 120 * 60_000 });
    expect(playState(yesterday, at(9), KEY)).toMatchObject({ running: false, remainingMs: 120 * 60_000 });
    expect(playedToday(yesterday, KEY)).toBe(false);
  });

  it('has no allowance with no play time', () => {
    const u = { ...unlock({ playMinutes: null }), ...startPlay(unlock({ playMinutes: null }), at(19), KEY) };
    expect(playState(u, at(23), KEY)).toMatchObject({ running: true, remainingMs: null, endsAt: null });
  });

  it('formats the clock and the length', () => {
    expect(formatPlayClock(5_077_000)).toBe('1:24:37');
    expect(formatPlayClock(65_000)).toBe('1:05');
    expect(describePlayMinutes(120)).toBe('2 hours');
    expect(describePlayMinutes(60)).toBe('1 hour');
    expect(describePlayMinutes(90)).toBe('90 minutes');
  });
});
