import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type AlarmAuthorizationState = 'authorized' | 'denied' | 'notDetermined';

interface TodoAlarmKitNativeModule {
  isAvailable(): boolean;
  requestAuthorization(): Promise<AlarmAuthorizationState>;
  scheduleAlarm(id: string, epochSeconds: number, title: string, missionJson: string | null): Promise<boolean>;
  scheduleWeeklyAlarm?(id: string, hour: number, minute: number, weekdays: number[], title: string, missionJson: string | null): Promise<boolean>;
  pendingMissions?(): Promise<string>;
  deferMission?(missionJson: string, seconds: number): Promise<boolean>;
  completeMission?(key: string): Promise<boolean>;
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
 * What an alarm's mission is, for the native side: the opaque key the app
 * tracks it under (`task:<id>`, `alarm:<id>`), what to do, and what the
 * re-armed ring shows. See src/utils/missions.ts and MissionAlarm.swift.
 */
export interface NativeMission {
  key: string;
  kind: string;
  count: number;
  title: string;
  buttonLabel: string;
}

/** A mission whose alarm has been stopped and that is still owed. `since` is ms since the epoch. */
export interface PendingNativeMission extends NativeMission {
  since: number;
}

/**
 * `mission` gives the alarm its mission button, and makes Stop bring it back
 * until `completeNativeMission`. Null for an ordinary alarm.
 */
export function scheduleNativeAlarm(id: string, date: Date, title: string, mission: NativeMission | null = null): Promise<boolean> {
  return degradeOnThrow<Promise<boolean>>(
    () => nativeModule!.scheduleAlarm(id, date.getTime() / 1000, title, mission ? JSON.stringify(mission) : null),
    Promise.resolve(false)
  );
}

/** A repeating alarm on the weekdays given (0 = Sunday), at a clock time. False on a build without it. */
export function scheduleWeeklyNativeAlarm(
  id: string,
  hour: number,
  minute: number,
  weekdays: number[],
  title: string,
  mission: NativeMission | null = null,
): Promise<boolean> {
  const schedule = nativeModule?.scheduleWeeklyAlarm;
  if (typeof schedule !== 'function') return Promise.resolve(false);
  return degradeOnThrow<Promise<boolean>>(
    () => schedule.call(nativeModule, id, hour, minute, weekdays, title, mission ? JSON.stringify(mission) : null),
    Promise.resolve(false)
  );
}

/** The missions whose alarm has been stopped and that are still owed. Reading clears nothing. */
export async function pendingNativeMissions(): Promise<PendingNativeMission[]> {
  const read = nativeModule?.pendingMissions;
  if (!nativeModule || typeof read !== 'function') return [];
  try {
    const parsed: unknown = JSON.parse(await read.call(nativeModule));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is PendingNativeMission =>
      typeof m === 'object' && m !== null
      && typeof m.key === 'string' && typeof m.kind === 'string' && typeof m.count === 'number'
      && typeof m.title === 'string' && typeof m.buttonLabel === 'string' && typeof m.since === 'number');
  } catch {
    return [];
  }
}

/** Marks the mission pending and puts its next ring `seconds` from now, replacing any waiting one. */
export async function deferNativeMission(mission: NativeMission, seconds: number): Promise<boolean> {
  const defer = nativeModule?.deferMission;
  if (!nativeModule || typeof defer !== 'function') return false;
  try {
    return (await defer.call(nativeModule, JSON.stringify(mission), seconds)) === true;
  } catch {
    return false;
  }
}

/** The mission is done or given up: its waiting ring is cancelled and it is no longer pending. */
export async function completeNativeMission(key: string): Promise<boolean> {
  const complete = nativeModule?.completeMission;
  if (!nativeModule || typeof complete !== 'function') return false;
  try {
    return (await complete.call(nativeModule, key)) === true;
  } catch {
    return false;
  }
}

export function cancelNativeAlarm(id: string): Promise<boolean> {
  return degradeOnThrow<Promise<boolean>>(
    () => nativeModule!.cancelAlarm(id),
    Promise.resolve(false)
  );
}
