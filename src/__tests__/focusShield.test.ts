/**
 * Blocking apps during a focus session.
 *
 * The rule is one predicate and the rest is delivery, so that is what this
 * pins down — above all the asymmetry that makes the feature safe: every
 * state that isn't unambiguously "a session is running right now" must answer
 * false, including the ones nobody wrote a handler for. A shield left on is
 * somebody locked out of their own phone.
 *
 * Writing the shield is `appShield.test.ts`, which is where the delivery moved
 * once a failed task could ask for the same shield for its own reasons.
 */
import type { FocusSession, FocusStep } from '../types';
import { shieldWanted } from '../utils/focusShield';

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
