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
  presentAppPicker(groupId: string): Promise<boolean>;
  selectionCount(groupId: string): ScreenTimeSelectionCount;
  clearSelection(groupId: string): boolean;
  applyShield(groupIdsJson: string): boolean;
  clearShield(): boolean;
  setShieldState(
    otherReasonWantsShield: boolean,
    reason: string,
    untilIso: string | null,
    detail: string | null,
    pendingGateDetail: string | null,
    groupsJson: string,
  ): boolean;
  setBlockSchedules(windowsJson: string): boolean;
  schedulePenaltyExpiry(untilIso: string): boolean;
  cancelPenaltyExpiry(): boolean;
  scheduleGateWindow(startIso: string, endIso: string): boolean;
  cancelGateWindow(): boolean;
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

/**
 * Resolves true when the user confirmed a choice, false on cancel. Each group
 * of apps has its own selection, keyed by the group's id; `'default'` is the
 * original single selection.
 */
export function presentAppPicker(groupId: string): Promise<boolean> {
  return degradeOnReject(() => nativeModule!.presentAppPicker(groupId), false);
}

export function screenTimeSelectionCount(groupId: string): ScreenTimeSelectionCount {
  return degradeOnThrow(() => nativeModule!.selectionCount(groupId), { applications: 0, categories: 0 });
}

export function clearScreenTimeSelection(groupId: string): boolean {
  return degradeOnThrow(() => nativeModule!.clearSelection(groupId), false);
}

/**
 * Block the union of these groups' apps. True when a shield was actually
 * written, false when none of them has anything picked.
 */
export function applyShield(groupIds: readonly string[]): boolean {
  return degradeOnThrow(() => nativeModule!.applyShield(JSON.stringify(groupIds)), false);
}

export function clearShield(): boolean {
  return degradeOnThrow(() => nativeModule!.clearShield(), false);
}

/** Why the apps are blocked, as the two extensions will read it back. */
export type ShieldReason = 'penalty' | 'focus' | 'gate' | 'key' | 'schedule' | 'none';

export interface ShieldState {
  /**
   * Whether a reason other than a penalty wants the shield up. The monitor
   * extension reads this at the end of a penalty window, which is the one
   * moment something outside the app decides whether to lift a shield. The
   * arbitration stays in `appShield.ts`; this hands the extension its answer in
   * advance, because a woken extension cannot ask.
   */
  otherReasonWantsShield: boolean;
  reason: ShieldReason;
  /** When a penalty block runs out; null when the shield is up for anything else. */
  untilIso: string | null;
  /** What earned it — a task's title — shown as-is on the shield screen. */
  detail: string | null;
  /**
   * The line to show for a gate a window has been armed for but that isn't live
   * yet, or null when no window is armed.
   *
   * It is also the monitor extension's permission to raise a shield at that
   * window's start, which is why it is written here rather than inferred: the
   * extension cannot ask whether the gate it was armed for still stands, so the
   * app says so on every reconcile and a stale window finds nothing.
   */
  pendingGateDetail: string | null;
  groups: ShieldGroupsState;
}

/**
 * Which groups of apps each kind of reason holds, for the extension to rebuild
 * the shield from when one reason ends with the app closed. The shield is the
 * union of groups, so lifting one reason must leave the rest; the extension
 * cannot ask the app which they are, so it reads them from here.
 */
export interface ShieldGroupsState {
  /** Groups held by a focus session, a gate and a key lock. */
  otherGroupIds: string[];
  penaltyGroupId: string | null;
  penaltyEndIso: string | null;
  pendingGateGroupIds: string[];
  pendingGateLiveAtIso: string | null;
}

/** One schedule as the native side watches it. Clock times, evaluated by weekday on the device. */
export interface ScreenTimeScheduleWindow {
  id: string;
  name: string;
  groupId: string;
  /** 0 = Sunday. */
  days: number[];
  startMinutes: number;
  endMinutes: number;
  pausedUntilIso: string | null;
}

/**
 * Hand the extension the schedules and arm the OS to wake it at their edges.
 * Replaces whatever was armed, so a schedule that was switched off or deleted
 * stops waking it.
 */
export function setBlockSchedules(windows: readonly ScreenTimeScheduleWindow[]): boolean {
  return degradeOnThrow(() => nativeModule!.setBlockSchedules(JSON.stringify(windows)), false);
}

/**
 * Record why the apps are blocked, for the two extensions that have to answer
 * for it while the app isn't running.
 */
export function setShieldState(state: ShieldState): boolean {
  return degradeOnThrow(
    () => nativeModule!.setShieldState(
      state.otherReasonWantsShield, state.reason, state.untilIso, state.detail,
      state.pendingGateDetail, JSON.stringify(state.groups),
    ),
    false,
  );
}

/**
 * Arm a one-shot window whose end lifts the current penalty block, so it comes
 * off on time with the app closed.
 *
 * Best-effort by design, and the false it returns is not worth branching on:
 * iOS refuses a window shorter than about a quarter of an hour, a schedule's
 * survival across a reboot is undocumented, and `intervalDidEnd` is reported
 * not to fire reliably for a non-repeating schedule. It makes expiry punctual
 * rather than guaranteed — `useAppShieldSync` reconciling on every foreground
 * is what covers the difference, and it is not removable.
 */
export function schedulePenaltyExpiry(untilIso: string): boolean {
  return degradeOnThrow(() => nativeModule!.schedulePenaltyExpiry(untilIso), false);
}

export function cancelPenaltyExpiry(): boolean {
  return degradeOnThrow(() => nativeModule!.cancelPenaltyExpiry(), false);
}

/**
 * Arm a one-shot window whose start blocks the apps for a gate that isn't due
 * yet, so it holds even if the app is never opened.
 *
 * The mirror of `schedulePenaltyExpiry`, with the same best-effort caveats, and
 * one more that belongs to this direction: a `DeviceActivitySchedule`'s bounds
 * are clock times rather than dates, so nothing further out than a day is armed
 * (`gateWindowFor` in `appGate.ts` is where that refusal lives). A gate beyond
 * that is left for a later reconcile, and there will be one.
 */
export function scheduleGateWindow(startIso: string, endIso: string): boolean {
  return degradeOnThrow(() => nativeModule!.scheduleGateWindow(startIso, endIso), false);
}

export function cancelGateWindow(): boolean {
  return degradeOnThrow(() => nativeModule!.cancelGateWindow(), false);
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
