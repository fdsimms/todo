import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type AlarmAuthorizationState = 'authorized' | 'denied' | 'notDetermined';

interface TodoAlarmKitNativeModule {
  isAvailable(): boolean;
  requestAuthorization(): Promise<AlarmAuthorizationState>;
  scheduleAlarm(id: string, epochSeconds: number, title: string, pushupsTaskId: string | null): Promise<boolean>;
  drainPendingPushupOpens?(): Promise<string>;
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

/**
 * `pushupsTaskId` gives the alarm a Pushups button that opens the app to that
 * task's pushup counter (`drainPendingPushupOpens` hands the tap over). Null
 * for every alarm that isn't a pushup task's.
 */
export function scheduleNativeAlarm(id: string, date: Date, title: string, pushupsTaskId: string | null = null): Promise<boolean> {
  return degradeOnThrow<Promise<boolean>>(
    () => nativeModule!.scheduleAlarm(id, date.getTime() / 1000, title, pushupsTaskId),
    Promise.resolve(false)
  );
}

/**
 * The task ids whose alarm's Pushups button was tapped since the last drain,
 * oldest first. Reading clears them, so a caller that can't act on them yet
 * (stores still loading, demo mode) must not call this.
 */
export async function drainPendingPushupOpens(): Promise<string[]> {
  const drain = nativeModule?.drainPendingPushupOpens;
  if (!nativeModule || typeof drain !== 'function') return [];
  try {
    const json = await drain.call(nativeModule);
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function cancelNativeAlarm(id: string): Promise<boolean> {
  return degradeOnThrow<Promise<boolean>>(
    () => nativeModule!.cancelAlarm(id),
    Promise.resolve(false)
  );
}
