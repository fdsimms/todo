/**
 * The one reconciler that writes the system app shield.
 *
 * Two features want the same shield for unrelated reasons, and the native side
 * has only one to give. Most of what this pins down is that neither reason can
 * switch the other's block off — the bug that made a single arbiter necessary
 * rather than two independent syncs, and the one that would be invisible in
 * testing either feature on its own.
 */
const mockBridge = {
  applyShield: jest.fn(() => true),
  clearShield: jest.fn(() => true),
  setShieldState: jest.fn(() => true),
  setBlockSchedules: jest.fn(() => true),
  schedulePenaltyExpiry: jest.fn(() => true),
  cancelPenaltyExpiry: jest.fn(() => true),
  scheduleManualExpiry: jest.fn(() => true),
  cancelManualExpiry: jest.fn(() => true),
  scheduleGateWindow: jest.fn(() => true),
  cancelGateWindow: jest.fn(() => true),
};
let mockBridgeOpen = true;
jest.mock('../utils/screenTimeBridge', () => ({
  screenTimeBridge: () => (mockBridgeOpen ? mockBridge : null),
  isScreenTimeSupported: () => mockBridgeOpen,
}));

import type { FocusSession, FocusStep } from '../types';
import { appShieldWanted, shieldReasons, syncAppShield, type AppShieldState } from '../utils/appShield';

const NOW = new Date('2026-08-22T09:00:00.000Z');
const LATER = new Date('2026-08-22T10:00:00.000Z').toISOString();
const EARLIER = new Date('2026-08-22T08:00:00.000Z').toISOString();

const work = (taskId: string, minutes: number): FocusStep =>
  ({ kind: 'work', taskId, minutes, part: 1, partCount: 1, long: false });

const session = (over: Partial<FocusSession> = {}): FocusSession => ({
  id: 'session',
  startedAt: '2026-08-22T09:00:00.000Z',
  steps: [work('a', 25), work('b', 25)],
  stepIndex: 0,
  stepStartedAt: '2026-08-22T09:00:00.000Z',
  stepElapsedSeconds: 0,
  completedTaskIds: [],
  stepLog: [],
  hideTimers: false,
  ...over,
});

const state = (over: Partial<AppShieldState> = {}): AppShieldState => ({
  session: null,
  focusEnabled: false,
  penaltyUntil: null,
  penaltyEnabled: false,
  penaltyReason: null,
  gateEnabled: false,
  keyLocked: false,
  gateTitles: [],
  pendingGate: null,
  groups: { focus: 'default', gate: 'default', penalty: 'default', key: 'default' },
  schedules: [],
  resolveGroup: id => id,
  now: NOW,
  ...over,
});

beforeEach(() => {
  mockBridgeOpen = true;
  for (const fn of Object.values(mockBridge)) fn.mockClear();
});

describe('appShieldWanted', () => {
  it('is true for a running focus session on its own', () => {
    expect(appShieldWanted(state({ session: session(), focusEnabled: true }))).toBe(true);
  });

  it('is true for a penalty block that has not run out on its own', () => {
    expect(appShieldWanted(state({ penaltyUntil: LATER, penaltyEnabled: true }))).toBe(true);
  });

  it('is false when neither reason wants it', () => {
    expect(appShieldWanted(state())).toBe(false);
  });

  // The two that the whole module exists for. Before there was one arbiter,
  // each feature reconciled alone against the same shield, so whichever ran
  // second won — and the losing case is somebody handed back apps they were
  // supposed to be locked out of, with nothing appearing to have gone wrong.
  it('stays on when a focus session ends mid-penalty', () => {
    expect(appShieldWanted(state({
      session: null,
      focusEnabled: true,
      penaltyUntil: LATER,
      penaltyEnabled: true,
    }))).toBe(true);
  });

  it('stays on when a penalty runs out mid-session', () => {
    expect(appShieldWanted(state({
      session: session(),
      focusEnabled: true,
      penaltyUntil: EARLIER,
      penaltyEnabled: true,
    }))).toBe(true);
  });

  it('is false once both reasons are spent', () => {
    expect(appShieldWanted(state({
      session: null,
      focusEnabled: true,
      penaltyUntil: EARLIER,
      penaltyEnabled: true,
    }))).toBe(false);
  });

  it('ignores a penalty whose feature switch is off, however live the block', () => {
    expect(appShieldWanted(state({ penaltyUntil: LATER, penaltyEnabled: false }))).toBe(false);
  });

  it('ignores a session whose feature switch is off, however live the session', () => {
    expect(appShieldWanted(state({ session: session(), focusEnabled: false }))).toBe(false);
  });
});

describe('syncAppShield', () => {
  it('applies when something wants it', () => {
    syncAppShield(state({ penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('clears rather than doing nothing when nothing does — this is the crash backstop', () => {
    // The case that matters most: a shield written by a run that has since
    // died is still in force, and this call at launch is what lifts it.
    syncAppShield(state());
    expect(mockBridge.clearShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.applyShield).not.toHaveBeenCalled();
  });

  it('touches nothing when the gate is closed', () => {
    // Demo mode, Android, or a build with no native half. Notably it does not
    // try to clear either: with no bridge there is nothing written to clear.
    mockBridgeOpen = false;
    syncAppShield(state({ session: session(), focusEnabled: true }));
    syncAppShield(state());

    expect(mockBridge.applyShield).not.toHaveBeenCalled();
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('is safe to over-call, which is what lets every foreground re-assert it', () => {
    const running = state({ session: session(), focusEnabled: true });
    syncAppShield(running);
    syncAppShield(running);
    syncAppShield(running);
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(3);
  });
});

/**
 * The half that has to work with the app closed.
 *
 * A penalty block ends at a stated time, and none of this code is running then,
 * so the monitor extension lifts it — which means the extension has to be told
 * in advance what this module would have decided, since a woken extension has
 * no way to ask.
 */
describe('what syncAppShield leaves behind for the extension', () => {
  it('arms a window for the end of a block being served', () => {
    syncAppShield(state({ penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.schedulePenaltyExpiry).toHaveBeenCalledWith(LATER);
    expect(mockBridge.cancelPenaltyExpiry).not.toHaveBeenCalled();
  });

  it('disarms the window once no block is being served', () => {
    // Or its end would lift a shield some later focus session had raised.
    syncAppShield(state({ penaltyUntil: EARLIER, penaltyEnabled: true }));
    expect(mockBridge.cancelPenaltyExpiry).toHaveBeenCalledTimes(1);
    expect(mockBridge.schedulePenaltyExpiry).not.toHaveBeenCalled();
  });

  it('disarms the window when the feature is switched off mid-block', () => {
    syncAppShield(state({ penaltyUntil: LATER, penaltyEnabled: false }));
    expect(mockBridge.cancelPenaltyExpiry).toHaveBeenCalledTimes(1);
  });

  it('tells the extension a focus session still wants the apps blocked', () => {
    // The case the whole handshake exists for: a penalty running out while a
    // session is going must not hand the apps back.
    syncAppShield(state({
      session: session(),
      focusEnabled: true,
      penaltyUntil: LATER,
      penaltyEnabled: true,
    }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(
      expect.objectContaining({ otherReasonWantsShield: true, reason: 'focus' }),
    );
  });

  it('tells the extension nothing else wants them when a penalty is the only reason', () => {
    syncAppShield(state({ penaltyUntil: LATER, penaltyEnabled: true, penaltyReason: 'Morning walk' }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      otherReasonWantsShield: false,
      reason: 'penalty',
      untilIso: LATER,
      pendingGateDetail: null,
      detail: 'Morning walk',
    }));
  });

  it('keeps that answer current on every reconcile, not just when a block starts', () => {
    // A session can start, or the feature be switched off, while a window is
    // already armed — and the extension gets no chance to ask when it wakes.
    syncAppShield(state({ penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.setShieldState).toHaveBeenLastCalledWith(
      expect.objectContaining({ otherReasonWantsShield: false }),
    );
    syncAppShield(state({
      session: session(), focusEnabled: true, penaltyUntil: LATER, penaltyEnabled: true,
    }));
    expect(mockBridge.setShieldState).toHaveBeenLastCalledWith(
      expect.objectContaining({ otherReasonWantsShield: true }),
    );
  });

  it('names nothing once no block is being served', () => {
    // A stale reason is what would put a finished block's task on the next
    // shield screen.
    syncAppShield(state({ penaltyUntil: EARLIER, penaltyEnabled: true, penaltyReason: 'Morning walk' }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      otherReasonWantsShield: false,
      reason: 'none',
      untilIso: null,
      detail: null,
      pendingGateDetail: null,
    }));
  });

  it('touches none of it when the gate is closed', () => {
    mockBridgeOpen = false;
    syncAppShield(state({ penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.setShieldState).not.toHaveBeenCalled();
    expect(mockBridge.schedulePenaltyExpiry).not.toHaveBeenCalled();
    expect(mockBridge.cancelPenaltyExpiry).not.toHaveBeenCalled();
  });
});

/**
 * The third reason: apps blocked until a task is done.
 *
 * Most of this is the same shape as the other two, and the case worth the most
 * is the one where it meets the penalty — because that one is the race this
 * module exists for, reappearing in the process that can't see any of it.
 */
describe('a gate', () => {
  const gated = { gateEnabled: true, gateTitles: ['Morning walk'] };

  it('wants the apps blocked while something is outstanding', () => {
    expect(appShieldWanted(state(gated))).toBe(true);
  });

  it('stops wanting them blocked once nothing is — this is how a gate ends', () => {
    expect(appShieldWanted(state({ gateEnabled: true, gateTitles: [] }))).toBe(false);
  });

  it('is ignored with its own feature off, however much is outstanding', () => {
    expect(appShieldWanted(state({ gateEnabled: false, gateTitles: ['Morning walk'] }))).toBe(false);
  });

  it('counts as an other reason, so a penalty running out cannot lift it', () => {
    // The one that matters. The monitor extension reads this single flag before
    // clearing a shield at the end of a penalty window, and it cannot see a
    // gate any other way — so leaving the gate out here would hand back apps
    // that were still being held, with nothing appearing to go wrong.
    syncAppShield(state({ ...gated, penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(
      expect.objectContaining({ otherReasonWantsShield: true }),
    );
  });

  it('leads the screen over a penalty, being the one you can act on', () => {
    syncAppShield(state({ ...gated, penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'gate',
        detail: "Morning walk isn’t done yet. Finish it in dundundun to unblock.",
        // The penalty's end is withheld while a gate leads: a block that
        // outlasts the time shown is worse than one that shows no time.
        untilIso: null,
      }),
    );
  });

  it('yields the screen to a running focus session', () => {
    syncAppShield(state({ ...gated, session: session(), focusEnabled: true }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'focus' }),
    );
  });

  it('keeps the shield up when a focus session ends with a gate still open', () => {
    expect(appShieldWanted(state({ ...gated, session: null, focusEnabled: true }))).toBe(true);
  });

  it('arms no expiry window — a gate has no end to schedule', () => {
    syncAppShield(state(gated));
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.schedulePenaltyExpiry).not.toHaveBeenCalled();
    expect(mockBridge.cancelPenaltyExpiry).toHaveBeenCalledTimes(1);
  });
});

describe('the gate window it arms for the app being closed', () => {
  const SOON = new Date('2026-08-22T15:00:00.000Z');

  it('arms a window at the moment the next gate goes live', () => {
    syncAppShield(state({
      gateEnabled: true,
      pendingGate: { liveAt: SOON, titles: ['Morning walk'] },
    }));
    expect(mockBridge.scheduleGateWindow).toHaveBeenCalledWith(
      SOON.toISOString(), '2026-08-22T16:00:00.000Z',
    );
    // The extension's whole permission to raise a shield, written with the
    // window and never without it.
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      pendingGateDetail: "Morning walk isn’t done yet. Finish it in dundundun to unblock.",
    }));
  });

  it('arms nothing with the feature switched off', () => {
    syncAppShield(state({
      gateEnabled: false,
      pendingGate: { liveAt: SOON, titles: ['Morning walk'] },
    }));
    expect(mockBridge.scheduleGateWindow).not.toHaveBeenCalled();
    expect(mockBridge.cancelGateWindow).toHaveBeenCalled();
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      pendingGateDetail: null,
    }));
  });

  it('disarms whatever was armed once nothing is pending', () => {
    // A gate since completed, deferred or ticked off leaves a window behind
    // that would otherwise raise a shield for it at the old time.
    syncAppShield(state({ gateEnabled: true, pendingGate: null }));
    expect(mockBridge.cancelGateWindow).toHaveBeenCalled();
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      pendingGateDetail: null,
    }));
  });

  it('arms nothing for a gate further out than the horizon', () => {
    const weeksOut = new Date('2026-09-22T06:00:00.000Z');
    syncAppShield(state({
      gateEnabled: true,
      pendingGate: { liveAt: weeksOut, titles: ['Morning walk'] },
    }));
    expect(mockBridge.scheduleGateWindow).not.toHaveBeenCalled();
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      pendingGateDetail: null,
    }));
  });

  it('leaves a pending gate out of what is blocking right now', () => {
    // The window is for later. Nothing is in the way yet, so the apps stay
    // open — arming must never be the same thing as blocking.
    syncAppShield(state({
      gateEnabled: true,
      pendingGate: { liveAt: SOON, titles: ['Morning walk'] },
    }));
    expect(mockBridge.applyShield).not.toHaveBeenCalled();
    expect(mockBridge.clearShield).toHaveBeenCalled();
  });
});

describe('a key tag lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBridgeOpen = true;
  });

  it('wants the shield on its own, and leads with the key reason', () => {
    expect(appShieldWanted(state({ keyLocked: true }))).toBe(true);
    syncAppShield(state({ keyLocked: true }));
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'key',
      detail: 'These apps are locked until you tap your key tag.',
      untilIso: null,
    }));
  });

  it('lifts when the tag unlocks and nothing else wants the apps', () => {
    syncAppShield(state({ keyLocked: false }));
    expect(mockBridge.clearShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.applyShield).not.toHaveBeenCalled();
  });

  it('never lifts a penalty: unlocking leaves the penalty block up', () => {
    syncAppShield(state({ keyLocked: false, penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('never lifts a gate or a focus session either', () => {
    syncAppShield(state({ keyLocked: false, gateEnabled: true, gateTitles: ['Walk'] }));
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
    syncAppShield(state({ keyLocked: false, session: session(), focusEnabled: true }));
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('tells the monitor extension a penalty ending must not lift a tag lock', () => {
    syncAppShield(state({ keyLocked: true, penaltyUntil: LATER, penaltyEnabled: true }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({
      otherReasonWantsShield: true,
      reason: 'penalty',
    }));
  });

  it('yields the screen to the reasons that name something the person did', () => {
    syncAppShield(state({ keyLocked: true, gateEnabled: true, gateTitles: ['Walk'] }));
    expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({ reason: 'gate' }));
  });

  it('does nothing without the bridge (demo mode, Android, no native half)', () => {
    mockBridgeOpen = false;
    expect(() => syncAppShield(state({ keyLocked: true }))).not.toThrow();
    expect(mockBridge.applyShield).not.toHaveBeenCalled();
  });
});

describe('shieldReasons', () => {
  const { shieldReasons } = require('../utils/appShield') as typeof import('../utils/appShield');

  it('is empty when nothing wants the apps', () => {
    expect(shieldReasons(state())).toEqual([]);
  });

  it('lists every reason in the order the shield screen leads with them', () => {
    const reasons = shieldReasons(state({
      session: session(), focusEnabled: true,
      gateEnabled: true, gateTitles: ['Morning walk'],
      penaltyUntil: LATER, penaltyEnabled: true, penaltyReason: 'Pay rent',
      keyLocked: true,
    }));
    expect(reasons.map(r => r.reason)).toEqual(['focus', 'gate', 'penalty', 'key']);
    expect(reasons[1].titles).toEqual(['Morning walk']);
    expect(reasons[2]).toMatchObject({ until: LATER, cause: 'Pay rent' });
  });

  it('leaves out a feature that is switched off, and a penalty that has run out', () => {
    expect(shieldReasons(state({ gateEnabled: false, gateTitles: ['Walk'] }))).toEqual([]);
    expect(shieldReasons(state({ penaltyUntil: EARLIER, penaltyEnabled: true }))).toEqual([]);
  });

  it('agrees with the reason the shield is written with', () => {
    jest.clearAllMocks();
    const cases: Partial<AppShieldState>[] = [
      { keyLocked: true },
      { keyLocked: true, penaltyUntil: LATER, penaltyEnabled: true },
      { keyLocked: true, penaltyUntil: LATER, penaltyEnabled: true, gateEnabled: true, gateTitles: ['Walk'] },
      { session: session(), focusEnabled: true, keyLocked: true },
      {},
    ];
    for (const over of cases) {
      jest.clearAllMocks();
      const s = state(over);
      syncAppShield(s);
      const lead = shieldReasons(s)[0]?.reason ?? 'none';
      expect(mockBridge.setShieldState).toHaveBeenCalledWith(expect.objectContaining({ reason: lead }));
    }
  });

  it('agrees with whether the shield is wanted at all', () => {
    for (const over of [{}, { keyLocked: true }, { gateEnabled: true, gateTitles: ['x'] }] as Partial<AppShieldState>[]) {
      expect(shieldReasons(state(over)).length > 0).toBe(appShieldWanted(state(over)));
    }
  });
});

describe('app groups and schedules', () => {
  const SCHEDULE = {
    id: 'sch', name: 'Work hours', groupId: 'social', days: [0, 1, 2, 3, 4, 5, 6],
    startMinutes: 0, endMinutes: 23 * 60 + 59, enabled: true, pausedUntil: null,
  };
  // NOW is 09:00Z; schedules use the device's clock, so build the window around it.
  const around = {
    ...SCHEDULE,
    startMinutes: NOW.getHours() * 60 + NOW.getMinutes() - 30,
    endMinutes: NOW.getHours() * 60 + NOW.getMinutes() + 60,
  };
  const spec = (id: string) => ({ ...around, id });

  beforeEach(() => jest.clearAllMocks());

  it('blocks the union of the groups its live reasons name', () => {
    syncAppShield(state({
      keyLocked: true,
      groups: { focus: 'default', gate: 'default', penalty: 'default', key: 'games' },
      session: session(), focusEnabled: true,
    }));
    expect(mockBridge.applyShield).toHaveBeenCalledWith(['default', 'games']);
  });

  it('blocks a schedule open now, and counts as wanting the shield', () => {
    const s = state({ schedules: [spec('a')] });
    expect(appShieldWanted(s)).toBe(true);
    syncAppShield(s);
    expect(mockBridge.applyShield).toHaveBeenCalledWith(['social']);
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('resolves a removed schedule group through the caller', () => {
    syncAppShield(state({ schedules: [spec('a')], resolveGroup: () => 'default' }));
    expect(mockBridge.applyShield).toHaveBeenCalledWith(['default']);
  });

  it('does not block for a schedule that is off, paused or outside its window', () => {
    const off = { ...spec('a'), enabled: false };
    const paused = { ...spec('b'), pausedUntil: LATER };
    const later = { ...spec('c'), startMinutes: around.endMinutes + 10, endMinutes: around.endMinutes + 40 };
    expect(appShieldWanted(state({ schedules: [off, paused, later] }))).toBe(false);
    syncAppShield(state({ schedules: [off, paused, later] }));
    expect(mockBridge.clearShield).toHaveBeenCalled();
  });

  it('hands the schedules to the native side on every reconcile, including when none is open', () => {
    syncAppShield(state({ schedules: [{ ...spec('a'), enabled: false }, spec('b')] }));
    expect(mockBridge.setBlockSchedules).toHaveBeenCalledWith([expect.objectContaining({ id: 'b', name: 'Work hours' })]);
  });

  it('writes each reason class its own group so one ending leaves the rest', () => {
    syncAppShield(state({
      penaltyUntil: LATER, penaltyEnabled: true,
      keyLocked: true,
      groups: { focus: 'default', gate: 'default', penalty: 'games', key: 'social' },
    }));
    const written = mockBridge.setShieldState.mock.calls[0] as unknown as [{ groups: unknown }];
    expect(written[0].groups).toEqual({
      otherGroupIds: ['social'],
      penaltyGroupId: 'games',
      penaltyEndIso: LATER,
      manualGroupId: null,
      manualEndIso: null,
      pendingGateGroupIds: [],
      pendingGateLiveAtIso: null,
    });
  });

  it('leads with the schedule on the shield screen, naming it and when it ends', () => {
    syncAppShield(state({ schedules: [spec('a')] }));
    const written = mockBridge.setShieldState.mock.calls[0] as unknown as [{ reason: string; detail: string; untilIso: string }];
    expect(written[0]).toMatchObject({ reason: 'schedule', detail: 'Work hours' });
    expect(written[0].untilIso).toEqual(expect.any(String));
  });

  it('keeps a penalty reading first when a schedule is also open', () => {
    syncAppShield(state({ schedules: [spec('a')], penaltyUntil: LATER, penaltyEnabled: true, penaltyReason: 'Walk' }));
    const written = mockBridge.setShieldState.mock.calls[0] as unknown as [{ reason: string }];
    expect(written[0].reason).toBe('penalty');
  });

  describe('per-task gate groups', () => {
    const gated = { gateEnabled: true, gateTitles: ['Walk', 'Read', 'Stretch'] };

    it('blocks each gate\'s own group, and the setting\'s group for a gate that names none', () => {
      syncAppShield(state({
        ...gated,
        gateGroupIds: ['social', 'games', 'social'],
      }));
      expect(mockBridge.applyShield).toHaveBeenCalledWith(['social', 'games']);
    });

    it('lists one gate reason per group, each naming only its own tasks', () => {
      const reasons = shieldReasons(state({ ...gated, gateGroupIds: ['social', 'games', 'social'] }));
      expect(reasons).toEqual([
        { reason: 'gate', titles: ['Walk', 'Stretch'], groupId: 'social' },
        { reason: 'gate', titles: ['Read'], groupId: 'games' },
      ]);
    });

    it('uses the gate setting\'s group when no group list is given', () => {
      syncAppShield(state({ ...gated, groups: { focus: 'default', gate: 'games', penalty: 'default', key: 'default' } }));
      expect(mockBridge.applyShield).toHaveBeenCalledWith(['games']);
    });

    it('writes every held gate group for the extension, and the pending gate\'s groups', () => {
      const liveAt = new Date(NOW.getTime() + 60 * 60 * 1000);
      syncAppShield(state({
        ...gated,
        gateGroupIds: ['social', 'games', 'social'],
        pendingGate: { liveAt, titles: ['Later'], groupIds: ['music'] },
      }));
      const written = mockBridge.setShieldState.mock.calls[0] as unknown as [{ groups: Record<string, unknown> }];
      expect(written[0].groups.otherGroupIds).toEqual(['social', 'games']);
      expect(written[0].groups.pendingGateGroupIds).toEqual(['music']);
    });
  });
});

describe('a block the person started by hand', () => {
  const manual = { untilIso: LATER, groupId: 'games' };

  it('wants the shield on its own until it runs out', () => {
    expect(appShieldWanted(state({ manual }))).toBe(true);
    expect(appShieldWanted(state({ manual: { untilIso: EARLIER, groupId: 'games' } }))).toBe(false);
  });

  it('names its group and its end, and reads right after a focus session', () => {
    const reasons = shieldReasons(state({ session: session(), focusEnabled: true, manual, penaltyUntil: LATER, penaltyEnabled: true }));
    expect(reasons.map(r => r.reason)).toEqual(['focus', 'manual', 'penalty']);
    expect(reasons[1]).toEqual({ reason: 'manual', until: LATER, groupId: 'games' });
  });

  it('applies its own group and arms its own window, not the penalty\'s', () => {
    syncAppShield(state({ manual }));
    expect(mockBridge.applyShield).toHaveBeenCalledWith(['games']);
    expect(mockBridge.scheduleManualExpiry).toHaveBeenCalledWith(LATER);
    expect(mockBridge.cancelPenaltyExpiry).toHaveBeenCalledTimes(1);
    expect(mockBridge.schedulePenaltyExpiry).not.toHaveBeenCalled();
  });

  it('writes its group and end for the extension, apart from the penalty\'s', () => {
    syncAppShield(state({
      manual, penaltyUntil: LATER, penaltyEnabled: true,
      groups: { focus: 'default', gate: 'default', penalty: 'social', key: 'default' },
    }));
    const written = mockBridge.setShieldState.mock.calls[0] as unknown as [{ groups: Record<string, unknown>; otherReasonWantsShield: boolean }];
    expect(written[0].groups).toMatchObject({
      manualGroupId: 'games', manualEndIso: LATER, penaltyGroupId: 'social', penaltyEndIso: LATER, otherGroupIds: [],
    });
    // Neither a penalty nor a manual block is an "other" reason: each ends on its own clock.
    expect(written[0].otherReasonWantsShield).toBe(false);
  });

  it('leads the shield screen and carries its end', () => {
    syncAppShield(state({ manual }));
    const written = mockBridge.setShieldState.mock.calls[0] as unknown as [{ reason: string; untilIso: string }];
    expect(written[0]).toMatchObject({ reason: 'manual', untilIso: LATER });
  });

  it('disarms its window once it has run out', () => {
    syncAppShield(state({ manual: { untilIso: EARLIER, groupId: 'games' } }));
    expect(mockBridge.cancelManualExpiry).toHaveBeenCalledTimes(1);
    expect(mockBridge.scheduleManualExpiry).not.toHaveBeenCalled();
    expect(mockBridge.clearShield).toHaveBeenCalled();
  });
});
