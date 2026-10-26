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

/**
 * One reading of the Face ID camera's depth: metres to the nearest part of
 * the middle of the frame (null when none of it measured), the share of the
 * middle of the frame that measured, and when, in ms since the epoch.
 */
export interface DepthReading {
  distance: number | null;
  valid: number;
  at: number;
}

interface NativeDepthReading {
  distance?: number;
  valid: number;
  at: number;
}

interface TodoProximityNativeModule {
  isAvailable(): boolean;
  isSupported(): Promise<boolean>;
  isDepthSupported?(): Promise<boolean>;
  addListener?(event: 'onProximityChange', listener: (change: ProximityChange) => void): Subscription;
  addListener?(event: 'onDepthReading', listener: (reading: NativeDepthReading) => void): Subscription;
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

/**
 * Whether this device has a Face ID camera to measure depth with. False on an
 * iPhone SE, an iPad without Face ID or a Mac, and wherever the module isn't
 * linked (including a build from before the depth reader existed). Says
 * nothing about camera permission, which the caller asks for before listening.
 */
export async function isDepthSupported(): Promise<boolean> {
  if (!nativeModule || typeof nativeModule.isDepthSupported !== 'function') return false;
  try {
    return (await nativeModule.isDepthSupported()) === true;
  } catch {
    return false;
  }
}

/**
 * Calls `listener` with each depth reading, with the front camera running
 * until the returned function is called. Nothing arrives without camera
 * permission, or if the camera fails to start, so a caller waiting on the
 * first reading needs its own timeout. Reads a distance and keeps nothing, so
 * it needs no demo-mode gate.
 */
export function addDepthListener(listener: (reading: DepthReading) => void): () => void {
  if (!nativeModule || typeof nativeModule.addListener !== 'function') return () => {};
  try {
    const subscription = nativeModule.addListener('onDepthReading', (reading: NativeDepthReading) => listener({
      distance: typeof reading.distance === 'number' ? reading.distance : null,
      valid: typeof reading.valid === 'number' ? reading.valid : 0,
      at: typeof reading.at === 'number' ? reading.at : Date.now(),
    }));
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
