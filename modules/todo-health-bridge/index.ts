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
 * - **Each write type earns its own review, and there are two.** `writeTypes`
 *   in the Swift module is deliberately not `readTypes`'s shape generalized —
 *   a new share type is a new consequence (a real sample lands in somebody's
 *   Health record), not a new column in a read tuple. Dietary water was the
 *   first; body mass is the second, licensed by the same argument that let the
 *   app read the eight nutrients (the number exists only because a person
 *   recorded it) and fenced by the rule that nothing derives anything from it.
 *   Because the two are separately allowable in Health's own sheet, every
 *   write-side call here names which type it means.
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
 * The real write-authorization state for one share type — unlike
 * `HealthRequestStatus`, this one is allowed to say what actually happened.
 * `unavailable` covers "this build/device can't", same meaning it has for
 * every other status here.
 */
export type HealthWriteStatus = 'unavailable' | 'notDetermined' | 'sharingDenied' | 'sharingAuthorized';

/**
 * Which of the two things this app can write.
 *
 * Every write-side call takes one, because Health asks about share types
 * individually and somebody can allow water and refuse weight in the same
 * sheet. One status for "writing" would be wrong for whoever split them.
 */
export type HealthWriteKind = 'water' | 'weight';

/**
 * One logical day's body mass, in kilograms, or null for a day with no
 * weigh-in.
 *
 * `start` carries the same meaning it does on `HealthDayReading`: the instant
 * the day began, with the day *key* derived on the app side by the one
 * `getLogicalDayKey` that knows about `dayResetTime`.
 *
 * Null is not zero, and here that matters more than anywhere else in this
 * module: most people do not weigh themselves daily, so gaps are the normal
 * case rather than the broken one, and a reader that filled them with 0 would
 * draw a chart of somebody repeatedly weighing nothing.
 */
export interface HealthWeightDay {
  start: string;
  kilograms: number | null;
}

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
  readWeightSeries(anchorISO: string, days: number): Promise<string>;
  writeAuthorizationStatus(kind: HealthWriteKind): HealthWriteStatus;
  requestWriteAuthorization(): Promise<HealthAuthorizationResult>;
  writeWaterSample(milliliters: number): Promise<boolean>;
  writeBodyMassSample(kilograms: number, whenISO: string): Promise<boolean>;
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
 * The real, current write-authorization state for one share type. Synchronous,
 * because `HKHealthStore.authorizationStatus(for:)` is — there is no sheet to
 * wait on here, only a fact to read. Call it again right after
 * `requestHealthWriteAuthorization` resolves to find out what was actually
 * chosen, which the read side can never do for itself.
 *
 * Takes a `kind` because the two share types are allowed and refused
 * independently: somebody can say yes to water and no to weight on the one
 * sheet, and a single answer for "writing" would misreport whichever they
 * refused.
 */
export function healthWriteAuthorizationStatus(kind: HealthWriteKind): HealthWriteStatus {
  return degradeOnThrow(() => nativeModule!.writeAuthorizationStatus(kind), 'unavailable');
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
 * Writes one dietary-water sample dated now, for `milliliters` — the first of
 * this bridge's two writes. Resolves `false` for every reason there's nothing
 * to report success for (no native half, not authorized, a non-positive
 * amount, the save itself failing); the caller (`healthCompletionSync.ts`)
 * treats all of them alike, since none of them are worth surfacing as an error
 * to someone who just finished a task.
 */
export function writeWaterSample(milliliters: number): Promise<boolean> {
  return degradeOnReject(() => nativeModule!.writeWaterSample(milliliters), false);
}

/**
 * Writes one body-mass sample of `kilograms`, dated `whenISO`.
 *
 * Carries its own date, where the water write stamps the moment it runs: water
 * is logged by completing a task, so the logging and the drinking are the same
 * event, while a weight is typed in and may well be this morning's figure
 * entered tonight.
 *
 * Kilograms because HealthKit stores a mass and the app has to pick a unit to
 * hand it; what the user *typed* may have been pounds, and converting is the
 * caller's job (`weightLog.ts`) so there is one conversion in the app rather
 * than one per call site.
 *
 * Resolves `false` for the same spread of reasons the water write does, plus a
 * value outside any plausible body mass — unlike a mistyped glass of water, a
 * mistyped weight would sit in the person's Health record as a permanent
 * outlier and skew every chart drawn from it, so the caller is expected to
 * surface this one rather than swallow it.
 */
export function writeBodyMassSample(kilograms: number, whenISO: string): Promise<boolean> {
  return degradeOnReject(() => nativeModule!.writeBodyMassSample(kilograms, whenISO), false);
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

/**
 * Body mass for each of `days` logical days starting at `anchorISO`, in
 * kilograms, with null for every day that has no weigh-in.
 *
 * Same window shape and the same "nothing is cached" rule as `readDailyHealth`,
 * and a separate native call for the reasons that function's Swift counterpart
 * sets out: the daily read is cumulative, integer-rounded, and runs on every
 * foreground, and body mass is none of those things.
 *
 * The wire carries whole grams as an integer, which this converts back. That
 * is not an implementation detail worth hiding: a weight is the first
 * fractional number to cross this bridge, and hand-built JSON with a `Double`
 * in it is one comma-decimal locale away from a parse failure. Whole grams are
 * finer than any scale reports, so the integer format every other reading uses
 * survives intact.
 */
export async function readWeightSeries(
  anchorISO: string,
  days: number,
): Promise<HealthWeightDay[]> {
  const json = await degradeOnReject(
    () => nativeModule!.readWeightSeries(anchorISO, days),
    '[]',
  );
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HealthWeightDay[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { start, grams } = entry as Record<string, unknown>;
      if (typeof start !== 'string' || start === '') continue;
      // Deliberately not `countOrNull`, which keeps a real 0 because a day of
      // no steps is a reading. Nobody weighs zero: a 0 here is a broken answer,
      // so it reads as "no weigh-in" rather than as a measurement.
      const kilograms =
        typeof grams === 'number' && Number.isFinite(grams) && grams > 0 ? grams / 1000 : null;
      out.push({ start, kilograms });
    }
    return out;
  } catch {
    return [];
  }
}
