/**
 * The writes that record something rather than plan it: a recipe saved from a
 * conversation, and the three health logs (food, mood, medication).
 *
 * Each goes through the app's own builder for its row, so an entry an agent
 * logs is the same shape, with the same refusals, as one typed on the phone
 * (see the replica's `createRecipe`, `logFood`, `logMood`, `logMedication`).
 * What this file adds is the projection back, and one rule the food log
 * imposes on every estimate, which is the reason `log_food` previews:
 *
 * **The model proposes and a person confirms** (`src/utils/nutritionEstimate.ts`).
 * An agent's figures for a burrito are an estimate, and the app does not store
 * an estimate nobody looked at. So `log_food` without `apply: true` shows the
 * figures as the app read them; the person sees them, then it is written. The
 * entry carries `source: 'estimated'` for good, and is never sent to Apple
 * Health, because only the device a meal was logged on writes it there.
 */
import { NUTRIENT_KEYS, type MealSlot, type NutrientKey } from '../../src/types';
import type { RecipePatch, Replica } from './replica';
import { getRecipe, type RecipeDetail } from './kitchenTools';
// Pure over its arguments (types, the target ranges and the unit maths), so
// safe to import for its value here; the replica loads the same module for the
// write.
import { describeWater, waterToMl, type WaterUnit } from '../../src/utils/waterLog';

/** A bare date as noon that day (the app's anchor for a backdated entry), else the instant given; now when absent. */
export function atFrom(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const at = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]), 12) : new Date(value);
  if (Number.isNaN(at.getTime())) throw new Error(`"${value}" is not a date or time. Use YYYY-MM-DD or an ISO date-time.`);
  return at;
}

export const NUTRIENT_KEY_LIST = NUTRIENT_KEYS as readonly NutrientKey[];

// ---------------------------------------------------------------------------
// save_recipe
// ---------------------------------------------------------------------------

export interface SaveRecipeInput {
  name: string;
  cookbook?: string | null;
  ingredients?: { text: string; section?: string | null; alternativeGroup?: string | null }[];
  steps?: { text: string; section?: string | null }[];
  servings?: number | null;
  estimatedMinutes?: number | null;
  mealType?: string | null;
  tags?: string[];
  sourceUrl?: string | null;
  notes?: string;
}

export function saveRecipe(replica: Replica, input: SaveRecipeInput): RecipeDetail & { ingredientsRead: number; ingredientsGiven: number } {
  const recipe = replica.createRecipe(input);
  const detail = getRecipe(replica, recipe.id)!;
  return {
    ...detail,
    // So a line the app could not read as an ingredient is visible rather than
    // silently missing from the recipe.
    ingredientsGiven: input.ingredients?.length ?? 0,
    ingredientsRead: recipe.ingredients.length,
  };
}

// ---------------------------------------------------------------------------
// log_food
// ---------------------------------------------------------------------------

export interface LogFoodInput {
  label: string;
  quantity?: string;
  amounts: Record<string, number>;
  slot?: MealSlot | null;
  at?: string;
  apply?: boolean;
}

export interface LogFoodResult {
  applied: boolean;
  label: string;
  quantity?: string;
  day?: string;
  slot?: string;
  /** The figures as the app read them. A nutrient not given is absent, not zero. */
  amounts: Partial<Record<NutrientKey, number>>;
  /** Keys that were given but are not nutrients the app records. */
  ignored?: string[];
  id?: string;
  note: string;
}

export function logFood(replica: Replica, input: LogFoodInput): LogFoodResult {
  const at = atFrom(input.at);
  const read = replica.lib().nutritionEstimate.readNutritionEstimate({
    label: input.label, quantity: input.quantity ?? '', amounts: input.amounts, basis: 'typical', confidence: 'medium',
  });
  if (!read) throw new Error(`A food entry needs a name and at least one amount, keyed by ${NUTRIENT_KEY_LIST.join(', ')}.`);
  // Water is one entry a day, stepped (waterLog.ts), and an entry stating only
  // waterMl is what the app reads as that entry (isWaterEntry). Logged here it
  // would be a second water row beside the day's, so it is sent to the tool
  // that steps the right one rather than written and left for the diary to
  // show twice.
  const stated = Object.keys(read.amounts) as NutrientKey[];
  if (stated.length === 1 && stated[0] === 'waterMl') {
    throw new Error('Water is one entry a day, stepped up a glass at a time: use log_water for it rather than log_food.');
  }
  const ignored = Object.keys(input.amounts ?? {}).filter(k => !(NUTRIENT_KEY_LIST as readonly string[]).includes(k));
  const base = {
    label: read.label,
    ...(input.quantity ? { quantity: input.quantity } : {}),
    ...(input.slot ? { slot: input.slot } : {}),
    amounts: read.amounts,
    ...(ignored.length > 0 ? { ignored } : {}),
  };
  if (!input.apply) {
    return {
      applied: false,
      ...base,
      note: 'A preview. Show the person these estimated figures; log it with apply: true once they agree. It will be marked as estimated, and it will not be sent to Apple Health.',
    };
  }
  const entry = replica.logFood({ label: input.label, quantity: input.quantity, amounts: input.amounts, slot: input.slot ?? null, at });
  return {
    applied: true,
    ...base,
    id: entry.id,
    day: entry.dayKey,
    note: 'Logged, marked as estimated. It is in the app\'s food log but not in Apple Health: only the phone a meal is logged on writes it there.',
  };
}

// ---------------------------------------------------------------------------
// log_water
// ---------------------------------------------------------------------------

export interface LogWaterInput {
  /** Millilitres drunk. Give this or flOz. */
  ml?: number;
  /** Fluid ounces drunk, converted the way the app's own stepper converts. */
  flOz?: number;
  at?: string;
}

export interface LogWaterResult {
  id: string;
  day: string;
  /** What this call added, in the person's own unit. */
  added: string;
  /** The day's water so far, every entry that states any, in the person's own unit (`waterUnit`). */
  dayTotal: string;
  dayTotalMl: number;
  note: string;
}

/**
 * A glass of water onto the day's water entry. The person's `waterUnit` is
 * display only (the row stores millilitres), so the figures come back in it
 * and the input may be given in either.
 */
export function logWater(replica: Replica, input: LogWaterInput): LogWaterResult {
  if ((input.ml === undefined) === (input.flOz === undefined)) throw new Error('Give the amount as ml or as flOz, one of the two.');
  const ml = input.ml !== undefined ? Math.round(input.ml) : waterToMl(input.flOz!, 'flOz');
  if (!Number.isFinite(ml) || ml <= 0) throw new Error('Water is logged as a positive amount.');
  const unit: WaterUnit = replica.settings().waterUnit;
  const outcome = replica.logWater({ ml, at: atFrom(input.at) });
  const notes: Record<typeof outcome.how, string> = {
    created: 'The day\'s first water, so a water entry was started for it; later glasses step the same entry up.',
    stepped: 'Added onto the day\'s water entry, as the app\'s own stepper does, rather than logged as a separate row.',
    added: 'The day\'s water entry was already written to Apple Health from the phone, which only the phone can correct, so this glass is a second entry beside it. The app sums both.',
  };
  return {
    id: outcome.entry.id,
    day: outcome.entry.dayKey,
    added: describeWater(ml, unit),
    dayTotal: describeWater(outcome.dayTotalMl, unit),
    dayTotalMl: outcome.dayTotalMl,
    note: `${notes[outcome.how]} Not sent to Apple Health: only the phone writes it there.`,
  };
}

// ---------------------------------------------------------------------------
// log_mood, log_medication
// ---------------------------------------------------------------------------

export function logMood(
  replica: Replica,
  input: { mood?: number | null; symptoms?: { name: string; severity?: number }[]; contextTags?: string[]; note?: string | null; at?: string },
) {
  const log = replica.logMood({ ...input, at: atFrom(input.at) });
  return {
    id: log.id,
    day: log.dayKey,
    ...(log.mood != null ? { mood: log.mood } : {}),
    ...(log.symptoms.length > 0 ? { symptoms: log.symptoms } : {}),
    ...(log.contextTags.length > 0 ? { contextTags: log.contextTags } : {}),
    ...(log.note ? { note: log.note } : {}),
  };
}

export function logMedication(
  replica: Replica,
  input: { name: string; amount?: number | null; unit?: string | null; asNeeded?: boolean; note?: string | null; at?: string },
) {
  const log = replica.logMedication({ ...input, at: atFrom(input.at) });
  return {
    id: log.id,
    day: log.dayKey,
    takenAt: log.takenAt,
    summary: replica.medicationSummary(log),
  };
}

// ---------------------------------------------------------------------------
// Correcting and removing an entry
// ---------------------------------------------------------------------------

export function updateFoodEntry(
  replica: Replica,
  id: string,
  patch: { label?: string; quantity?: string; amounts?: Record<string, number>; slot?: MealSlot | null },
) {
  const entry = replica.updateFoodEntry(id, patch);
  return { id: entry.id, day: entry.dayKey, label: entry.label, quantity: entry.quantity || undefined, slot: entry.slot ?? undefined };
}

export function deleteFoodEntry(replica: Replica, id: string) {
  const entry = replica.deleteFoodEntry(id);
  return { deleted: { id: entry.id, day: entry.dayKey, label: entry.label } };
}

export function updateMoodLog(
  replica: Replica,
  id: string,
  patch: { mood?: number | null; symptoms?: { name: string; severity?: number }[]; contextTags?: string[]; note?: string | null },
) {
  const log = replica.updateMoodLog(id, patch);
  return {
    id: log.id,
    day: log.dayKey,
    ...(log.mood != null ? { mood: log.mood } : {}),
    ...(log.symptoms.length > 0 ? { symptoms: log.symptoms } : {}),
    ...(log.contextTags.length > 0 ? { contextTags: log.contextTags } : {}),
    ...(log.note ? { note: log.note } : {}),
  };
}

export function deleteMoodLog(replica: Replica, id: string) {
  const log = replica.deleteMoodLog(id);
  return { deleted: { id: log.id, day: log.dayKey } };
}

export function updateMedicationLog(
  replica: Replica,
  id: string,
  patch: { name?: string; amount?: number | null; unit?: string | null; asNeeded?: boolean; note?: string | null },
) {
  const log = replica.updateMedicationLog(id, patch);
  return { id: log.id, day: log.dayKey, takenAt: log.takenAt, summary: replica.medicationSummary(log) };
}

export function deleteMedicationLog(replica: Replica, id: string) {
  const log = replica.deleteMedicationLog(id);
  return { deleted: { id: log.id, day: log.dayKey, summary: replica.medicationSummary(log) } };
}

// ---------------------------------------------------------------------------
// Correcting and deleting a recipe
// ---------------------------------------------------------------------------

export function updateRecipe(replica: Replica, id: string, patch: RecipePatch): RecipeDetail & { ingredientsRead?: number; ingredientsGiven?: number } {
  const recipe = replica.updateRecipe(id, patch);
  const detail = getRecipe(replica, recipe.id)!;
  return patch.ingredients
    ? { ...detail, ingredientsGiven: patch.ingredients.length, ingredientsRead: recipe.ingredients.length }
    : detail;
}

export function deleteRecipe(replica: Replica, id: string) {
  const { recipe, plannedMeals } = replica.deleteRecipe(id);
  return {
    deleted: { id: recipe.id, name: recipe.name },
    ...(plannedMeals > 0
      ? { note: `${plannedMeals} planned ${plannedMeals === 1 ? 'meal' : 'meals'} made from it keep their title and no longer link to a recipe.` }
      : {}),
  };
}
