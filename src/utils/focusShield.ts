import type { FocusSession } from '../types';
import { isFocusRunning, isFocusSessionFinished } from './focusPlan';

/**
 * Blocking the apps you picked, for as long as a focus session is actually
 * running.
 *
 * The rule is one line (`shieldWanted`) and everything else about this feature
 * is making sure it gets *applied*, because it is the one thing in the app
 * whose failure mode is worse than not working: a shield left on is somebody
 * locked out of their own phone by an app that is no longer running.
 *
 * So the halves live apart. What's here is pure and takes its state as
 * arguments — testable with plain objects, no store to stand up. Writing the
 * shield belongs to `appShield.ts`, which is the only caller that matters:
 * a failed task can block the same apps for its own reasons, both reasons
 * share one system shield, and a reconciler per reason would mean each one
 * clearing the other's block. The delivery on top of that is
 * `src/hooks/useAppShieldSync.ts`, which watches the session, the settings, the
 * app's own foregrounding and the moment a penalty runs out, and reconciles
 * against all of them rather than firing at the points where a session
 * changes. There is no list of "the actions that end a session" to keep in step
 * that way, and a state nobody wrote a handler for resolves to "not running",
 * which clears.
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
