import { Alert } from 'react-native';
import type { LargeAmountWarning } from './foodLog';

/**
 * The one "Change amount / Log anyway" alert the three amount sheets
 * (`FoodLogEntrySheet`, `ScanPortionSheet`, `SavedMealReviewSheet`) show when
 * `largeAmountWarning` says an amount reads like a weight in the wrong unit.
 * Written once so the wording is the same on each; the check itself is in
 * `foodLog.ts`.
 */
export function confirmLargeAmount(warning: LargeAmountWarning, onLogAnyway: () => void): void {
  Alert.alert(warning.title, warning.message, [
    { text: 'Change amount', style: 'cancel' },
    { text: 'Log anyway', onPress: onLogAnyway },
  ]);
}
