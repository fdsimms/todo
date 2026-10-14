const mockSettings: Record<string, string> = {};
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockSettings[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockSettings[key] = value; }),
}));

import { useAppGroupStore, resolvedAssignments, resolveGroupNow } from '../store/useAppGroupStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';

const draft = {
  name: 'Work', groupId: 'default', days: [1, 2, 3, 4, 5], startMinutes: 540, endMinutes: 1020,
  enabled: true, tagCanPause: true,
};
const WED_10 = new Date(2026, 7, 12, 10);

beforeEach(() => {
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  useAppGroupStore.getState().reload();
  useNfcKeyStore.getState().reload();
});

describe('groups', () => {
  it('adds, renames and removes, persisting each', () => {
    const added = useAppGroupStore.getState().addGroup('Social');
    expect(added.ok).toBe(true);
    const id = useAppGroupStore.getState().groups[0].id;
    expect(JSON.parse(mockSettings.appGroups)).toEqual([{ id, name: 'Social' }]);
    expect(useAppGroupStore.getState().renameGroup(id, 'Feeds').ok).toBe(true);
    useAppGroupStore.getState().removeGroup(id);
    expect(useAppGroupStore.getState().groups).toEqual([]);
  });

  it('points a reason back at Default when its group is deleted, and a schedule resolves there too', () => {
    useAppGroupStore.getState().addGroup('Games');
    const id = useAppGroupStore.getState().groups[0].id;
    useAppGroupStore.getState().assignGroup('focus', id);
    expect(resolvedAssignments().focus).toBe(id);
    useAppGroupStore.getState().removeGroup(id);
    expect(useAppGroupStore.getState().assignments.focus).toBe('default');
    expect(resolveGroupNow(id)).toBe('default');
  });

  it('refuses to assign a group that does not exist', () => {
    useAppGroupStore.getState().assignGroup('gate', 'nope');
    expect(useAppGroupStore.getState().assignments.gate).toBe('default');
  });
});

describe('schedules', () => {
  it('adds a valid schedule and refuses an invalid one', () => {
    expect(useAppGroupStore.getState().addSchedule(draft).ok).toBe(true);
    const bad = useAppGroupStore.getState().addSchedule({ ...draft, days: [] });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
    expect(useAppGroupStore.getState().schedules).toHaveLength(1);
  });

  it('refuses a ninth', () => {
    for (let i = 0; i < 8; i += 1) useAppGroupStore.getState().addSchedule(draft);
    expect(useAppGroupStore.getState().addSchedule(draft)).toMatchObject({ ok: false, reason: 'full' });
  });

  it('clears a pause when the schedule is edited or toggled', () => {
    const result = useAppGroupStore.getState().addSchedule(draft);
    if (!result.ok) throw new Error('add failed');
    useAppGroupStore.getState().pauseOpenSchedules(WED_10);
    expect(useAppGroupStore.getState().schedules[0].pausedUntil).not.toBeNull();
    useAppGroupStore.getState().setScheduleEnabled(result.schedule.id, true);
    expect(useAppGroupStore.getState().schedules[0].pausedUntil).toBeNull();
  });
});

describe('a key tag scan', () => {
  const enroll = () => {
    const enrolled = useNfcKeyStore.getState().enrollTag('04A1B2C3D4E5F6', 'Desk');
    if (!enrolled.ok) throw new Error('enroll failed');
  };

  it('pauses an open schedule instead of locking, without touching the lock', () => {
    enroll();
    jest.useFakeTimers().setSystemTime(WED_10);
    try {
      useAppGroupStore.getState().addSchedule(draft);
      const scan = useNfcKeyStore.getState().applyScan('tag', '04A1B2C3D4E5F6');
      expect(scan).toMatchObject({ outcome: 'paused', count: 1 });
      expect(useNfcKeyStore.getState().locked).toBe(false);
      // Nothing left to pause, so the next scan locks as it always did.
      expect(useNfcKeyStore.getState().applyScan('tag', '04A1B2C3D4E5F6').outcome).toBe('locked');
    } finally {
      jest.useRealTimers();
    }
  });

  it('unlocks a lock first even while a schedule is open', () => {
    enroll();
    jest.useFakeTimers().setSystemTime(WED_10);
    try {
      useAppGroupStore.getState().addSchedule(draft);
      useNfcKeyStore.getState().lock();
      const scan = useNfcKeyStore.getState().applyScan('tag', '04A1B2C3D4E5F6');
      expect(scan.outcome).toBe('unlocked');
      expect(useAppGroupStore.getState().schedules[0].pausedUntil).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('locks as before when no schedule is open', () => {
    enroll();
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 15, 10));
    try {
      useAppGroupStore.getState().addSchedule(draft);
      expect(useNfcKeyStore.getState().applyScan('tag', '04A1B2C3D4E5F6').outcome).toBe('locked');
    } finally {
      jest.useRealTimers();
    }
  });
});
