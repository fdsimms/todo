import { Alert, Linking } from 'react-native';

/**
 * The alert shown right after the system prompt was answered "Don't Allow".
 * iOS never asks twice, so the only way forward is the app's page in the
 * Settings app, and the button goes straight there rather than leaving the
 * message to describe the trip. A permission that was already denied before
 * the tap skips this and opens Settings directly (the callers' own branch).
 */
export function alertPermissionOff(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
  ]);
}
