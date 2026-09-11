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
  now: NOW,
  ...over,
});

beforeEach(() => {
  mockBridgeOpen = true;
  mockBridge.applyShield.mockClear();
  mockBridge.clearShield.mockClear();
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
