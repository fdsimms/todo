import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * Apple Health, as much of it as this app reads — which is one number.
 *
 * The shape of this module is dictated by one hard limit in Apple's API, and
 * it is worth knowing before adding to it:
 *
 * - **Read authorization is not observable.** `authorizationStatus(for:)` is
 *   truthful about *write* access and answers `.notDetermined` for reads
 *   whatever the truth is, so that a refusal looks exactly like an empty
 *   store. That is deliberate on Apple's part — knowing an app was refused
 *   permission to read blood glucose is itself a health disclosure. The
 *   consequence here: every read answers `number | null`, `null` means "no
 *   number" with no reason attached, and nothing in this app may render a
 *   "Health access denied" state, because it cannot know one.
 *
 * `authorizationRequestStatus` is the one thing the system will say, and it
 * says less than it looks like: `unnecessary` means asking again would show no
 * sheet, which is equally true of everything-allowed and everything-refused.
 * It answers "have you been asked yet", and that is all it is used for.
 *
 * The native module is resolved once, lazily, and every export degrades to an
 * "unavailable" answer if it isn't there — the todo-screentime-bridge shape,
 * because resolving is not the same as working: a half-registered module
 * throws a TypeError off a missing method straight into whatever called it,
 * and that caller is a launch effect where an uncaught throw unmounts the
 * React root.
 */

/**
 * Whether asking for access would put a sheet on screen.
 *
 * Deliberately not named like a permission status. `unnecessary` is not
 * "granted" — see the note above.
 */
export type HealthRequestStatus = 'unavailable' | 'shouldRequest' | 'unnecessary' | 'unknown';

/**
 * What came of presenting the sheet, and nothing about what was chosen.
 *
 * `requested` means the sheet was shown and dismissed without error. It is not
 * a grant, and there is no version of this that is one.
 */
export type HealthAuthorizationResult = 'unavailable' | 'requested' | 'failed';

interface TodoHealthNativeModule {
  isAvailable(): boolean;
  authorizationRequestStatus(): Promise<HealthRequestStatus>;
  requestAuthorization(): Promise<HealthAuthorizationResult>;
  readSteps(startISO: string, endISO: string): Promise<string>;
}

let nativeModule: TodoHealthNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoHealthNativeModule>('TodoHealthBridge');
  } catch {
    nativeModule = null;
  }
}

function degradeOnThrow<T>(call: () => T, fallback: T): T {
  if (!nativeModule) return fallback;
  try {
    return call();
  } catch (error) {
    console.warn('[todo-health-bridge] native call failed; treating Health as unavailable', error);
    return fallback;
  }
}

async function degradeOnReject<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  if (!nativeModule) return fallback;
  try {
    return await call();
  } catch (error) {
    console.warn('[todo-health-bridge] native call failed; treating Health as unavailable', error);
    return fallback;
  }
}

/** Whether this build, on this device, can do any of the rest of it. */
export function isHealthAvailable(): boolean {
  return degradeOnThrow(() => nativeModule!.isAvailable() === true, false);
}

export function healthRequestStatus(): Promise<HealthRequestStatus> {
  return degradeOnReject(() => nativeModule!.authorizationRequestStatus(), 'unavailable');
}

/**
 * Present the Health permission sheet.
 *
 * Resolving `requested` says the sheet was shown, not that anything was
 * allowed. The only way to find out whether a read works is to read.
 */
export function requestHealthAuthorization(): Promise<HealthAuthorizationResult> {
  return degradeOnReject(() => nativeModule!.requestAuthorization(), 'unavailable');
}

/**
 * Steps recorded between two instants, or null when there is no number.
 *
 * Null covers a refused read, a day with no samples, and a device that has
 * never recorded any, and it is not possible to tell them apart — so callers
 * must render "nothing to show" rather than a zero. Treating an absent reading
 * as 0 is the mistake `moodInsights` already has a rule against, and here the
 * API forces it rather than the design choosing it.
 *
 * The window is passed in rather than computed natively because the day it
 * should cover is the user's *logical* day, and `dayResetTime` lives in the
 * settings store. Parsed here so a malformed answer reads as "no number" in
 * one place.
 */
export async function readSteps(startISO: string, endISO: string): Promise<number | null> {
  const json = await degradeOnReject(
    () => nativeModule!.readSteps(startISO, endISO),
    '{"steps":null}',
  );
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const steps = (parsed as { steps?: unknown }).steps;
    // A negative or non-finite count is a broken answer rather than a small
    // one, and reads the same way as no answer at all.
    if (typeof steps !== 'number' || !Number.isFinite(steps) || steps < 0) return null;
    return steps;
  } catch {
    return null;
  }
}
