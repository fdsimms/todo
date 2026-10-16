import type { FoodLogEntry, NovaGroup } from '../types';
import type { CookingWindow } from './cookingStats';
import { isNutrientOnlyEntry } from './nutrientLog';

/**
 * How much of the window's logged calories came from foods at each NOVA
 * processing group, and how much of the log that could be said about.
 *
 * **Counts against the person's own log, never a verdict.** It states a share
 * and what the share was built on, and nothing here says a number is good or
 * bad, the same posture `produceServings.ts` and `nutritionStats.ts` take.
 *
 * **Only an entry that carries a group counts toward the share.** A group comes
 * from a barcode source that stated one or from the person setting it on a food
 * (`FoodNutrition.novaGroup`), never from a name, so most of a typical log is
 * unclassified, and the share is of the classified calories alone. That makes
 * the coverage the figure that matters, so it always travels with the share:
 * a share of 60% over 5% of the log's calories says very little, and the screen
 * says that rather than printing the percentage bare. An entry that states no
 * calories cannot be weighed and is left out of both sides, as `foodLogTotals`
 * leaves an absent figure absent.
 *
 * **A snapshot, like every figure on an entry.** The group is read off the
 * helping as logged (`entry.nutrition`, falling back to the panel it kept), so
 * classifying a food later does not rewrite past entries.
 */

export interface ProcessingMix {
  /** Calories of classified entries, by group. */
  kcalByGroup: Record<NovaGroup, number>;
  /** Calories of every food entry in the window that states them. */
  kcalLogged: number;
  /** Calories of the entries that carry a group. */
  kcalClassified: number;
  /** Food entries that state calories, and how many of them carry a group. */
  entries: number;
  entriesClassified: number;
  /** Group 4's share of the classified calories, 0..1. */
  ultraProcessedShare: number;
  /** The classified calories' share of the logged calories, 0..1. */
  coverage: number;
}

/** The group an entry carries, or null. */
export function entryNovaGroup(entry: FoodLogEntry): NovaGroup | null {
  return entry.nutrition.novaGroup ?? entry.sourcePanel?.novaGroup ?? null;
}

/** Null when no classified entry in the window states calories: nothing to share. */
export function processingMix(entries: readonly FoodLogEntry[], window: CookingWindow): ProcessingMix | null {
  const kcalByGroup: Record<NovaGroup, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let kcalLogged = 0;
  let kcalClassified = 0;
  let counted = 0;
  let classified = 0;

  for (const entry of entries) {
    if (entry.dayKey < window.startKey || entry.dayKey > window.endKey) continue;
    if (isNutrientOnlyEntry(entry)) continue;
    const kcal = entry.nutrition.amounts.calorieKcal;
    if (kcal === undefined || !Number.isFinite(kcal) || kcal <= 0) continue;

    counted += 1;
    kcalLogged += kcal;
    const group = entryNovaGroup(entry);
    if (group === null) continue;
    classified += 1;
    kcalClassified += kcal;
    kcalByGroup[group] += kcal;
  }

  if (classified === 0 || kcalClassified <= 0) return null;
  return {
    kcalByGroup,
    kcalLogged,
    kcalClassified,
    entries: counted,
    entriesClassified: classified,
    ultraProcessedShare: kcalByGroup[4] / kcalClassified,
    coverage: kcalClassified / kcalLogged,
  };
}

/** The share as a whole percent, "38%". */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** "Based on 12 of 31 entries, 45% of logged calories": what the share was built on. */
export function describeProcessingCoverage(mix: ProcessingMix): string {
  const entries = `${mix.entriesClassified} of ${mix.entries} ${mix.entries === 1 ? 'entry' : 'entries'}`;
  return `Based on ${entries} with a processing group, ${formatShare(mix.coverage)} of logged calories`;
}
