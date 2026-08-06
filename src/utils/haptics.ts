import * as ExpoHaptics from 'expo-haptics';

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
 *   tap        — selections, toggles, chips, tab presses, picker changes
 *   dragTick   — a drag crossing into a new slot, rate-limited (see below)
 *   success    — completing a task, confirming an add
 *   warning    — destructive confirmation prompts
 *   error      — failed actions, validation errors
 *   impact     — physical-feeling moments (drag lift, drop, swipe actions)
 *
 * All return promises that are safe to ignore; failures are swallowed.
 */
export const haptics = {
  tap: () => ExpoHaptics.selectionAsync().catch(() => {}),
  dragTick: () => {
    const now = Date.now();
    if (now - lastDragTick < MIN_DRAG_TICK_MS) return;
    lastDragTick = now;
    return ExpoHaptics.selectionAsync().catch(() => {});
  },
  success: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning).catch(() => {}),
  error: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error).catch(() => {}),
  impactLight: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light).catch(() => {}),
  impactMedium: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  impactHeavy: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
};
