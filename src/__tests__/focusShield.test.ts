/**
 * Blocking apps during a focus session.
 *
 * The rule is one predicate and the rest is delivery, so that is what this
 * pins down — above all the asymmetry that makes the feature safe: every
 * state that isn't unambiguously "a session is running right now" must clear
 * the shield, including the ones nobody wrote a handler for. A shield left on
 * is somebody locked out of their own phone.
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
import { shieldWanted, syncFocusShield } from '../utils/focusShield';

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

beforeEach(() => {
  mockBridgeOpen = true;
  mockBridge.applyShield.mockClear();
  mockBridge.clearShield.mockClear();
});

describe('shieldWanted', () => {
  it('is true only for a running session with the setting on', () => {
    expect(shieldWanted(session(), true)).toBe(true);
  });

  it('is false with the setting off, however live the session', () => {
    expect(shieldWanted(session(), false)).toBe(false);
  });

  it('is false with no session at all', () => {
    expect(shieldWanted(null, true)).toBe(false);
  });

  it('is false while paused — pausing is a deliberate break, and the phone is usually the break', () => {
    expect(shieldWanted(session({ stepStartedAt: null }), true)).toBe(false);
  });

  it('is false once the plan is finished, even if the clock was left running', () => {
    const done = session({ stepIndex: 2 });
    expect(shieldWanted(done, true)).toBe(false);
  });

  it('is false for a session whose plan is empty', () => {
    expect(shieldWanted(session({ steps: [], stepIndex: 0 }), true)).toBe(false);
  });
});

describe('syncFocusShield', () => {
  it('applies for a running session', () => {
    syncFocusShield(session(), true);
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(1);
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('clears for every state that is not running', () => {
    syncFocusShield(null, true);
    syncFocusShield(session({ stepStartedAt: null }), true);
    syncFocusShield(session(), false);
    syncFocusShield(session({ stepIndex: 2 }), true);

    expect(mockBridge.clearShield).toHaveBeenCalledTimes(4);
    expect(mockBridge.applyShield).not.toHaveBeenCalled();
  });

  it('clears rather than doing nothing when there is no session — this is the crash backstop', () => {
    // The case that matters most: a shield written by a run that has since
    // died is still in force, and this call at launch is what lifts it.
    syncFocusShield(null, false);
    expect(mockBridge.clearShield).toHaveBeenCalledTimes(1);
  });

  it('touches nothing when the gate is closed', () => {
    // Demo mode, Android, or a build with no native half. Notably it does not
    // try to clear either: with no bridge there is nothing written to clear.
    mockBridgeOpen = false;
    syncFocusShield(session(), true);
    syncFocusShield(null, true);

    expect(mockBridge.applyShield).not.toHaveBeenCalled();
    expect(mockBridge.clearShield).not.toHaveBeenCalled();
  });

  it('is safe to over-call, which is what lets every foreground re-assert it', () => {
    syncFocusShield(session(), true);
    syncFocusShield(session(), true);
    syncFocusShield(session(), true);
    expect(mockBridge.applyShield).toHaveBeenCalledTimes(3);
  });
});
