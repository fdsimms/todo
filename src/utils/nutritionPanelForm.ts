import type { FoodNutrition, NutrientKey } from '../types';
import type { LabelColumn, LabelReading } from './labelOcr';
import { NUTRIENT_KEYS } from '../types';

/**
 * Turning a printed label into a stored panel, and back into a form to edit.
 *
 * **The fallback that makes the rest of the feature safe to ship.** Barcode
 * lookup and FoodData Central between them miss a real share of what people
 * eat: store brands in neither database, anything from a deli counter or a
 * bakery, food from another country, every packet whose barcode scans to
 * nothing. Without a typed path those foods are permanently un-loggable, and
 * a food logger with holes in it is one people stop using.
 *
 * **Everything here is strings, because a form is.** The sheet holds text and
 * this is the only place text becomes numbers, so the absent-is-not-zero rule
 * has one gate rather than ten. That rule is the whole reason this module is
 * separate and tested: a blank field and a typed `0` are different statements
 * about the food, and collapsing them is the single easiest way for the
 * feature to be quietly wrong.
 *
 * **A field this can't read refuses the save rather than being dropped.** The
 * alternative — silently ignoring "abt 12" — stores a panel the person
 * believes has twelve grams of fat in it and doesn't. Same posture as
 * `foodNutrition.ts`: refuse rather than approximate, because these figures
 * are bound for a health record.
 */

/** One text field's worth of the form: what the person typed, verbatim. */
export interface PanelForm {
  basis: FoodNutrition['basis'];
  /** The serving as printed — "2 cookies (30g)". Rendered back, never computed with. */
  servingText: string;
  /** What that serving weighs. Blank is ordinary; a product sold by volume has none. */
  servingGrams: string;
  amounts: Record<NutrientKey, string>;
}

/** Which field a read failed on — the nutrient's own key, or the serving weight. */
export type PanelFieldKey = NutrientKey | 'servingGrams';

/** Every text field, blank. Used for a food with no record and as the reset. */
export function emptyPanelForm(): PanelForm {
  const amounts = {} as Record<NutrientKey, string>;
  for (const key of NUTRIENT_KEYS) amounts[key] = '';
  return { basis: 'per100g', servingText: '', servingGrams: '', amounts };
}

/**
 * The form for editing an existing panel, or a blank one for null.
 *
 * **An absent figure comes back as a blank field, never as "0".** Round-trips
 * through this and `buildPanelNutrition` therefore preserve the distinction the
 * record is shaped around: what the label didn't say stays unsaid.
 */
export function panelFormFrom(nutrition: FoodNutrition | null): PanelForm {
  const form = emptyPanelForm();
  if (!nutrition) return form;
  form.basis = nutrition.basis;
  form.servingText = nutrition.servingText ?? '';
  form.servingGrams = nutrition.servingGrams === null ? '' : String(nutrition.servingGrams);
  for (const key of NUTRIENT_KEYS) {
    const amount = nutrition.amounts[key];
    if (amount !== undefined) form.amounts[key] = String(amount);
  }
  return form;
}

/**
 * A typed figure, or what went wrong with it.
 *
 * Blank is `null` and means unknown. A decimal comma is accepted, since a
 * label printed in one is a label somebody will type in one, and no locale
 * writes a thousands separator on a nutrition panel. Anything else that isn't
 * a finite non-negative number is `'invalid'` — including a bare minus sign
 * and "12g", because guessing which half of "12g" was meant is exactly the
 * approximation this feature refuses to make.
 */
export function readPanelNumber(text: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  if (!/^\d*\.?\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 'invalid';
}

/**
 * The fields that can't be read, in label order, so a sheet can mark them.
 *
 * A serving weight of zero counts as unreadable rather than as a stated zero,
 * matching `readServingGrams`: a serving that weighs nothing scales nothing.
 * A nutrient zero is a real statement and passes.
 */
export function invalidPanelFields(form: PanelForm): PanelFieldKey[] {
  const bad: PanelFieldKey[] = [];
  const grams = readPanelNumber(form.servingGrams);
  if (grams === 'invalid' || grams === 0) bad.push('servingGrams');
  for (const key of NUTRIENT_KEYS) {
    if (readPanelNumber(form.amounts[key]) === 'invalid') bad.push(key);
  }
  return bad;
}

/** Whether the form still says what it opened saying, for the unsaved-changes guard. */
export function panelFormDirty(form: PanelForm, baseline: PanelForm): boolean {
  if (form.basis !== baseline.basis) return true;
  if (form.servingText.trim() !== baseline.servingText.trim()) return true;
  if (form.servingGrams.trim() !== baseline.servingGrams.trim()) return true;
  return NUTRIENT_KEYS.some(k => form.amounts[k].trim() !== baseline.amounts[k].trim());
}

/**
 * The panel a filled-in form describes, or null when it states nothing.
 *
 * **Null means clear it, not "save failed".** A person who empties every field
 * has said this food's figures are unknown, which is a record to remove rather
 * than one to keep with nothing in it — the same call `parseFoodNutrition`
 * makes when a stored blob has no readable figure. Callers check
 * `invalidPanelFields` first; a form with a bad field must not reach here,
 * since a figure this can't read is skipped and would leave silently.
 *
 * **`source` becomes `'manual'` even when editing a fetched panel**, and that
 * is the point of the edit path rather than a side effect. Once a person has
 * corrected a database's figure it is their number: keeping `'fdc'` on it would
 * let a later re-fetch overwrite the correction on the grounds that the record
 * came from there, and would tell every downstream reader a manufacturer
 * declared something nobody declared. `sourceId` goes with it, since the row it
 * named no longer states these figures.
 *
 * **`portions` survive.** They are the source's own gram weights for stated
 * portions, they are what lets a recipe line written as a cup become a weight,
 * and nothing in this form edits or contradicts them. Dropping them on an edit
 * would quietly cost a recipe its coverage for the sake of a corrected calorie
 * count.
 */
export function buildPanelNutrition(
  form: PanelForm,
  previous: FoodNutrition | null,
  now: Date = new Date(),
): FoodNutrition | null {
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = readPanelNumber(form.amounts[key]);
    if (typeof value === 'number') amounts[key] = value;
  }
  if (Object.keys(amounts).length === 0) return null;

  const grams = readPanelNumber(form.servingGrams);
  const servingText = form.servingText.trim();
  return {
    basis: form.basis,
    servingGrams: typeof grams === 'number' && grams > 0 ? grams : null,
    servingText: servingText || null,
    amounts,
    source: 'manual',
    sourceId: null,
    portions: previous?.portions ?? [],
    recordedAt: now.toISOString(),
  };
}

/**
 * The form with one column of a photographed label laid over it.
 *
 * **It fills fields; it does not save anything.** `labelOcr.ts` reads a panel
 * off a photo and this is where that reading becomes text a person can see and
 * correct, sitting in the same boxes they would otherwise have typed into. The
 * Save that commits it is the one that was already there, which is the whole
 * safety argument for letting the read be best-effort at all: every figure is
 * on screen beside the packet it came from before any of it is a record.
 *
 * **A figure the read did not find leaves its field exactly as it was.** That
 * matters in both directions. A panel stating no fibre must not blank a fibre
 * figure the person typed from the packet a moment ago, and — the more
 * important half — it must not write a 0 there either, since a blank field is
 * "the label didn't say" and this feature's whole job is transcribing what the
 * label did say. Same rule the rest of this module keeps.
 *
 * **A figure the read did find replaces what was there.** Someone who has just
 * photographed the packet is asking for the packet's numbers, and a read that
 * silently declined to correct a field would be the surprising one. It is also
 * what lets the person switch columns and watch the fields follow. The previous
 * text is not lost in any sense that matters: it is one sheet, still open,
 * still guarded by its own discard prompt, and every changed field is visible.
 *
 * **`basis` is only taken when that column actually stated a heading.** It is
 * the field a photograph is least able to settle and the one the record is
 * meaningless without, so a column with no heading leaves the person's own
 * choice standing rather than resetting it to a default that looks chosen.
 *
 * An index past the end leaves the form untouched, which is the honest answer
 * for a column that is not there rather than an occasion to throw at a sheet
 * mid-render.
 */
export function applyLabelReading(
  form: PanelForm,
  reading: LabelReading,
  columnIndex: number = 0,
): PanelForm {
  const column = reading.columns[columnIndex];
  if (!column) return form;
  const amounts = { ...form.amounts };
  for (const key of NUTRIENT_KEYS) {
    const amount = column.amounts[key];
    if (amount !== undefined) amounts[key] = String(amount);
  }
  return {
    basis: column.basis ?? form.basis,
    servingText: reading.servingText ?? form.servingText,
    servingGrams: reading.servingGrams === null ? form.servingGrams : String(reading.servingGrams),
    amounts,
  };
}

/** How many of the form's figures one column would fill, for the sheet to report. */
export function labelColumnFieldCount(column: LabelColumn): number {
  return NUTRIENT_KEYS.filter(key => column.amounts[key] !== undefined).length;
}
