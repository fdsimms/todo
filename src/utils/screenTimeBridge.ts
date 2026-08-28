import { Platform } from 'react-native';
import { isDemoModeActive } from './demoState';

/**
 * The one door to `todo-screentime-bridge`, and so the one place that decides
 * whether this app may touch iOS Screen Time at all.
 *
 * The same gate `widgetBridge()` is, for the same two reasons and one more:
 *
 * - **Everything behind it lives outside this app's database.** A shield is
 *   written to a system store and survives the app being killed; a monitor is
 *   armed with the OS and outlives a launch. Both are visible with the app
 *   closed, which is the definition the widget gate uses.
 * - **Demo mode must not reach any of it.** Entering demo mode swaps the
 *   database and fires every subscription downstream, so an ungated shield
 *   would block someone's real apps on the strength of a seeded fiction, and
 *   an ungated `drainCrossings` — read-and-clear, like the widget's queues —
 *   would consume a real threshold crossing into a database about to be
 *   discarded.
 * - **A shield is the one thing here that is worse to leave on than to skip.**
 *   `clearShield` is deliberately reachable through this gate too, so the
 *   launch backstop that lifts a shield left behind by a crash goes through
 *   the same door as the one that applied it.
 *
 * Returns null for every reason a caller has nothing to do — not iOS, demo
 * mode on, or no native module in the binary — so a caller is one `if` rather
 * than a chain of them. The require stays lazy because the native half doesn't
 * exist in Expo Go or on Android, and a static import would throw at module
 * scope rather than at the call.
 */
export type ScreenTimeBridge = typeof import('todo-screentime-bridge');

export function screenTimeBridge(): ScreenTimeBridge | null {
  if (Platform.OS !== 'ios') return null;
  // Checked at the call rather than at import: demo mode is entered and left
  // while the app is running, and a module-scope answer would be the one from
  // launch for ever.
  if (isDemoModeActive()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('todo-screentime-bridge') as ScreenTimeBridge;
  } catch {
    // No dev client build with the native module present (e.g. Expo Go), or a
    // build predating one of these functions — no-op either way.
    return null;
  }
}

/**
 * Whether the feature can be offered at all: a build with the native half, on
 * a device new enough, outside demo mode.
 *
 * Separate from `screenTimeAuthorizationStatus` on purpose. "This phone can't"
 * and "you haven't said yes yet" want different things on screen — the first
 * hides the rows, the second offers a button — and collapsing them is how a
 * settings screen ends up asking an iOS 15 user for permission it can never
 * use.
 */
export function isScreenTimeSupported(): boolean {
  return screenTimeBridge()?.isScreenTimeAvailable() ?? false;
}
