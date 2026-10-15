import {
  defaultGroupLocked, groupEditLocked, liveGroupIds, reasonGroupLocked, scheduleEditLocked,
} from '../utils/blockEditLock';
import type { ShieldReasonEntry } from '../utils/appShield';
import type { BlockSchedule } from '../utils/blockSchedule';

const reason = (r: ShieldReasonEntry['reason'], groupId: string): ShieldReasonEntry => ({ reason: r, groupId });

const schedule = (over: Partial<BlockSchedule> = {}): BlockSchedule => ({
  id: 's1',
  name: 'Work',
  groupId: 'default',
  days: [1, 2, 3, 4, 5],
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  enabled: true,
  pausedUntil: null,
  ...over,
});

// 2026-08-12 is a Wednesday. Local times, per the repo's timezone rule.
const WED = (h: number) => new Date(2026, 7, 12, h);

describe('a group a live reason names', () => {
  const live = [reason('focus', 'social'), reason('key', 'games')];

  it('is locked, and every other group is not', () => {
    expect(groupEditLocked('social', live)).toBe(true);
    expect(groupEditLocked('games', live)).toBe(true);
    expect(groupEditLocked('default', live)).toBe(false);
  });

  it('is editable when nothing is blocking', () => {
    expect(groupEditLocked('social', [])).toBe(false);
    expect(liveGroupIds([]).size).toBe(0);
  });

  it('counts a group named by one of several gate entries', () => {
    expect(groupEditLocked('b', [reason('gate', 'a'), reason('gate', 'b')])).toBe(true);
  });
});

describe('pointing a reason at another group', () => {
  it('is locked while that reason is live, whatever group it names', () => {
    expect(reasonGroupLocked('focus', [reason('focus', 'social')])).toBe(true);
  });

  it('is open for a reason that is not live, even when another reason holds the group', () => {
    expect(reasonGroupLocked('penalty', [reason('focus', 'social')])).toBe(false);
  });
});

describe('changing the default group', () => {
  it('is locked when either the old or the new default is held', () => {
    const live = [reason('key', 'games')];
    expect(defaultGroupLocked('games', 'social', live)).toBe(true);
    expect(defaultGroupLocked('default', 'games', live)).toBe(true);
    expect(defaultGroupLocked('default', 'social', live)).toBe(false);
  });
});

describe('a schedule', () => {
  it('is locked while its window is open', () => {
    expect(scheduleEditLocked(schedule(), WED(12))).toBe(true);
  });

  it('is editable outside its window, when switched off, and once a release paused it', () => {
    expect(scheduleEditLocked(schedule(), WED(20))).toBe(false);
    expect(scheduleEditLocked(schedule({ enabled: false }), WED(12))).toBe(false);
    expect(scheduleEditLocked(schedule({ pausedUntil: WED(17).toISOString() }), WED(12))).toBe(false);
  });
});
