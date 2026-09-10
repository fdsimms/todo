import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';
import { healthBridge } from './healthBridge';

/**
 * Writing a logged meal to Apple Health, and retracting it again.
 *
 * The third sibling of `healthCompletionSync.ts` and `healthWeightSync.ts`,
 * deliberately shaped like both: the same guards in the same order, demo mode
 * refused first, for the reasons those files set out at length. It is its own
 * file rather than a function in either because those are about what a
 * *completion* and a *typed weight* write, and a meal is a third event with a
 * third trigger.
 *
 * **This is the first thing in the app that can un-write.** Water and body mass
 * are one-shot: Health is the record, and correcting either happens in the
 * Health app. A food log cannot work that way. An entry is logged in a hurry
 * against a picker, and a mistyped one that could not be retracted would be a
 * permanent false fact in a medical record, which is the exact failure
 * `docs/arch/health-data.md` says a write costs more than a read for. So the
 * write hands back the identifiers of what it saved, they live on
 * `FoodLogEntry.healthSampleIds`, and deleting the entry retracts them.
 *
 * **Absent stays absent, and that rule is load-bearing here more than
 * anywhere.** A nutrient the entry does not state is not written. Writing a
 * zero would be this app putting into somebody's medical record a claim that a
 * meal contained none of something nobody measured — the same "an absent
 * figure never becomes zero" rule the whole nutrition tree is built on
 * (`FoodNutrition.amounts`), with the stakes at their highest. A figure that is
 * *present* and zero is written, because a label stating no fat is a real
 * statement.
 *
 * **Nothing backfills.** There is no sweep, no reconciler and no migration that
 * writes entries logged before this shipped. The doc's "one trigger" rule is
 * why: a pass that wrote history would put samples in a medical record for
 * meals nobody asked to share, and would duplicate whatever the person had
 * already logged in another app. An entry with an empty `healthSampleIds`
 * either predates this or was logged with the switch off, and both stay that
 * way.
 */

/**
 * What came of trying to write a meal.
 *
 * Richer than the water write's boolean and shaped like `WeightWriteResult`,
 * for the same reason: a meal is logged by a person who is standing there, so
 * "nothing happened" is not an acceptable answer. `sampleIds` is empty for
 * every outcome but `written`.
 */
export interface FoodWriteResult {
  outcome:
    /** The samples were saved. */
    | 'written'
    /** `healthWriteEnabled` is off, so nothing was attempted. */
    | 'off'
    /** No native half: not iOS, no Health on this device, or demo mode. */
    | 'unavailable'
    /** The entry states no figure anything could write. */
    | 'nothingToWrite'
    /** HealthKit refused the save, which in practice means sharing is not allowed. */
    | 'refused';
  /** What was saved, for `FoodLogEntry.healthSampleIds`. Empty unless `written`. */
  sampleIds: string[];
}

/**
 * The figures from `nutrition` that may be written, dropping the rest.
 *
 * Pure and exported for its own tests, because it is where the absent-is-not-
 * zero rule is actually enforced and the rest of this file is a native call
 * nothing can test. Three things are dropped and each for its own reason:
 *
 * - **A key the entry does not state**, which is the rule above: unknown is not
 *   zero, and Health has no way to record "unknown" other than by the sample's
 *   absence.
 * - **A non-finite or negative figure**, which is a broken row rather than a
 *   small one. There is no meal containing minus four grams of fat.
 * - **Nothing else.** A stated zero passes through, and so does a figure this
 *   app thinks is implausibly large: `nutritionParse.ts` already refuses the
 *   arithmetically impossible at the point figures enter, and a second opinion
 *   here would be this module deciding which real meals are too unusual to
 *   record.
 *
 * The amounts are passed in the units `NutrientKey`'s own name states, with no
 * conversion, because `nutritionParse.ts` did that once already and a second
 * conversion in a second language is how a sodium figure lands a thousand times
 * too high.
 */
export function writableFoodAmounts(nutrition: FoodNutrition): Partial<Record<NutrientKey, number>> {
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = nutrition.amounts[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    amounts[key] = value;
  }
  return amounts;
}

/**
 * Writes `entry` to Health, or says why it didn't.
 *
 * Called from exactly one place — `addEntry` in `useFoodLogStore`, at the
 * moment an entry is created — and from nowhere else, the same single-trigger
 * rule the water write keeps. A caller that looped this into a save or a
 * reconciler would write meals nobody ate.
 *
 * The sample is dated `atISO` rather than now, and that is deliberate in the
 * same way the weight write's date is: `FoodLogEntry.atISO` is the moment the
 * food was eaten, which a backdated entry puts in the past. Its `dayKey` is
 * this app's own logical day and is deliberately *not* used here — HealthKit
 * buckets by wall clock, and the two are allowed to disagree. See the note on
 * `FoodLogEntry.atISO`.
 */
export async function logFoodEntryToHealth(entry: FoodLogEntry): Promise<FoodWriteResult> {
  // Same guard every device write in this app makes, and checked here as well
  // as inside `healthBridge()` for the reason `healthWeightSync.ts` restates:
  // a write leak puts a real sample in a real Health record, sourced from a
  // session that was fiction, and it outlives the demo until somebody notices.
  if (isDemoModeActive()) return { outcome: 'unavailable', sampleIds: [] };

  const { healthWriteEnabled } = useSettingsStore.getState();
  if (!healthWriteEnabled) return { outcome: 'off', sampleIds: [] };

  const amounts = writableFoodAmounts(entry.nutrition);
  if (Object.keys(amounts).length === 0) return { outcome: 'nothingToWrite', sampleIds: [] };

  const bridge = healthBridge();
  if (!bridge) return { outcome: 'unavailable', sampleIds: [] };

  const sampleIds = await bridge.writeFoodSamples(entry.label, entry.atISO, amounts);
  return sampleIds.length > 0
    ? { outcome: 'written', sampleIds }
    : { outcome: 'refused', sampleIds: [] };
}

/**
 * Retracts samples a logged meal wrote.
 *
 * **Deliberately not gated on `healthWriteEnabled`.** Every other guard here
 * refuses to *create* something; this one removes something already created,
 * and somebody who has since turned the switch off has if anything asked more
 * clearly for their samples to go. Refusing to retract because writing is now
 * off would strand exactly the record the switch was turned off over.
 *
 * Demo mode is still refused, and for the ordinary reason rather than a
 * symmetric one: in demo mode the ids belong to seeded fiction, and the bridge
 * would be answering about a database that is about to be discarded.
 *
 * Answers true when there was nothing to do, which is most calls: an entry that
 * never wrote anything has no ids, and one whose samples the person already
 * deleted in the Health app is not a failure to report.
 */
export async function retractFoodEntryFromHealth(sampleIds: readonly string[]): Promise<boolean> {
  if (isDemoModeActive()) return false;
  if (sampleIds.length === 0) return true;

  const bridge = healthBridge();
  if (!bridge) return false;

  return bridge.deleteHealthSamples(sampleIds);
}
