/**
 * The one place that goes and gets the shield rule its answers.
 *
 * What matters here is not the arithmetic — `appShield.ts` and `appGate.ts`
 * own that and have their own tests — but that the two gate questions are asked
 * of the right predicate. A gate in the way is `isTaskVisible`'s answer, a gate
 * still to come is `getVisibleAt`'s, and swapping them is how the feature would
 * block somebody for a task the app itself is withholding.
 */
const mockSync = jest.fn();
const mockReasons: { reason: string; groupIds: string[]; until?: string | null }[] = [];
jest.mock('../utils/appShield', () => ({
  syncAppShield: (...args: unknown[]) => mockSync(...args),
  shieldReasons: () => mockReasons,
  shieldGroupIds: () => mockReasons.flatMap(r => r.groupIds),
}));
const mockObserve = jest.fn();
jest.mock('../store/useBlockTimerStore', () => ({
  useBlockTimerStore: { getState: () => ({ observe: (...args: unknown[]) => mockObserve(...args) }) },
}));

const mockVisible = jest.fn();
const mockVisibleAt = jest.fn();
const mockHiddenForVacation = jest.fn();
jest.mock('../utils/visibilityUtils', () => ({
  beginVisibleAtPass: () => ({}),
  isTaskVisible: (...args: unknown[]) => mockVisible(...args),
  getVisibleAt: (...args: unknown[]) => mockVisibleAt(...args),
  isHiddenForVacation: (...args: unknown[]) => mockHiddenForVacation(...args),
}));

const mockTasks: unknown[] = [];
const mockSettings = {
  focusShieldEnabled: false,
  penaltyShieldEnabled: true,
  penaltyShieldUntil: null as string | null,
  penaltyShieldReason: null as string | null,
  gateShieldEnabled: true,
};
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: mockTasks }) },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));
const mockFocus: { session: { id: string } | null } = { session: null };
jest.mock('../store/useFocusStore', () => ({
  useFocusStore: { getState: () => mockFocus },
}));
const mockReleases = { focusSessionId: null as string | null, gateTaskIds: [] as string[] };
const mockManual: { block: { untilIso: string; groupIds: string[] } | null } = { block: null };
jest.mock('../store/useManualBlockStore', () => ({
  useManualBlockStore: { getState: () => mockManual },
}));
jest.mock('../store/useShieldReleaseStore', () => ({
  useShieldReleaseStore: { getState: () => ({ releases: mockReleases }) },
}));
const mockGroupState = {
  groups: [] as unknown[],
  assignments: { focus: 'default', gate: 'default', penalty: 'default', key: 'default' },
  schedules: [] as unknown[],
};
jest.mock('../store/useAppGroupStore', () => ({
  useAppGroupStore: { getState: () => mockGroupState },
  resolvedAssignments: () => mockGroupState.assignments,
  resolveGroupNow: (id: string) => id,
  expandGroupNow: (id: string) => [id],
}));
const mockKeyState = { locked: false, keys: [] as unknown[] };
jest.mock('../store/useNfcKeyStore', () => ({
  useNfcKeyStore: { getState: () => mockKeyState },
}));

import type { Task } from '../types';
import { gateTitlesNow, reconcileAppShield } from '../utils/appShieldReconcile';

const task = (over: Partial<Task>): Task => ({
  id: 'walk',
  title: 'Morning walk',
  completed: false,
  archived: false,
  gatesApps: true,
  polarity: 'positive',
  ...over,
} as Task);

const NOW = Date.now();

beforeEach(() => {
  mockSync.mockClear();
  mockObserve.mockClear();
  mockReasons.length = 0;
  mockKeyState.locked = false;
  mockKeyState.keys = [];
  mockTasks.length = 0;
  mockFocus.session = null;
  mockManual.block = null;
  mockReleases.focusSessionId = null;
  mockReleases.gateTaskIds = [];
  mockVisible.mockReturnValue(true);
  mockVisibleAt.mockImplementation(() => new Date(NOW));
  mockHiddenForVacation.mockReturnValue(false);
});

describe('reconcileAppShield', () => {
  it('tells the block timer whether the shield is up, from the same reasons', () => {
    reconcileAppShield();
    expect(mockObserve).toHaveBeenLastCalledWith(false, [], expect.any(Date));
    mockReasons.push({ reason: 'focus', groupIds: ['default'] });
    reconcileAppShield();
    expect(mockObserve).toHaveBeenLastCalledWith(true, mockReasons, expect.any(Date));
  });

  it('names the gates in the way, by the visibility rule', () => {
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      gateEnabled: true,
      gateTitles: ['Morning walk'],
    }));
  });

  it('leaves out a gate the app is itself withholding', () => {
    // A deferred task, a time segment that hasn't opened, vacation mode,
    // waiting on somebody. Being blocked by one of those is the one outcome
    // this feature must not have.
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    mockVisible.mockReturnValue(false);
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ gateTitles: [] }));
  });

  // getVisibleAt names the next clock moment and knows nothing about vacation,
  // so without this a gate task vacation mode is hiding got a window armed for
  // tomorrow morning: blocked by something the app itself is withholding.
  it('arms no window for a gate task vacation mode is hiding', () => {
    const sixAm = new Date(NOW + 8 * 60 * 60 * 1000);
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    mockVisible.mockReturnValue(false);
    mockVisibleAt.mockImplementation(() => sixAm);
    mockHiddenForVacation.mockReturnValue(true);
    try {
      expect(reconcileAppShield()).toBeNull();
      expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ gateTitles: [] }));
    } finally {
      mockHiddenForVacation.mockReturnValue(false);
    }
  });

  it('hands over the next gate still to come, and returns when it lands', () => {
    const sixAm = new Date(NOW + 8 * 60 * 60 * 1000);
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    mockVisible.mockReturnValue(false);
    mockVisibleAt.mockImplementation(() => sixAm);

    const liveAt = reconcileAppShield();
    expect(liveAt).toEqual(sixAm);
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      pendingGate: { liveAt: sixAm, titles: ['Morning walk'], groupIds: ['default'] },
    }));
  });

  it('leaves out a gate that was released, and arms no window for it', () => {
    const sixAm = new Date(NOW + 8 * 60 * 60 * 1000);
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }), task({ id: 'run', title: 'Run' }));
    mockReleases.gateTaskIds = ['walk'];
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ gateTitles: ['Run'] }));

    mockSync.mockClear();
    mockVisible.mockReturnValue(false);
    mockVisibleAt.mockImplementation(() => sixAm);
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      pendingGate: { liveAt: sixAm, titles: ['Run'], groupIds: ['default'] },
    }));
  });

  it('hands over no session once its shield was released, and the next session blocks again', () => {
    mockFocus.session = { id: 's1' };
    mockReleases.focusSessionId = 's1';
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ session: null }));

    mockSync.mockClear();
    mockFocus.session = { id: 's2' };
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ session: { id: 's2' } }));
  });

  it('hands over a running timed block with its group, and returns its end to wait at', () => {
    const end = new Date(NOW + 60 * 60 * 1000);
    mockManual.block = { untilIso: end.toISOString(), groupIds: ['games'] };
    expect(reconcileAppShield()).toEqual(end);
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      manual: { untilIso: end.toISOString(), groupIds: ['games'] },
    }));
  });

  it('waits at whichever of a gate and a timed block comes first', () => {
    const sixAm = new Date(NOW + 8 * 60 * 60 * 1000);
    const end = new Date(NOW + 60 * 60 * 1000);
    mockManual.block = { untilIso: end.toISOString(), groupIds: ['default'] };
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    mockVisible.mockReturnValue(false);
    mockVisibleAt.mockImplementation(() => sixAm);
    expect(reconcileAppShield()).toEqual(end);
  });

  it('returns nothing to wait at when no gate is coming', () => {
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    expect(reconcileAppShield()).toBeNull();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ pendingGate: null }));
  });
});

describe('gateTitlesNow', () => {
  it('is the same read the sync hook compares against between task writes', () => {
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    expect(gateTitlesNow()).toEqual(['Morning walk']);
  });
});

describe('the key tag lock', () => {
  const tag = { id: 'k', name: 'Desk', kind: 'tag', secret: '04A1B2C3', addedAt: '2026-10-14T09:00:00.000Z' };

  it('is on only when the flag is set and a key is enrolled to end it', () => {
    mockKeyState.locked = true;
    mockKeyState.keys = [tag];
    reconcileAppShield();
    expect(mockSync).toHaveBeenLastCalledWith(expect.objectContaining({ keyLocked: true }));
  });

  it('is off when the last key is gone, so nothing is stranded', () => {
    mockKeyState.locked = true;
    mockKeyState.keys = [];
    reconcileAppShield();
    expect(mockSync).toHaveBeenLastCalledWith(expect.objectContaining({ keyLocked: false }));
  });

  it('is off when the flag is', () => {
    mockKeyState.keys = [tag];
    reconcileAppShield();
    expect(mockSync).toHaveBeenLastCalledWith(expect.objectContaining({ keyLocked: false }));
  });
});

describe('schedules', () => {
  it('hands the schedules and each reason\'s group to the rule', () => {
    const schedule = {
      id: 's', name: 'Work', groupIds: ['default'], days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 0,
      endMinutes: 600, enabled: true, pausedUntil: null,
    };
    mockGroupState.schedules = [schedule];
    try {
      reconcileAppShield();
      expect(mockSync).toHaveBeenLastCalledWith(expect.objectContaining({
        schedules: [schedule],
        groups: mockGroupState.assignments,
      }));
    } finally {
      mockGroupState.schedules = [];
    }
  });

  it('returns a schedule edge as the moment to wait for when nothing is sooner', () => {
    mockGroupState.schedules = [{
      id: 's', name: 'Work', groupIds: ['default'], days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 0,
      endMinutes: 600, enabled: true, pausedUntil: null,
    }];
    try {
      const next = reconcileAppShield();
      expect(next).toBeInstanceOf(Date);
      expect(next!.getTime()).toBeGreaterThan(Date.now());
    } finally {
      mockGroupState.schedules = [];
    }
  });
});

describe('gate groups', () => {
  it('gives each gate the group it names, else the gate setting\'s', () => {
    mockTasks.length = 0;
    mockVisible.mockReturnValue(true);
    mockTasks.push(
      task({ id: 'a', title: 'Walk', gateGroupId: 'social' }),
      task({ id: 'b', title: 'Read' }),
    );
    mockGroupState.assignments = { ...mockGroupState.assignments, gate: 'games' };
    try {
      reconcileAppShield();
      expect(mockSync).toHaveBeenLastCalledWith(expect.objectContaining({
        gateTitles: ['Walk', 'Read'],
        gateGroupIds: ['social', 'games'],
      }));
    } finally {
      mockGroupState.assignments = { focus: 'default', gate: 'default', penalty: 'default', key: 'default' };
      mockTasks.length = 0;
    }
  });
});
