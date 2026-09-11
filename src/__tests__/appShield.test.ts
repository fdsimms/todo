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
  schedulePenaltyExpiry: jest.fn(() => true),
  cancelPenaltyExpiry: jest.fn(() => true),
  scheduleGateWindow: jest.fn(() => true),
  cancelGateWindow: jest.fn(() => true),
};
let mockBridgeOpen = true;
jest.mock('../utils/screenTimeBridge', () => ({
  screenTimeBridge: () => (mockBridgeOpen ? mockBridge : null),
  isScreenTimeSupported: () => mockBridgeOpen,
}));

import type { FocusSession, FocusStep } from '../types';
import { appShieldWanted, syncAppShield, type AppShieldState } from '../utils/appShield';

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
  ...over,
});

const state = (over: Partial<AppShieldState> = {}): AppShieldState => ({
  session: null,
  focusEnabled: false,
  penaltyUntil: null,
  penaltyEnabled: false,
  penaltyReason: null,
  gateEnabled: false,
  gateTitles: [],
  pendingGate: null,
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
    expect(mockBridge.setShieldState).toHaveBeenCalledWith({
      otherReasonWantsShield: false,
      reason: 'penalty',
      untilIso: LATER,
      pendingGateDetail: null,
      detail: 'Morning walk',
    });
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
    expect(mockBridge.setShieldState).toHaveBeenCalledWith({
      otherReasonWantsShield: false,
      reason: 'none',
      untilIso: null,
      detail: null,
      pendingGateDetail: null,
    });
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
        detail: "Morning walk isn't done yet. Finish it in dundundun to unblock.",
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
      pendingGateDetail: "Morning walk isn't done yet. Finish it in dundundun to unblock.",
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
