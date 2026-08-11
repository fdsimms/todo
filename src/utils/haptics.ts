import * as ExpoHaptics from 'expo-haptics';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * The single gate for the "Haptic feedback" setting. Every haptic in the app
 * goes through the vocabulary below — components never import expo-haptics
 * directly — so switching it off here switches it off everywhere, with no
 * call site aware of it.
 *
 * Read per call rather than captured, because the setting can change while the
 * modules that imported `haptics` are still mounted.
 */
function enabled(): boolean {
  return useSettingsStore.getState().hapticsEnabled;
}

/**
 * Floor between two drag ticks. A drag can cross several slots between frames,
 * and the taptic engine queues rather than drops what it can't play yet — so
 * unthrottled ticks stop reading as "one per row" and turn into one long buzz
 * that keeps going after the finger has stopped.
 */
const MIN_DRAG_TICK_MS = 80;
let lastDragTick = 0;

/**
 * Semantic haptics vocabulary for the app. Components should call these
 * instead of importing expo-haptics directly so each interaction type
 * always fires with the same intensity:
 *
 *   tap          — selections, toggles, chips, tab presses, picker changes
 *   dragTick     — a drag crossing into a new slot, rate-limited (see below)
 *   success      — completing a task, confirming an add
 *   chainFinish  — completing the last step of a non-repeating chain
 *   warning      — destructive confirmation prompts
 *   error        — failed actions, validation errors
 *   impact       — physical-feeling moments (drag lift, drop, swipe actions)
 *
 * All return a promise that is safe to ignore — or nothing at all, when the
 * haptics setting is off or a drag tick lands inside the throttle. Failures
 * are swallowed either way; no caller awaits these.
 */
export const haptics = {
  tap: () => enabled() ? ExpoHaptics.selectionAsync().catch(() => {}) : undefined,
  dragTick: () => {
    if (!enabled()) return;
    const now = Date.now();
    if (now - lastDragTick < MIN_DRAG_TICK_MS) return;
    lastDragTick = now;
    return ExpoHaptics.selectionAsync().catch(() => {});
  },
  success: () => enabled() ? ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => {}) : undefined,
  // A second, heavier pulse after the normal success notification — finishing
  // a whole multi-step routine should read as more than checking off one more
  // task, the same way a plain completion and a quota topping out already
  // feel different from each other.
  chainFinish: async () => {
    if (!enabled()) return;
    try {
      await ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success);
      await ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy);
    } catch {
      // no-op, matching every other entry here
    }
  },
  warning: () => enabled() ? ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning).catch(() => {}) : undefined,
  error: () => enabled() ? ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error).catch(() => {}) : undefined,
  impactLight: () => enabled() ? ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light).catch(() => {}) : undefined,
  impactMedium: () => enabled() ? ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium).catch(() => {}) : undefined,
  impactHeavy: () => enabled() ? ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy).catch(() => {}) : undefined,
};
