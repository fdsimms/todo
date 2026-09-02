import { Platform } from 'react-native';
import { isDemoModeActive } from './demoState';

/**
 * The one door to `todo-health-bridge`, and so the one place that decides
 * whether this app may read Apple Health at all.
 *
 * The same gate `widgetBridge()` and `screenTimeBridge()` are, and demo mode is
 * the sharpest case either of them has had. Demo mode swaps the whole database
 * for a throwaway one, and every `db*` function keeps working and quietly
 * answers about seeded fiction — so a reading taken here would be a real
 * person's real body, read into a database about to be discarded, to be shown
 * beside invented tasks. Neither direction of the demo rule is comfortable:
 * it is a real read the demo has no business making, and anything derived from
 * it is a claim about someone that outlives the demo only by luck.
 *
 * Unlike the Screen Time gate there is nothing here that *writes* anywhere, and
 * nothing that drains a queue: every call is a read, and the worst a leak could
 * do is show a true number in a fictional context. That is still enough. The
 * gate is also what keeps the permission sheet from ever being raised by a demo
 * session, which is the visible half.
 *
 * Returns null for every reason a caller has nothing to do — not iOS, demo mode
 * on, or no native module in the binary — so a caller is one `if` rather than a
 * chain of them. The require stays lazy because the native half doesn't exist
 * in Expo Go or on Android, and a static import would throw at module scope
 * rather than at the call.
 */
export type HealthBridge = typeof import('todo-health-bridge');

export function healthBridge(): HealthBridge | null {
  if (Platform.OS !== 'ios') return null;
  // Checked at the call rather than at import: demo mode is entered and left
  // while the app is running, and a module-scope answer would be the one from
  // launch for ever.
  if (isDemoModeActive()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('todo-health-bridge') as HealthBridge;
  } catch {
    // No dev client build with the native module present (e.g. Expo Go), or a
    // build predating one of these functions — no-op either way.
    return null;
  }
}

/**
 * Whether the feature can be offered at all: a build with the native half, on a
 * device that has health data, outside demo mode.
 *
 * Separate from anything about authorization, and this is the one integration
 * where that separation is forced rather than chosen. "This device can't"
 * (iPad, or a build without the framework) is knowable and hides the rows;
 * "you haven't been asked yet" is knowable and offers a button; "you said no"
 * is **not knowable at all**, by Apple's design, and so must never appear on
 * screen. See `todo-health-bridge/index.ts` for why.
 */
export function isHealthSupported(): boolean {
  return healthBridge()?.isHealthAvailable() ?? false;
}
