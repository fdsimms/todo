import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface Subscription {
  remove(): void;
}

/** One change of the sensor: `near` is its new state, `at` when, in ms since the epoch. */
export interface ProximityChange {
  near: boolean;
  at: number;
}

interface TodoProximityNativeModule {
  isAvailable(): boolean;
  isSupported(): Promise<boolean>;
  addListener?(event: 'onProximityChange', listener: (change: ProximityChange) => void): Subscription;
}

// Same lazy resolve the other bridges here use: requireNativeModule throws
// outright when the module isn't linked (Android, web, Expo Go), so resolving
// it once lets the exports below do nothing rather than throw.
let nativeModule: TodoProximityNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoProximityNativeModule>('TodoProximity');
  } catch {
    nativeModule = null;
  }
}

/**
 * Whether this device has a proximity sensor to count with. False on an iPad
 * or a Mac, and wherever the module isn't linked; the counter falls back to
 * counting taps there.
 */
export async function isProximitySupported(): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    if (nativeModule.isAvailable() !== true) return false;
    return (await nativeModule.isSupported()) === true;
  } catch {
    return false;
  }
}

/**
 * Calls `listener` on every change of the sensor, with monitoring on (and the
 * screen blanking when it's covered) until the returned function is called.
 * Reads no data and writes nothing outside the app, so it needs no demo-mode
 * gate.
 */
export function addProximityListener(listener: (change: ProximityChange) => void): () => void {
  if (!nativeModule || typeof nativeModule.addListener !== 'function') return () => {};
  try {
    const subscription = nativeModule.addListener('onProximityChange', change => listener(change));
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
