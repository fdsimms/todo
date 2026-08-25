import { Platform } from 'react-native';
import { isDemoModeActive } from './demoState';

/**
 * The one door to `todo-widget-bridge`, and so the one place that decides
 * whether this app may write outside its own database at all.
 *
 * Everything behind that bridge lives somewhere the app's SQLite file doesn't:
 * the App Group container the home-screen widget reads, the queue the widget's
 * checkbox writes into, the queue the share extension writes into, and the
 * Live Activities on the lock screen and in the Dynamic Island. All of it
 * outlives a launch, and all of it is visible with the app closed.
 *
 * **Which is why demo mode is gated here rather than at each call site.** Demo
 * mode swaps the whole database for a throwaway (`switchToDemoDatabase`), so
 * every store reloads with seeded fiction and every subscription downstream
 * fires — and the six callers of this bridge are all subscriptions. Left
 * ungated they put fake tasks on the real widget and a fake shopping trip on
 * the real lock screen, and, worse, the two *drains* consume real queued work
 * into a database that is about to be discarded: a checkbox tapped on the
 * widget, or a recipe shared in from Safari, silently does nothing.
 *
 * It was six copies of this same lazy require, one per call site, each with the
 * same try/catch and each having to remember the same two guards. Five of them
 * didn't remember the demo one, which is the argument for there being one of
 * these rather than six.
 *
 * Returns null for every reason a caller has nothing to do — not iOS, demo mode
 * on, or no native module in the binary — so a caller is one `if` rather than a
 * chain of them. The require stays lazy for the reason it always was: the
 * native half doesn't exist in Expo Go or on Android, and a static import would
 * throw at module scope rather than at the call.
 */
export interface WidgetBridge {
  writeWidgetSnapshot: (jsonString: string) => Promise<boolean>;
  drainPendingWidgetCompletions: () => Promise<string[]>;
  drainSharedLinks: () => Promise<string[]>;
  syncTimerLiveActivities: (jsonString: string) => Promise<boolean>;
  syncTripLiveActivity: (jsonString: string) => Promise<boolean>;
  syncFocusLiveActivity: (jsonString: string) => Promise<boolean>;
}

export function widgetBridge(): WidgetBridge | null {
  if (Platform.OS !== 'ios') return null;
  // Checked at the call rather than at import: demo mode is entered and left
  // while the app is running, and a module-scope answer would be the one from
  // launch for ever.
  if (isDemoModeActive()) return null;
  try {
    return require('todo-widget-bridge') as WidgetBridge;
  } catch {
    // No dev client build with the native module present (e.g. Expo Go), or a
    // build predating one of these functions — no-op either way.
    return null;
  }
}
