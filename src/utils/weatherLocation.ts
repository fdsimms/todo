import { Platform } from 'react-native';
import { isDemoModeActive } from './demoState';

/**
 * The device's own position, read once a day to ask Open-Meteo what the
 * weather is. The native half only — permission and one coordinate pair;
 * `weatherCondition.ts` and `weatherTasks.ts` are the pure, tested rules about
 * what a reading means. Same split `contactsAccess.ts` and `contactsImport.ts`
 * keep.
 *
 * Required where it's used rather than imported at the top, for the reason
 * `contactsAccess.ts` gives: an Expo native module resolves its native half
 * with `requireNativeModule` at module scope, and a static import would hoist
 * that throw into the app's own bundle evaluation.
 */
function location(): typeof import('expo-location') {
  return require('expo-location');
}

export type LocationPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Mirrors getContactsPermission()/getCalendarPermission(), including the canAskAgain line. */
export async function getLocationPermission(): Promise<LocationPermission> {
  if (Platform.OS !== 'ios') return 'unsupported';
  try {
    const existing = await location().getForegroundPermissionsAsync();
    if (existing.granted) return 'granted';
    return existing.status === 'undetermined' || existing.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const existing = await location().getForegroundPermissionsAsync();
    if (existing.granted) return true;
    const result = await location().requestForegroundPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
}

/**
 * The device's current position, or null for every reason it might not be —
 * not iOS, demo mode, no permission granted yet, or a read that threw. All
 * four collapse to the same answer: `useWeatherStore.refresh()` has nothing
 * useful to do with "why" and would otherwise have to re-derive it from the
 * permission state itself.
 *
 * **Never requests permission.** Same read-only stance `useCalendarSync`'s own
 * `refresh()` takes — asking is a Settings action
 * (`requestLocationPermission`, surfaced from a row the user taps), not
 * something a background sweep does on its own.
 *
 * **Demo mode reads nothing**, for the reason `searchContacts` doesn't: a
 * location fix is the one piece of real-world data this function could hand
 * back, and a demo session must never read where the phone actually is, let
 * alone act on it.
 *
 * Low accuracy is enough for a weather lookup — Open-Meteo's own grid is
 * coarser than GPS precision — and it's the faster, lower-power fix.
 */
export async function getCurrentLocation(): Promise<DeviceLocation | null> {
  if (Platform.OS !== 'ios') return null;
  if (isDemoModeActive()) return null;
  try {
    const permission = await location().getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await location().getCurrentPositionAsync({
      accuracy: location().Accuracy.Low,
    });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}
