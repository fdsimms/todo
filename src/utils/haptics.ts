import * as ExpoHaptics from 'expo-haptics';

/**
 * Semantic haptics vocabulary for the app. Components should call these
 * instead of importing expo-haptics directly so each interaction type
 * always fires with the same intensity:
 *
 *   tap        — selections, toggles, chips, tab presses, picker changes
 *   success    — completing a task, confirming an add
 *   warning    — destructive confirmation prompts
 *   impact     — physical-feeling moments (drag lift, drop, swipe actions)
 */
export const haptics = {
  tap: () => ExpoHaptics.selectionAsync(),
  success: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success),
  warning: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning),
  impactLight: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light),
  impactMedium: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium),
  impactHeavy: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy),
};
