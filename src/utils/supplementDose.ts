import type { FoodLogEntry, FoodNutrition, MedicationLog, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { formatDose } from './medicationLog';
import { NUTRIENT_LABEL } from './foodNutrition';
import type { SupplementPanel } from './medicationSettings';
import { PANEL_UNITS } from './medicationSettings';
import { readPanelNumber } from './nutritionPanelForm';

/**
 * A supplement dose adding its nutrients to the day.
 *
 * **A dose writes one food log entry, and the entry is the whole mechanism.**
 * The day's totals, targets, Stats and the Apple Health write all read food log
 * entries already, so a multivitamin taken once adds its vitamins and minerals
 * everywhere a meal's would, with no second ledger to keep in step. What this
 * file owns is the translation: which entry a dose is, how big it is, and how
 * to find it again when the dose is edited or deleted.
 *
 * **The link is `FoodNutrition.sourceId`** (`dose:<medication log id>`), the
 * field that already means "the id of where these figures came from". It rides
 * inside the nutrition blob, so sync, backups and the MCP replica carry it with
 * no column of its own. Resolve-or-shrug like every other pointer in the food
 * log: an entry whose dose is gone is an entry, and a dose whose entry was
 * deleted by hand is just a dose.
 *
 * **It is not a meal and not a food**, which is `isNutrientOnlyEntry`'s
 * meaning (`nutrientLog.ts`): unslotted, never counted toward a day being
 * complete, never vetoing another nutrient's coverage, never offered again in
 * recents. A multivitamin states vitamins and minerals; a day of it must not
 * read as a day that was eaten.
 *
 * **A dose's size scales the panel by the rule the supply uses**: a dose
 * recorded in the panel's unit counts that many servings of it, and any other
 * dose (no amount, or a different unit) counts one. The edit screen says so
 * beside the field.
 */

/** Prefix of the `sourceId` that ties an entry to the dose that wrote it. */
export const DOSE_SOURCE_PREFIX = 'dose:';

/** The `sourceId` for a dose's entry. */
export function doseSourceId(logId: string): string {
  return `${DOSE_SOURCE_PREFIX}${logId}`;
}

/** The dose an entry was written for, or null for any other entry. */
export function supplementDoseIdOf(entry: Pick<FoodLogEntry, 'nutrition'>): string | null {
  const id = entry.nutrition.sourceId;
  return typeof id === 'string' && id.startsWith(DOSE_SOURCE_PREFIX) && id.length > DOSE_SOURCE_PREFIX.length
    ? id.slice(DOSE_SOURCE_PREFIX.length)
    : null;
}

/** Whether this entry is what a supplement dose wrote. */
export function isSupplementEntry(entry: Pick<FoodLogEntry, 'nutrition'>): boolean {
  return supplementDoseIdOf(entry) !== null;
}

/**
 * How many servings of the panel a dose is.
 *
 * Mirrors `supplyRemaining`'s rule so the two answer a dose the same way: in
 * the panel's own unit it is `amount / servingAmount`, and anything else (no
 * amount recorded, or another unit) is one serving. Never zero: a recorded
 * amount of zero is cleaned to no amount by the store, and a non-positive
 * result falls back to one.
 */
export function supplementServings(
  panel: SupplementPanel,
  dose: Pick<MedicationLog, 'amount' | 'unit'>,
): number {
  if (dose.amount === null || dose.unit !== panel.servingUnit) return 1;
  const servings = dose.amount / panel.servingAmount;
  return Number.isFinite(servings) && servings > 0 ? servings : 1;
}

/** Three decimals is finer than any label prints and coarse enough to hide float noise. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** What a dose writes, or null when the panel states nothing. */
export interface SupplementHelping {
  label: string;
  quantity: string;
  nutrition: FoodNutrition;
}

/**
 * The entry fields for one dose of a supplement with this panel.
 *
 * `perServing` basis with `servingText` as the dose in words, the shape every
 * entry's snapshot has ("figures are the amounts actually eaten"). The source
 * is `manual` because the person typed the panel, and `sourceId` is the link.
 */
export function supplementHelping(
  panel: SupplementPanel,
  log: Pick<MedicationLog, 'id' | 'name' | 'amount' | 'unit'>,
  now: Date = new Date(),
): SupplementHelping | null {
  const servings = supplementServings(panel, log);
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const stated = panel.amounts[key];
    if (stated !== undefined) amounts[key] = round3(stated * servings);
  }
  if (Object.keys(amounts).length === 0) return null;
  const quantity = formatDose(log) ?? '1 dose';
  return {
    label: log.name.trim(),
    quantity,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: quantity,
      amounts,
      source: 'manual',
      sourceId: doseSourceId(log.id),
      portions: [],
      recordedAt: now.toISOString(),
    },
  };
}

/** The entry a dose wrote among a day's entries, or null. */
export function entryForDose(entries: readonly FoodLogEntry[], logId: string): FoodLogEntry | null {
  return entries.find(entry => supplementDoseIdOf(entry) === logId) ?? null;
}

// ==== The panel form ====

/**
 * The text the supplement sheet holds, mirroring `PanelForm` in
 * `nutritionPanelForm.ts`: strings, because a form is, and this file is the
 * one gate where text becomes numbers, so a blank box (unknown) and a typed 0
 * (stated) stay different.
 */
export interface SupplementForm {
  servingAmount: string;
  servingUnit: string;
  amounts: Record<NutrientKey, string>;
}

export function emptySupplementForm(): SupplementForm {
  const amounts = {} as Record<NutrientKey, string>;
  for (const key of NUTRIENT_KEYS) amounts[key] = '';
  return { servingAmount: '1', servingUnit: 'tablet', amounts };
}

export function supplementFormFrom(panel: SupplementPanel | null | undefined): SupplementForm {
  const form = emptySupplementForm();
  if (!panel) return form;
  form.servingAmount = String(panel.servingAmount);
  form.servingUnit = panel.servingUnit;
  for (const key of NUTRIENT_KEYS) {
    const amount = panel.amounts[key];
    if (amount !== undefined) form.amounts[key] = String(amount);
  }
  return form;
}

/** Fields that can't be read, in order, so the sheet can mark them. */
export function invalidSupplementFields(form: SupplementForm): Array<NutrientKey | 'servingAmount'> {
  const bad: Array<NutrientKey | 'servingAmount'> = [];
  const serving = readPanelNumber(form.servingAmount);
  if (serving === 'invalid' || serving === null || serving === 0) bad.push('servingAmount');
  for (const key of NUTRIENT_KEYS) {
    if (readPanelNumber(form.amounts[key]) === 'invalid') bad.push(key);
  }
  return bad;
}

/**
 * The panel a form states, or null when it states nothing or can't be read.
 * A blank field is left out; a typed zero is kept.
 */
export function buildSupplementPanel(form: SupplementForm): SupplementPanel | null {
  if (invalidSupplementFields(form).length > 0) return null;
  const servingAmount = readPanelNumber(form.servingAmount);
  if (typeof servingAmount !== 'number' || !PANEL_UNITS.includes(form.servingUnit)) return null;
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = readPanelNumber(form.amounts[key]);
    if (typeof value === 'number') amounts[key] = value;
  }
  if (Object.keys(amounts).length === 0) return null;
  return { servingAmount, servingUnit: form.servingUnit, amounts };
}

/** Whether the form differs from the panel it opened with, for the discard guard. */
export function supplementFormDirty(form: SupplementForm, original: SupplementPanel | null | undefined): boolean {
  const base = supplementFormFrom(original);
  if (form.servingAmount.trim() !== base.servingAmount.trim() || form.servingUnit !== base.servingUnit) return true;
  return NUTRIENT_KEYS.some(key => form.amounts[key].trim() !== base.amounts[key].trim());
}

// ==== Describing a panel ====

/** How many figures a panel states. */
export function supplementFieldCount(panel: SupplementPanel): number {
  return NUTRIENT_KEYS.filter(key => panel.amounts[key] !== undefined).length;
}

/**
 * A panel in two lines for the medication page: the serving it is for, and the
 * first few figures it states. The rest are counted rather than listed, since
 * a multivitamin states twenty and the sheet is one tap away.
 */
export function describeSupplementPanel(panel: SupplementPanel): { heading: string; detail: string } {
  const plural = panel.servingAmount !== 1 && panel.servingUnit !== 'ml' && panel.servingUnit !== 'g';
  const unit = plural ? `${panel.servingUnit}s` : panel.servingUnit;
  const stated = NUTRIENT_KEYS.filter(key => panel.amounts[key] !== undefined);
  const SHOWN = 4;
  const shown = stated.slice(0, SHOWN).map(key => {
    const { label, unit: u } = NUTRIENT_LABEL[key];
    return `${label} ${panel.amounts[key]} ${u}`;
  });
  const more = stated.length - shown.length;
  return {
    heading: `Per ${panel.servingAmount} ${unit}: ${stated.length} ${stated.length === 1 ? 'nutrient' : 'nutrients'}`,
    detail: more > 0 ? `${shown.join(', ')}, and ${more} more` : shown.join(', '),
  };
}
