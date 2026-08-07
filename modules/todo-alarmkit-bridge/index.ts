import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type AlarmAuthorizationState = 'authorized' | 'denied' | 'notDetermined';

interface TodoAlarmKitNativeModule {
  isAvailable(): boolean;
  requestAuthorization(): Promise<AlarmAuthorizationState>;
  scheduleAlarm(id: string, epochSeconds: number, title: string): Promise<boolean>;
  cancelAlarm(id: string): Promise<boolean>;
}

// requireNativeModule throws if the native module isn't linked at all
// (Android, web, Expo Go without a dev build) — resolve it lazily and once,
// so every other export can stay a plain synchronous/async function that
// degrades to "unavailable" instead of throwing.
let nativeModule: TodoAlarmKitNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoAlarmKitNativeModule>('TodoAlarmKit');
  } catch {
    nativeModule = null;
  }
}

// Resolving the module is not the same as the module working, and the
// difference is not academic: `nativeModule?.isAvailable()` guards the module
// being null but not `isAvailable` being missing off it, so a registration that
// half-succeeded throws a TypeError straight into whatever called it. That
// caller is App.tsx's launch effect, where an uncaught throw unmounts the whole
// React root — the app clears the splash and goes black. "Degrades to
// unavailable" has to mean the calls too, not just the require.
function degradeOnThrow<T>(call: () => T, fallback: T): T {
  if (!nativeModule) return fallback;
  try {
    return call();
  } catch (error) {
    console.warn('[todo-alarmkit-bridge] native call failed; treating AlarmKit as unavailable', error);
    return fallback;
  }
}

export function isAlarmKitAvailable(): boolean {
  return degradeOnThrow(() => nativeModule!.isAvailable() === true, false);
}

export function requestAlarmAuthorization(): Promise<AlarmAuthorizationState> {
  return degradeOnThrow<Promise<AlarmAuthorizationState>>(
    () => nativeModule!.requestAuthorization(),
    Promise.resolve('denied')
  );
}

export function scheduleNativeAlarm(id: string, date: Date, title: string): Promise<boolean> {
  return degradeOnThrow<Promise<boolean>>(
    () => nativeModule!.scheduleAlarm(id, date.getTime() / 1000, title),
    Promise.resolve(false)
  );
}

export function cancelNativeAlarm(id: string): Promise<boolean> {
  return degradeOnThrow<Promise<boolean>>(
    () => nativeModule!.cancelAlarm(id),
    Promise.resolve(false)
  );
}
