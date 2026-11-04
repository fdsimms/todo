import type { CoinEntry, RewardUnlock, Task } from '../types';
import {
  addPlayTime,
  cleanPlayMinutes,
  cleanIgnoreAfter,
  cleanIgnoreList,
  cleanUnlockSharePct,
  renameInIgnoreList,
  coinsEarnedToday,
  coinsShortOf,
  coinsStillOpenToday,
  describePlayMinutes,
  isAfterCutoff,
  formatPlayClock,
  playState,
  playedToday,
  repointRequired,
  requiredToday,
  startPlay,
  statusOfUnlock,
  stopPlay,
  joinPhrases,
  lockedUnlockNeeding,
  unlockLooseningsOf,
  unlockStatus,
  workCoinsToday,
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

describe('unlockLooseningsOf', () => {
  const base = { title: 'Switch', glyph: null, sharePct: 60, requiredTaskIds: ['a', 'b'], playMinutes: 120, freeOnWeekends: false, freeOnVacation: false, guardsTaskId: 'h', pin: null };

  it('lists what would make it easier to open', () => {
    expect(unlockLooseningsOf(base, { ...base, sharePct: 40 })).toEqual(['lower the percentage']);
    expect(unlockLooseningsOf(base, { ...base, requiredTaskIds: ['a'] })).toEqual(['remove a task from Also needs']);
    expect(unlockLooseningsOf(base, { ...base, requiredTaskIds: ['a', 'c'] })).toEqual(['remove a task from Also needs']);
    expect(unlockLooseningsOf(base, { ...base, freeOnWeekends: true, freeOnVacation: true })).toEqual(['open it all weekend', 'open it all vacation']);
    expect(unlockLooseningsOf(base, { ...base, guardsTaskId: null })).toEqual(['unlink its habit']);
  });

  it('allows anything that is the same or harder, and changes that do not decide opening', () => {
    expect(unlockLooseningsOf(base, { ...base, sharePct: 80, requiredTaskIds: ['a', 'b', 'c'], title: 'Switch 2', glyph: '🎮', playMinutes: 30, pin: '1' })).toEqual([]);
    expect(unlockLooseningsOf({ ...base, guardsTaskId: null }, { ...base, guardsTaskId: 'h' })).toEqual([]);
  });

  it('joins phrases', () => {
    expect(joinPhrases(['a'])).toBe('a');
    expect(joinPhrases(['a', 'b'])).toBe('a or b');
    expect(joinPhrases(['a', 'b', 'c'])).toBe('a, b or c');
  });
});

describe('the cutoff time', () => {
  it('cleans to a valid HH:MM or null', () => {
    expect(cleanIgnoreAfter('8:05')).toBe('08:05');
    expect(cleanIgnoreAfter('20:30')).toBe('20:30');
    expect(cleanIgnoreAfter('25:00')).toBeNull();
    expect(cleanIgnoreAfter('nope')).toBeNull();
    expect(cleanIgnoreAfter(null)).toBeNull();
  });

  it('is after only a task whose window starts at or after it', () => {
    expect(isAfterCutoff(task('a', { windowStart: '20:00' }), '20:00', TODAY)).toBe(true);
    expect(isAfterCutoff(task('a', { windowStart: '21:30' }), '20:00', TODAY)).toBe(true);
    expect(isAfterCutoff(task('a', { windowStart: '19:59' }), '20:00', TODAY)).toBe(false);
    expect(isAfterCutoff(task('a'), '20:00', TODAY)).toBe(false);
    expect(isAfterCutoff(task('a', { windowStart: '21:00' }), null, TODAY)).toBe(false);
  });

  it('leaves late tasks out of both the open and the earned side', () => {
    const day = task('day', { estimatedMinutes: 30 });
    const bed = task('bed', { estimatedMinutes: 30, windowStart: '21:00' });
    const doneBed = task('doneBed', { completed: true, windowStart: '21:00' });
    const entries = [earn(5, at(9), { taskId: 'doneBed' }), earn(3, at(8), { taskId: 'gone' }), earn(2, at(7), { taskId: 'day' })];
    const byId = new Map([day, bed, doneBed].map(t => [t.id, t]));
    const lateTask = (t: Task) => isAfterCutoff(t, '20:00', TODAY);
    const lateEntry = (id: string) => { const t = byId.get(id); return !!t && lateTask(t); };

    expect(coinsEarnedToday(entries, TODAY)).toBe(10);
    // The bedtime earning drops out; a purged task's earning and a daytime one stay.
    expect(coinsEarnedToday(entries, TODAY, lateEntry)).toBe(5);
    expect(coinsStillOpenToday([day, bed], lateTask)).toBe(coinsStillOpenToday([day]));
    expect(coinsStillOpenToday([day, bed])).toBeGreaterThan(coinsStillOpenToday([day]));

  });

  it('leaves target tasks out of both sides, so cups still to drink do not hold it shut', () => {
    const plain = task('plain', { estimatedMinutes: 30 });
    const cups = task('cups', { estimatedMinutes: 30, targetCount: 15, progressCount: 7 });
    const doneCups = task('doneCups', { completed: true, targetCount: 15 });
    const entries = [earn(5, at(9), { taskId: 'plain' }), earn(4, at(10), { taskId: 'doneCups' }), earn(2, at(11), { taskId: 'gone' })];
    const world = { entries, tasks: [plain, cups, doneCups], onToday: [plain, cups], todayStart: TODAY, todayKey: KEY, vacation: false };
    const { earned, open } = workCoinsToday({ ignoreAfter: null }, world);
    // The target task's open coins and its earning drop out; a purged task's earning stays.
    expect(earned).toBe(7);
    expect(open).toBe(coinsStillOpenToday([plain]));
    expect(coinsStillOpenToday([plain, cups])).toBeGreaterThan(open);
  });

  it('leaves out tasks filed in a listed category, stack or project, on both sides', () => {
    const plain = task('plain', { estimatedMinutes: 30 });
    const evening = task('evening', { estimatedMinutes: 30, groupId: 'g1' });
    const hobby = task('hobby', { estimatedMinutes: 30, category: 'Hobbies' });
    const wedding = task('wedding', { estimatedMinutes: 30, projectId: 'p1' });
    const doneEvening = task('doneEvening', { completed: true, groupId: 'g1' });
    const entries = [earn(5, at(9), { taskId: 'plain' }), earn(4, at(10), { taskId: 'doneEvening' }), earn(2, at(11), { taskId: 'gone' })];
    const ignoreList = { categories: ['Hobbies'], stackIds: ['g1'], projectIds: ['p1'] };
    const world = { entries, tasks: [plain, evening, hobby, wedding, doneEvening], onToday: [plain, evening, hobby, wedding], todayStart: TODAY, todayKey: KEY, vacation: false };
    const { earned, open } = workCoinsToday({ ignoreAfter: null, ignoreList }, world);
    expect(earned).toBe(7); // the done stack task drops out; a purged task's earning stays
    expect(open).toBe(coinsStillOpenToday([plain]));
    expect(workCoinsToday({ ignoreAfter: null, ignoreList: null }, world).open).toBeGreaterThan(open);
  });

  it('cleans a leave-out list and follows a category rename', () => {
    expect(cleanIgnoreList(null)).toBeNull();
    expect(cleanIgnoreList({ categories: [], stackIds: [''], projectIds: [] })).toBeNull();
    expect(cleanIgnoreList({ categories: ['A', 'A'], stackIds: ['s'] })).toEqual({ categories: ['A'], stackIds: ['s'], projectIds: [] });
    const list = { categories: ['Hobbies', 'Fun'], stackIds: [], projectIds: [] };
    expect(renameInIgnoreList(list, 'Hobbies', 'Play')).toEqual({ categories: ['Play', 'Fun'], stackIds: [], projectIds: [] });
    expect(renameInIgnoreList(list, 'Hobbies', 'Fun').categories).toEqual(['Fun']);
    expect(renameInIgnoreList(list, 'Other', 'X')).toBe(list);
    expect(renameInIgnoreList(null, 'Other', 'X')).toBeNull();
  });

  it('counts adding to the leave-out list as loosening, and removing from it as not', () => {
    const base = { title: 'a', glyph: null, sharePct: 60, requiredTaskIds: [], playMinutes: 60, freeOnWeekends: false, freeOnVacation: false, ignoreAfter: null, guardsTaskId: null, blockGroupId: null, pin: null };
    const some = { categories: ['Hobbies'], stackIds: [], projectIds: [] };
    const words = ['leave out more categories, stacks or projects'];
    expect(unlockLooseningsOf({ ...base, ignoreList: null }, { ...base, ignoreList: some })).toEqual(words);
    expect(unlockLooseningsOf({ ...base, ignoreList: some }, { ...base, ignoreList: { ...some, stackIds: ['g'] } })).toEqual(words);
    expect(unlockLooseningsOf({ ...base, ignoreList: some }, { ...base, ignoreList: null })).toEqual([]);
    expect(unlockLooseningsOf({ ...base, ignoreList: some }, { ...base, ignoreList: some })).toEqual([]);
  });

  it('counts setting or moving it earlier as loosening, and removing or delaying it as not', () => {
    const base = { title: 'a', glyph: null, sharePct: 60, requiredTaskIds: [], playMinutes: 60, freeOnWeekends: false, freeOnVacation: false, guardsTaskId: null, pin: null };
    const words = ['ignore tasks that start later in the day'];
    expect(unlockLooseningsOf({ ...base, ignoreAfter: null }, { ...base, ignoreAfter: '20:00' })).toEqual(words);
    expect(unlockLooseningsOf({ ...base, ignoreAfter: '20:00' }, { ...base, ignoreAfter: '18:00' })).toEqual(words);
    expect(unlockLooseningsOf({ ...base, ignoreAfter: '20:00' }, { ...base, ignoreAfter: '21:00' })).toEqual([]);
    expect(unlockLooseningsOf({ ...base, ignoreAfter: '20:00' }, { ...base, ignoreAfter: null })).toEqual([]);
  });
});

describe('deleting a required task', () => {
  const w1 = task('w1');
  const w2 = task('w2', { previousOccurrenceId: 'w1' });
  const lockedWorld = { entries: [], tasks: [w1, w2], onToday: [w1], todayStart: TODAY, todayKey: KEY, vacation: false };
  const openWorld = { ...lockedWorld, onToday: [] };

  it('refuses a required task while its unlock is locked, and any occurrence of it', () => {
    const u = unlock({ requiredTaskIds: ['w1'] });
    expect(lockedUnlockNeeding(w1, [w1, w2], [u], lockedWorld)).toBe(u);
    expect(lockedUnlockNeeding(w2, [w1, w2], [u], lockedWorld)).toBe(u);
  });

  it('allows it once the unlock is open', () => {
    expect(lockedUnlockNeeding(w1, [w1, w2], [unlock({ requiredTaskIds: ['w1'] })], openWorld)).toBeNull();
  });

  it('allows a task no unlock needs', () => {
    expect(lockedUnlockNeeding(task('other'), [w1, w2], [unlock({ requiredTaskIds: ['w1'] })], lockedWorld)).toBeNull();
  });
});
