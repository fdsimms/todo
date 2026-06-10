import * as ExpoHaptics from 'expo-haptics';

/**
 * Semantic haptics vocabulary for the app. Components should call these
 * instead of importing expo-haptics directly so each interaction type
 * always fires with the same intensity:
 *
 *   tap        — selections, toggles, chips, tab presses, picker changes
 *   success    — completing a task, confirming an add
 *   warning    — destructive confirmation prompts
 *   error      — failed actions, validation errors
 *   impact     — physical-feeling moments (drag lift, drop, swipe actions)
 *
 * All return promises that are safe to ignore; failures are swallowed.
 */
export const haptics = {
  tap: () => ExpoHaptics.selectionAsync().catch(() => {}),
  success: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning).catch(() => {}),
  error: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error).catch(() => {}),
  impactLight: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light).catch(() => {}),
  impactMedium: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  impactHeavy: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
};
