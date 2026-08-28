import type { FocusSession } from '../types';
import { isFocusRunning, isFocusSessionFinished } from './focusPlan';
import { screenTimeBridge } from './screenTimeBridge';

/**
 * Blocking the apps you picked, for as long as a focus session is actually
 * running.
 *
 * The rule is one line (`shieldWanted`) and everything else about this feature
 * is making sure it gets *applied*, because it is the one thing in the app
 * whose failure mode is worse than not working: a shield left on is somebody
 * locked out of their own phone by an app that is no longer running.
 *
 * So the two halves live apart. What's here is pure and takes its state as
 * arguments — testable with plain objects, no store to stand up. The delivery
 * is `src/hooks/useFocusShieldSync.ts`, which watches the session, the setting
 * and the app's own foregrounding, and reconciles against all three rather
 * than firing at the points where a session changes. There is no list of "the
 * actions that end a session" to keep in step that way, and a state nobody
 * wrote a handler for resolves to "not running", which clears.
 *
 * Demo mode and a build without the native half are refused by
 * `screenTimeBridge()` itself — including for `clearShield`, which has to go
 * through the same door or the crash backstop would be the one call that
 * couldn't run.
 */

/**
 * Whether the apps should be blocked right now.
 *
 * Every arm but one returns false, and that asymmetry is the design: this is
 * asked about states the rest of the app may add to, and the safe answer to an
 * unfamiliar one is to unblock.
 */
export function shieldWanted(session: FocusSession | null, enabled: boolean): boolean {
  if (!enabled || session === null) return false;
  return isFocusRunning(session) && !isFocusSessionFinished(session);
}

/**
 * Bring the system shield into line with the state given.
 *
 * Safe to over-call, which is the point: it runs on every session write, every
 * settings change and every foreground, and two of those usually agree.
 * Applying is idempotent on the native side, so re-asserting costs nothing and
 * this needs no memory of what it last did.
 */
export function syncFocusShield(session: FocusSession | null, enabled: boolean): void {
  const bridge = screenTimeBridge();
  if (!bridge) return;
  if (shieldWanted(session, enabled)) bridge.applyShield();
  else bridge.clearShield();
}
