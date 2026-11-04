import type { RewardUnlock, Task } from '../types';
import { lockedUnlockBlocks } from '../utils/unlockShield';
import { unlockBlockSubtitle } from '../utils/unlockBlockText';
import { isUnlockReleased, withReleased, NO_RELEASES } from '../utils/shieldRelease';
import { unlockLooseningsOf } from '../utils/rewardUnlocks';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const TODAY = new Date(2026, 10, 4); // a Wednesday
const KEY = '2026-11-04';

const task = (id: string): Task => ({
  id, title: id, completed: false, completedAt: null, missedAt: null, parentId: null, previousOccurrenceId: null,
  seriesId: null, generatedKind: null, polarity: 'positive', estimatedMinutes: 30, difficulty: null, bountyPushes: null,
  createdAt: '2026-11-01T00:00:00.000Z',
} as unknown as Task);

const unlock = (extra: Partial<RewardUnlock> = {}): RewardUnlock => ({
  id: 'u', title: 'Switch', glyph: null, createdAt: '', sharePct: 60, requiredTaskIds: ['w1'], playMinutes: 120,
  freeOnWeekends: false, freeOnVacation: false, guardsTaskId: null, blockGroupId: 'switchapp', pin: null,
  playDay: null, playUsedMs: 0, playExtraMs: 0, playStartedAt: null, ...extra,
});

const w1 = task('w1');
const locked = { entries: [], tasks: [w1], onToday: [w1], todayStart: TODAY, todayKey: KEY, vacation: false };
const open = { ...locked, onToday: [] };

describe('lockedUnlockBlocks', () => {
  it('blocks the unlock\'s group while it is locked', () => {
    expect(lockedUnlockBlocks([unlock()], locked, true)).toEqual([{ id: 'u', title: 'Switch', groupId: 'switchapp' }]);
  });

  it('lifts the block once the unlock is open', () => {
    expect(lockedUnlockBlocks([unlock()], open, true)).toEqual([]);
  });

  it('lifts it on a free weekend or vacation day', () => {
    expect(lockedUnlockBlocks([unlock({ freeOnVacation: true })], { ...locked, vacation: true }, true)).toEqual([]);
  });

  it('ignores an unlock that names no group', () => {
    expect(lockedUnlockBlocks([unlock({ blockGroupId: null })], locked, true)).toEqual([]);
  });

  it('blocks nothing while rewards are off', () => {
    expect(lockedUnlockBlocks([unlock()], locked, false)).toEqual([]);
  });

  it('skips an unlock whose block was released today', () => {
    expect(lockedUnlockBlocks([unlock()], locked, true, id => id === 'u')).toEqual([]);
  });
});

describe('the sentence', () => {
  it('names one unlock, or the first and a count', () => {
    expect(unlockBlockSubtitle(['Switch'])).toBe('Switch is locked until enough of today’s work is done.');
    expect(unlockBlockSubtitle(['Switch', 'TV'])).toBe('Switch and 1 more are locked until enough of today’s work is done.');
    expect(unlockBlockSubtitle([])).toBe('Locked until enough of today’s work is done.');
  });
});

describe('editing a locked unlock', () => {
  it('cannot drop or swap the blocked group', () => {
    const before = unlock();
    expect(unlockLooseningsOf(before, { ...before, blockGroupId: null })).toContain('stop blocking its apps');
    expect(unlockLooseningsOf(before, { ...before, blockGroupId: 'other' })).toContain('stop blocking its apps');
  });

  it('can add a group to one that had none', () => {
    const before = unlock({ blockGroupId: null });
    expect(unlockLooseningsOf(before, { ...before, blockGroupId: 'switchapp' })).toEqual([]);
  });
});

describe('a release', () => {
  it('holds for the day it was made on and lapses the next', () => {
    const next = withReleased(NO_RELEASES, { unlockIds: ['u'] }, { focusSessionId: null, outstandingGateIds: new Set(), dayKey: KEY });
    expect(isUnlockReleased('u', KEY, next)).toBe(true);
    expect(isUnlockReleased('u', '2026-11-05', next)).toBe(false);
    const tomorrow = withReleased(next, {}, { focusSessionId: null, outstandingGateIds: new Set(), dayKey: '2026-11-05' });
    expect(tomorrow.unlockDays).toEqual({});
  });
});
