import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * Apple Health: a small handful of numbers read, and — for exactly one type —
 * a number written.
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
 * - **Write authorization is the mirror case, and genuinely observable.** The
 *   same Apple doc that obscures reads says so explicitly: `authorizationStatus`
 *   "checks the authorization status for saving data to the HealthKit store"
 *   and answers truthfully — `.notDetermined` / `.sharingDenied` /
 *   `.sharingAuthorized` are three different, real answers, not one obscured
 *   one. `healthWriteAuthorizationStatus` is a plain synchronous read of that,
 *   unlike anything on the read side, and `HealthSettings` can and does show a
 *   real Allowed/Not allowed/Not asked row for it — see
 *   `docs/arch/health-data.md` for why that would be dishonest for reads and
 *   isn't for this.
 * - **Read and write ask separately, on purpose.** One `requestAuthorization`
 *   call could ask for both a read type and a share type in the same sheet,
 *   but folding water's write ask into the existing read flow would mean
 *   somebody who only ever wanted to read steps gets asked about writing
 *   water too, the first time they tap "Turn on" for reading. Two asks, two
 *   switches (`healthReadEnabled` / `healthWriteEnabled`), same as the
 *   generator's own two-switch rule one level up.
 * - **There is exactly one write type, and it stays that way until something
 *   needs another.** `writeTypes` in the Swift module is deliberately not
 *   `readTypes`'s shape generalized — a new share type is a new consequence
 *   (a real sample lands in somebody's Health record), not a new column in a
 *   read tuple, so it earns its own review each time rather than riding in
 *   with whatever's being read.
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
 * The real write-authorization state for dietary water — unlike
 * `HealthRequestStatus`, this one is allowed to say what actually happened.
 * `unavailable` covers "this build/device can't", same meaning it has for
 * every other status here.
 */
export type HealthWriteStatus = 'unavailable' | 'notDetermined' | 'sharingDenied' | 'sharingAuthorized';

/**
 * One logical day's readings, as the daily read hands them back.
 *
 * `start` is the instant the day began, not a day key: which day that *is*
 * depends on `dayResetTime`, which lives in the settings store, so the key is
 * derived on the app side by the same `getLogicalDayKey` every other reader
 * uses. One implementation of "which day is this", and it is the one that has
 * the setting.
 *
 * Every number is independently nullable, and null is never zero — see the
 * module note above.
 */
export interface HealthDayReading {
  start: string;
  steps: number | null;
  sleepMinutes: number | null;
  /** Milligrams of dietary sodium logged for the day, or null. Not read from
   * this app's own writes — nothing here writes to Health — but from whatever
   * food-logging app the person already uses; see the module note above. */
  sodiumMg: number | null;
  /** Grams of dietary protein logged for the day, or null. Same source as `sodiumMg`. */
  proteinG: number | null;
  /** Grams of dietary saturated fat logged for the day, or null. Same source as `sodiumMg`. */
  satFatG: number | null;
  /** Grams of dietary fiber logged for the day, or null. Same source as `sodiumMg`. */
  fiberG: number | null;
  /** Grams of dietary sugar logged for the day, or null. Same source as `sodiumMg`. */
  sugarG: number | null;
  /** Milligrams of dietary caffeine logged for the day, or null. Same source as `sodiumMg`. */
  caffeineMg: number | null;
  /** Millilitres of dietary water logged for the day, or null. Same source as `sodiumMg`. */
  waterMl: number | null;
  /** Kilocalories of dietary energy logged for the day, or null. Same source as `sodiumMg`. */
  calorieKcal: number | null;
}

interface TodoHealthNativeModule {
  isAvailable(): boolean;
  authorizationRequestStatus(): Promise<HealthRequestStatus>;
  requestAuthorization(): Promise<HealthAuthorizationResult>;
  readDailyHealth(anchorISO: string, days: number): Promise<string>;
  writeAuthorizationStatus(): HealthWriteStatus;
  requestWriteAuthorization(): Promise<HealthAuthorizationResult>;
  writeWaterSample(milliliters: number): Promise<boolean>;
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
 * The real, current write-authorization state for dietary water. Synchronous,
 * because `HKHealthStore.authorizationStatus(for:)` is — there is no sheet to
 * wait on here, only a fact to read. Call it again right after
 * `requestHealthWriteAuthorization` resolves to find out what was actually
 * chosen, which the read side can never do for itself.
 */
export function healthWriteAuthorizationStatus(): HealthWriteStatus {
  return degradeOnThrow(() => nativeModule!.writeAuthorizationStatus(), 'unavailable');
}

/**
 * Present the Health share sheet for dietary water. Resolving `requested`
 * says the sheet was shown, nothing about what was chosen — same shape as
 * `requestHealthAuthorization` — but unlike that one, the truth is available
 * right afterward: call `healthWriteAuthorizationStatus()` rather than
 * inferring anything from this call's own result.
 */
export function requestHealthWriteAuthorization(): Promise<HealthAuthorizationResult> {
  return degradeOnReject(() => nativeModule!.requestWriteAuthorization(), 'unavailable');
}

/**
 * Writes one dietary-water sample dated now, for `milliliters` — the write
 * half of this bridge, and currently the only one. Resolves `false` for every
 * reason there's nothing to report success for (no native half, not
 * authorized, a non-positive amount, the save itself failing); the caller
 * (`healthCompletionSync.ts`) treats all of them alike, since none of them
 * are worth surfacing as an error to someone who just finished a task.
 */
export function writeWaterSample(milliliters: number): Promise<boolean> {
  return degradeOnReject(() => nativeModule!.writeWaterSample(milliliters), false);
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
 * Steps, sleep, and eight nutrients (sodium, protein, saturated fat, fiber,
 * sugar, caffeine, water, calories) for each of `days` logical days starting
 * at `anchorISO`.
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
      const {
        start, steps, sleepMinutes, sodiumMg, proteinG, satFatG, fiberG, sugarG, caffeineMg, waterMl, calorieKcal,
      } = entry as Record<string, unknown>;
      // A row with no instant cannot be filed under a day, so it is dropped
      // rather than guessed at — the same refusal the native side makes when
      // it cannot work out which bucket a sample belongs in.
      if (typeof start !== 'string' || start === '') continue;
      out.push({
        start,
        steps: countOrNull(steps),
        sleepMinutes: countOrNull(sleepMinutes),
        sodiumMg: countOrNull(sodiumMg),
        proteinG: countOrNull(proteinG),
        satFatG: countOrNull(satFatG),
        fiberG: countOrNull(fiberG),
        sugarG: countOrNull(sugarG),
        caffeineMg: countOrNull(caffeineMg),
        waterMl: countOrNull(waterMl),
        calorieKcal: countOrNull(calorieKcal),
      });
    }
    return out;
  } catch {
    return [];
  }
}
