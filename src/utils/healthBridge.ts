import { Platform, Linking } from 'react-native';
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
 * This gate now covers two writes as well as every read — a dietary-water
 * sample, logged when a task that opted into it completes (see
 * `healthCompletionSync.ts`), and a body-mass sample when somebody records a
 * weight — and demo mode is the sharper case for that half, not the milder one
 * the note above still describes for reads. A read leak shows a true number in
 * a fictional context; a write leak would put a *real* sample in the person's
 * *real* Health record, sourced from a demo-seeded completion that never
 * happened. Nothing here drains a queue the way the Screen Time/widget gates'
 * writes do, but "worse than a read leak" is still the operative comparison,
 * not "as harmless as one". The gate is also what keeps either permission
 * sheet — read or write — from ever being raised by a demo session, which is
 * the visible half.
 *
 * The weight write is the milder of the two against demo mode, and only by
 * accident: it is reached from a screen rather than from a completion, so a
 * demo session would have to be driven there by hand rather than writing on
 * its own. The gate is unconditional anyway, because "you would have to mean
 * it" is not a guarantee and this is somebody's medical record.
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

/**
 * HealthKit permissions live in the Health app itself, under the profile
 * icon's Privacy → Apps page, not in this app's page under iOS Settings —
 * Settings has no Health row to show. Try the Health app's URL scheme first
 * and only fall back to Settings if that fails.
 *
 * **`x-apple-health` has to be declared in `LSApplicationQueriesSchemes`
 * (app.json's `ios.infoPlist`) or `Linking.openURL` rejects outright**,
 * landing every caller in the `catch` below — this app's own Settings page,
 * which has no Health row, silently proving the row's own hint text wrong.
 * That's not a hypothetical: it shipped without the entry once already.
 *
 * The one door for any "let them fix Health access" button — never call
 * `Linking.openSettings()` directly for a Health permission problem.
 */
export async function openHealthApp(): Promise<void> {
  try {
    await Linking.openURL('x-apple-health://');
  } catch {
    await Linking.openSettings();
  }
}
