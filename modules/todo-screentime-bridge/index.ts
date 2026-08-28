import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * iOS Screen Time, as much of it as an app is allowed to see.
 *
 * The shape of this module is dictated by two hard limits in Apple's APIs,
 * both worth knowing before adding to it:
 *
 * - **Usage cannot be read.** Numbers are only available inside a
 *   `DeviceActivityReport` extension, which is sandboxed with no route back to
 *   the host app. What you get instead is `startMonitoring`, which fires a
 *   callback when a duration is crossed. There is no "minutes used today".
 * - **Apps cannot be named.** A picked app is an opaque `ApplicationToken`
 *   only SwiftUI can render, so `selectionCount` returns counts and
 *   `presentAppPicker` shows a native sheet. Nothing here can hand React a
 *   list of app names to draw.
 *
 * The native module is resolved once, lazily, and every export degrades to an
 * "unavailable" answer if it isn't there — the todo-alarmkit-bridge shape
 * rather than the widget bridge's module-scope `requireNativeModule`, because
 * resolving is not the same as working: a half-registered module throws a
 * TypeError off a missing method straight into whatever called it, and that
 * caller is a launch effect where an uncaught throw unmounts the React root.
 */

export type ScreenTimeAuthorization = 'unavailable' | 'notDetermined' | 'denied' | 'approved';

export interface ScreenTimeSelectionCount {
  applications: number;
  categories: number;
}

/** One `{ id, thresholdMinutes }` rule, as the native side decodes it. */
export interface ScreenTimeMonitorRule {
  id: string;
  thresholdMinutes: number;
}

/** A threshold that fired: which rule, and the logical day it fired on. */
export interface ScreenTimeCrossing {
  ruleId: string;
  dayKey: string;
}

interface TodoScreenTimeNativeModule {
  isAvailable(): boolean;
  authorizationStatus(): ScreenTimeAuthorization;
  requestAuthorization(): Promise<ScreenTimeAuthorization>;
  presentAppPicker(): Promise<boolean>;
  selectionCount(): ScreenTimeSelectionCount;
  clearSelection(): boolean;
  applyShield(): boolean;
  clearShield(): boolean;
  startMonitoring(rulesJson: string, dayKey: string): Promise<boolean>;
  stopMonitoring(): boolean;
  drainCrossings(): Promise<string>;
}

let nativeModule: TodoScreenTimeNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoScreenTimeNativeModule>('TodoScreenTimeBridge');
  } catch {
    nativeModule = null;
  }
}

function degradeOnThrow<T>(call: () => T, fallback: T): T {
  if (!nativeModule) return fallback;
  try {
    return call();
  } catch (error) {
    console.warn('[todo-screentime-bridge] native call failed; treating Screen Time as unavailable', error);
    return fallback;
  }
}

async function degradeOnReject<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  if (!nativeModule) return fallback;
  try {
    return await call();
  } catch (error) {
    console.warn('[todo-screentime-bridge] native call failed; treating Screen Time as unavailable', error);
    return fallback;
  }
}

/** Whether this build, on this device, can do any of the rest of it. */
export function isScreenTimeAvailable(): boolean {
  return degradeOnThrow(() => nativeModule!.isAvailable() === true, false);
}

export function screenTimeAuthorizationStatus(): ScreenTimeAuthorization {
  return degradeOnThrow(() => nativeModule!.authorizationStatus(), 'unavailable');
}

export function requestScreenTimeAuthorization(): Promise<ScreenTimeAuthorization> {
  return degradeOnReject(() => nativeModule!.requestAuthorization(), 'unavailable');
}

/** Resolves true when the user confirmed a choice, false on cancel. */
export function presentAppPicker(): Promise<boolean> {
  return degradeOnReject(() => nativeModule!.presentAppPicker(), false);
}

export function screenTimeSelectionCount(): ScreenTimeSelectionCount {
  return degradeOnThrow(() => nativeModule!.selectionCount(), { applications: 0, categories: 0 });
}

export function clearScreenTimeSelection(): boolean {
  return degradeOnThrow(() => nativeModule!.clearSelection(), false);
}

/** True when a shield was actually written, false when nothing is picked. */
export function applyShield(): boolean {
  return degradeOnThrow(() => nativeModule!.applyShield(), false);
}

export function clearShield(): boolean {
  return degradeOnThrow(() => nativeModule!.clearShield(), false);
}

export function startMonitoring(rules: readonly ScreenTimeMonitorRule[], dayKey: string): Promise<boolean> {
  return degradeOnReject(() => nativeModule!.startMonitoring(JSON.stringify(rules), dayKey), false);
}

export function stopMonitoring(): boolean {
  return degradeOnThrow(() => nativeModule!.stopMonitoring(), false);
}

/**
 * Read and clear the thresholds crossed since the last drain.
 *
 * Parsed here rather than in the caller so a malformed file reads as "nothing
 * crossed" in one place. Read-and-clear, so the caller must be sure it wants
 * them: see `screenTimeBridge.ts`, which refuses in demo mode for exactly the
 * reason the widget bridge does.
 */
export async function drainCrossings(): Promise<ScreenTimeCrossing[]> {
  const json = await degradeOnReject(() => nativeModule!.drainCrossings(), '[]');
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ScreenTimeCrossing =>
        typeof c === 'object' && c !== null &&
        typeof (c as ScreenTimeCrossing).ruleId === 'string' &&
        typeof (c as ScreenTimeCrossing).dayKey === 'string',
    );
  } catch {
    return [];
  }
}
