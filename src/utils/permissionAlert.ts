import { Alert, Linking } from 'react-native';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * The alert shown right after the system prompt was answered "Don't Allow".
 * iOS never asks twice, so the only way forward is the app's page in the
 * Settings app, and the button goes straight there rather than leaving the
 * message to describe the trip. A permission that was already denied before
 * the tap skips this and opens Settings directly (the callers' own branch).
 */
export function alertPermissionOff(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: BUTTON_LABEL.cancel, style: 'cancel' },
    { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
  ]);
}

/**
 * A failure whose usual cause is an access the person turned off, with a way
 * to check it. The message says which access; the button opens the app's page
 * in the Settings app, the same trip `alertPermissionOff` makes, so the alert
 * isn't a dead end that only describes where to go. "OK" rather than Cancel:
 * nothing is being asked, the thing already failed.
 */
export function alertFailedWithSettings(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: 'OK', style: 'cancel' },
    { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
  ]);
}
