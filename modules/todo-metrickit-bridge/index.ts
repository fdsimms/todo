import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface TodoMetricKitNativeModule {
  isAvailable(): boolean;
  start(): boolean;
  payloads(): unknown;
}

// Same lazy resolve the Vision bridge uses: requireNativeModule throws outright
// when the module isn't linked (Android, web, Expo Go without a dev build), so
// resolving it once here lets every export below stay a plain function that
// degrades to "no reports" rather than throwing into a caller with no branch
// for it.
let nativeModule: TodoMetricKitNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoMetricKitNativeModule>('TodoMetricKit');
  } catch {
    nativeModule = null;
  }
}

function degradeOnThrow<T>(call: () => T, fallback: T): T {
  if (!nativeModule) return fallback;
  try {
    return call();
  } catch (error) {
    console.warn('[todo-metrickit-bridge] native call failed; treating MetricKit as unavailable', error);
    return fallback;
  }
}

export function isMetricKitAvailable(): boolean {
  return degradeOnThrow(() => nativeModule!.isAvailable() === true, false);
}

/** Starts listening for reports. Safe to call more than once. */
export function startMetricKit(): void {
  degradeOnThrow(() => nativeModule!.start(), false);
}

/**
 * Every report iOS has delivered that this process can see, as the JSON
 * strings MetricKit wrote. The same report can appear twice (once from the
 * past ones, once from this run's delivery), so a caller keys them by their
 * own time range. Anything that isn't a string is dropped rather than trusted.
 */
export function readMetricPayloads(): string[] {
  const raw = degradeOnThrow<unknown>(() => nativeModule!.payloads(), []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
}
