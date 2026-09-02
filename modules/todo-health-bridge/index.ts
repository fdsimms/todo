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

/**
 * One logical day's readings, as the daily read hands them back.
 *
 * `start` is the instant the day began, not a day key: which day that *is*
 * depends on `dayResetTime`, which lives in the settings store, so the key is
 * derived on the app side by the same `getLogicalDayKey` every other reader
 * uses. One implementation of "which day is this", and it is the one that has
 * the setting.
 *
 * Both numbers are independently nullable, and null is never zero — see the
 * module note above.
 */
export interface HealthDayReading {
  start: string;
  steps: number | null;
  sleepMinutes: number | null;
}

interface TodoHealthNativeModule {
  isAvailable(): boolean;
  authorizationRequestStatus(): Promise<HealthRequestStatus>;
  requestAuthorization(): Promise<HealthAuthorizationResult>;
  readDailyHealth(anchorISO: string, days: number): Promise<string>;
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
 * A count that came back over the bridge, or null.
 *
 * Shared by both reads so the "absent is not zero" rule has one implementation:
 * a missing field, a non-number, a non-finite one and a negative one are all
 * broken answers rather than small ones, and read the same way as no answer.
 * A real 0 survives, because a day spent in bed is a genuine reading.
 */
function countOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Steps and sleep for each of `days` logical days starting at `anchorISO`.
 *
 * The window is an anchor plus a count rather than a pair of instants, because
 * a logical day is exactly one calendar day long under any reset time — so the
 * native side can walk the buckets with `Calendar` and a DST day comes out 23
 * or 25 hours. What the anchor is stays this side's business, since
 * `dayResetTime` is a setting.
 *
 * Answers `[]` for every reason there is nothing to say: no native half, an
 * unparseable anchor, a refused read, a person with no Health data. A short
 * array is normal too — a day is only present if the native side reached it.
 *
 * Nothing here is cached. The reasoning is in `docs/arch/health-data.md`: this
 * app does not keep a copy of anybody's health record, and HealthKit answers a
 * historical query fast enough that the copy would buy nothing but a backup
 * file with somebody's sleep in it.
 */
export async function readDailyHealth(
  anchorISO: string,
  days: number,
): Promise<HealthDayReading[]> {
  const json = await degradeOnReject(
    () => nativeModule!.readDailyHealth(anchorISO, days),
    '[]',
  );
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HealthDayReading[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { start, steps, sleepMinutes } = entry as Record<string, unknown>;
      // A row with no instant cannot be filed under a day, so it is dropped
      // rather than guessed at — the same refusal the native side makes when
      // it cannot work out which bucket a sample belongs in.
      if (typeof start !== 'string' || start === '') continue;
      out.push({
        start,
        steps: countOrNull(steps),
        sleepMinutes: countOrNull(sleepMinutes),
      });
    }
    return out;
  } catch {
    return [];
  }
}
