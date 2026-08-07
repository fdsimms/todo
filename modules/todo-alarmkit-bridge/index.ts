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

export function isAlarmKitAvailable(): boolean {
  return nativeModule?.isAvailable() ?? false;
}

export function requestAlarmAuthorization(): Promise<AlarmAuthorizationState> {
  if (!nativeModule) return Promise.resolve('denied');
  return nativeModule.requestAuthorization();
}

export function scheduleNativeAlarm(id: string, date: Date, title: string): Promise<boolean> {
  if (!nativeModule) return Promise.resolve(false);
  return nativeModule.scheduleAlarm(id, date.getTime() / 1000, title);
}

export function cancelNativeAlarm(id: string): Promise<boolean> {
  if (!nativeModule) return Promise.resolve(false);
  return nativeModule.cancelAlarm(id);
}
