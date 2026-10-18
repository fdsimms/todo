import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface TodoAppRefreshNativeModule {
  isAvailable(): boolean;
  setIntervalMinutes(minutes: number): boolean;
}

// The MetricKit bridge's lazy resolve: requireNativeModule throws outright
// when the module isn't linked (Android, web, a build that predates it), so
// it is resolved once here and every export degrades to "no refreshes".
let nativeModule: TodoAppRefreshNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoAppRefreshNativeModule>('TodoAppRefresh');
  } catch {
    nativeModule = null;
  }
}

/** Whether iOS can wake this build for a short refresh at all. */
export function isAppRefreshAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Asks iOS for short background refreshes no sooner than `minutes` apart, or
 * stops asking with 0. Each one runs the app's background task (see
 * src/utils/backgroundRefresh.ts). Returns whether the build can do it.
 */
export function setAppRefreshInterval(minutes: number): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.setIntervalMinutes(minutes) === true;
  } catch (error) {
    console.warn('[todo-app-refresh] native call failed; no background refreshes', error);
    return false;
  }
}
