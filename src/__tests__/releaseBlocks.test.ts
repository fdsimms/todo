const mockDb: Record<string, string> = {};
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockDb[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockDb[key] = value; }),
}));

let mockReasons: { reason: string; groupIds: string[] }[] = [];
let mockGates: { id: string }[] = [];
jest.mock('../utils/appShieldReconcile', () => ({
  currentShieldReasons: () => mockReasons,
  outstandingGatesNow: () => mockGates,
}));

const mockSetPenalty = jest.fn();
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ setPenaltyShieldUntil: mockSetPenalty }) },
}));
let mockSession: { id: string } | null = null;
jest.mock('../store/useFocusStore', () => ({
  useFocusStore: { getState: () => ({ session: mockSession }) },
}));

import { applyKeyScan, releaseAllBlocks } from '../utils/releaseBlocks';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useManualBlockStore } from '../store/useManualBlockStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';

const WED_10 = new Date(2026, 7, 12, 10);
const UID = '04A1B2C3D4E5F6';

beforeEach(() => {
  for (const key of Object.keys(mockDb)) delete mockDb[key];
  mockReasons = [];
  mockGates = [];
  mockSession = null;
  mockSetPenalty.mockClear();
  useAppGroupStore.getState().reload();
  useNfcKeyStore.getState().reload();
  useShieldReleaseStore.getState().reload();
  useManualBlockStore.getState().reload();
  jest.useFakeTimers().setSystemTime(WED_10);
});

afterEach(() => jest.useRealTimers());

const live = (...kinds: string[]) => { mockReasons = kinds.map(reason => ({ reason, groupIds: ['default'] })); };

describe('releaseAllBlocks', () => {
  it('does nothing and records nothing when nothing is blocking', () => {
    expect(releaseAllBlocks('emergency', 'a reason long enough')).toEqual([]);
    expect(useShieldReleaseStore.getState().log).toEqual([]);
  });

  it('ends a failed-task block by clearing it', () => {
    live('penalty');
    expect(releaseAllBlocks('emergency', 'Need the map to get home')).toEqual(['penalty']);
    expect(mockSetPenalty).toHaveBeenCalledWith(null, null);
  });

  it('ends the key lock', () => {
    useNfcKeyStore.getState().enrollTag(UID, 'Desk');
    useNfcKeyStore.getState().lock();
    live('key');
    releaseAllBlocks('tag');
    expect(useNfcKeyStore.getState().locked).toBe(false);
  });

  it('ends a block the person started by hand', () => {
    useManualBlockStore.getState().start(60, ['default']);
    live('manual');
    expect(releaseAllBlocks('emergency', 'Need the map to get home')).toEqual(['manual']);
    expect(useManualBlockStore.getState().block).toBeNull();
    expect(useShieldReleaseStore.getState().log[0].ended).toEqual(['manual']);
  });

  it('pauses every open schedule, whatever its own settings', () => {
    useAppGroupStore.getState().addSchedule({
      name: 'Work', groupIds: ['default'], days: [1, 2, 3, 4, 5], startMinutes: 540, endMinutes: 1020, enabled: true,
    });
    live('schedule');
    releaseAllBlocks('tag');
    expect(useAppGroupStore.getState().schedules[0].pausedUntil).not.toBeNull();
  });

  it('remembers a released gate and focus session, and drops them once they no longer apply', () => {
    mockGates = [{ id: 'walk' }];
    mockSession = { id: 's1' };
    live('gate', 'focus');
    releaseAllBlocks('emergency', 'Need the map to get home');
    expect(useShieldReleaseStore.getState().releases).toEqual({ focusSessionId: 's1', gateTaskIds: ['walk'] });

    // The task is done and the session is over: the next release forgets both.
    mockGates = [];
    mockSession = null;
    live('penalty');
    releaseAllBlocks('emergency', 'Need the map to get home');
    expect(useShieldReleaseStore.getState().releases).toEqual({ focusSessionId: null, gateTaskIds: [] });
  });

  it('records when, how, why and what ended, and keeps it off the wire as its own settings', () => {
    live('penalty', 'schedule');
    releaseAllBlocks('emergency', '  Need   the map to get home ');
    const [entry] = useShieldReleaseStore.getState().log;
    expect(entry).toMatchObject({
      source: 'emergency', reason: 'Need the map to get home', ended: ['penalty', 'schedule'], at: WED_10.toISOString(),
    });
    expect(JSON.parse(mockDb.shieldReleaseLog)).toHaveLength(1);
  });

  it('does not record a tag scan that only ended the key lock', () => {
    useNfcKeyStore.getState().enrollTag(UID, 'Desk');
    useNfcKeyStore.getState().lock();
    live('key');
    expect(releaseAllBlocks('tag')).toEqual(['key']);
    expect(useNfcKeyStore.getState().locked).toBe(false);
    expect(useShieldReleaseStore.getState().log).toEqual([]);
  });

  it('records a tag scan that also cut other blocks short, without the key lock', () => {
    live('key', 'penalty');
    expect(releaseAllBlocks('tag')).toEqual(['key', 'penalty']);
    expect(useShieldReleaseStore.getState().log[0].ended).toEqual(['penalty']);
  });

  it('records the key lock when the emergency button ends it', () => {
    live('key');
    releaseAllBlocks('emergency', 'Need the map to get home');
    expect(useShieldReleaseStore.getState().log[0].ended).toEqual(['key']);
  });

  it('records a tag release with no reason', () => {
    live('penalty');
    releaseAllBlocks('tag');
    expect(useShieldReleaseStore.getState().log[0]).toMatchObject({ source: 'tag', reason: null });
  });
});

describe('applyKeyScan', () => {
  const enroll = () => {
    const enrolled = useNfcKeyStore.getState().enrollTag(UID, 'Desk');
    if (!enrolled.ok) throw new Error('enroll failed');
  };

  it('answers a tag nobody enrolled with only "unknown", and ends nothing', () => {
    enroll();
    live('penalty');
    expect(applyKeyScan('tag', '04FFFFFFFFFFFF').outcome).toBe('unknown');
    expect(applyKeyScan('tag', null).outcome).toBe('unknown');
    expect(mockSetPenalty).not.toHaveBeenCalled();
  });

  it('ends a failed-task block and a focus session that its own lock did not raise', () => {
    enroll();
    mockSession = { id: 's1' };
    live('focus', 'penalty');
    const scan = applyKeyScan('tag', UID);
    expect(scan).toMatchObject({ outcome: 'released', ended: ['focus', 'penalty'] });
    expect(mockSetPenalty).toHaveBeenCalledWith(null, null);
    expect(useNfcKeyStore.getState().locked).toBe(false);
  });

  it('unlocks a lock the way it always did, and says it released the key lock', () => {
    enroll();
    useNfcKeyStore.getState().lock();
    live('key');
    expect(applyKeyScan('tag', UID)).toMatchObject({ outcome: 'released', ended: ['key'] });
    expect(useNfcKeyStore.getState().locked).toBe(false);
  });

  it('locks when nothing is blocking', () => {
    enroll();
    expect(applyKeyScan('tag', UID).outcome).toBe('locked');
    expect(useNfcKeyStore.getState().locked).toBe(true);
    expect(useShieldReleaseStore.getState().log).toEqual([]);
  });
});
