import type {
  FoodNutrition,
  FoodNutritionSource,
  FoodPortion,
  GroceryItem,
  ItemProduct,
  NutrientKey,
} from '../types';
import { NUTRIENT_KEYS } from '../types';

/**
 * Reading and writing a food's nutrient figures, and answering which of the two
 * rows that can hold them actually speaks for a given food.
 *
 * **Everything here refuses rather than approximates**, which is the whole
 * posture and not a defensive habit. A nutrient figure is on its way to a
 * person's Health record, and `docs/arch/health-data.md` is explicit about the
 * asymmetry that follows: a bad *read* shows a true number in the wrong place,
 * while a bad *write* creates a false fact in a medical record that survives
 * until somebody notices and deletes it by hand. So a record this module can't
 * read whole is a record nobody gets, never a record with plausible gaps filled
 * in.
 *
 * **A missing figure is unknown, and is never zero.** Stated on
 * `FoodNutrition.amounts` and enforced here: an absent key stays absent through
 * the parse rather than arriving downstream as a confident 0. It is the single
 * easiest way for this feature to be quietly wrong, because a total summing
 * unknowns as zeroes looks exactly like a correct one.
 *
 * The parse is `parsePriceHistory`'s shape one shelf over — a named, validating,
 * per-shape reader rather than a bare `JSON.parse` — because the column is
 * nullable and has no `'[]'` default standing between a malformed blob and a
 * screen that won't load.
 */

const NUTRITION_BASES: readonly FoodNutrition['basis'][] = ['per100g', 'per100ml', 'perServing'];

const NUTRITION_SOURCES: readonly FoodNutritionSource[] = ['fdc', 'openFoodFacts', 'manual', 'estimated'];

/** A finite, non-negative number, or null for anything else. Shared by the two numeric reads below. */
function readAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A serving's weight, or null.
 *
 * Zero is refused alongside the malformed and the negative, which is where this
 * parts company with `readAmount`: a food genuinely containing no fat is a real
 * statement, while a serving that weighs nothing can't scale anything and is
 * only ever a bad row.
 */
function readServingGrams(value: unknown): number | null {
  const grams = readAmount(value);
  return grams !== null && grams > 0 ? grams : null;
}

/**
 * The figures a stored blob actually carries, dropping anything unreadable.
 *
 * Unknown keys are dropped rather than kept: this build has no unit for a
 * nutrient it doesn't know, so carrying one forward would put a bare number
 * into a panel with nothing to label it. A negative amount is dropped for the
 * same reason a malformed one is — there is no food containing minus four grams
 * of fat, so the figure is wrong rather than merely surprising.
 */
function readAmounts(value: unknown): Partial<Record<NutrientKey, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = readAmount(raw[key]);
    if (amount !== null) amounts[key] = amount;
  }
  return amounts;
}

/**
 * The portion rows a stored blob carries, dropping anything unreadable.
 *
 * **A bad row is dropped rather than failing the record**, which is the
 * opposite call to `basis` above and deliberate: a portion table is a set of
 * independent facts, so one unreadable row costs that one conversion, where a
 * missing basis makes every figure meaningless. A zero or negative weight goes
 * with the malformed, since a portion weighing nothing converts nothing and a
 * zero `amount` would divide by it.
 *
 * Absent reads as empty, which is what every record written before portions
 * existed holds and what both barcode sources produce anyway.
 */
function readPortions(value: unknown): FoodPortion[] {
  if (!Array.isArray(value)) return [];
  const portions: FoodPortion[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const raw = row as Record<string, unknown>;
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    const amount = readAmount(raw.amount);
    const grams = readAmount(raw.grams);
    if (!label || amount === null || amount <= 0 || grams === null || grams <= 0) continue;
    portions.push(raw.custom === true ? { amount, label, grams, custom: true } : { amount, label, grams });
  }
  return portions;
}

/**
 * Reads the stored JSON, answering null for anything it can't read whole.
 *
 * Three things are required, and each one is required for its own reason:
 *
 * - **`basis`**, because the figures are meaningless without it and there is no
 *   safe default to fall back on. See `FoodNutrition.basis`.
 * - **at least one readable figure**, because a panel with nothing in it is not
 *   a record of anything — it would render as a food whose nutrition is known
 *   and blank, which is precisely the absent-versus-zero confusion the type is
 *   shaped to prevent.
 * - **`recordedAt`**, because every writer here stamps one, so a blob without
 *   it did not come from this app and there is nothing to be gained by guessing
 *   what else about it is true.
 *
 * Everything else degrades: a serving weight that doesn't read becomes null,
 * and an unrecognised `source` is downgraded rather than dropping the record.
 */
export function parseFoodNutrition(raw: string | null | undefined): FoodNutrition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const basis = NUTRITION_BASES.find(b => b === parsed.basis);
    if (!basis) return null;

    if (typeof parsed.recordedAt !== 'string' || parsed.recordedAt === '') return null;

    const amounts = readAmounts(parsed.amounts);
    if (Object.keys(amounts).length === 0) return null;

    return {
      basis,
      servingGrams: readServingGrams(parsed.servingGrams),
      servingText: typeof parsed.servingText === 'string' ? parsed.servingText : null,
      amounts,
      // A provenance this build can't explain is one it can't vouch for, so the
      // record is kept and demoted to the weakest claim rather than thrown away
      // or promoted to a claim it might not deserve. Calling it 'manual' would
      // assert the user typed it, which is a worse lie than calling a real
      // label an estimate: this errs toward under-claiming, which is the only
      // direction that stays safe when the figure is bound for a health record.
      portions: readPortions(parsed.portions),
      source: NUTRITION_SOURCES.find(s => s === parsed.source) ?? 'estimated',
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : null,
      recordedAt: parsed.recordedAt,
    };
  } catch {
    return null;
  }
}

/**
 * The column value for a record, or null for none.
 *
 * Null rather than `'null'` so an absent record reads as an empty column, which
 * is what every row predating the migration already holds and what
 * `parseFoodNutrition` answers null for without parsing anything.
 */
export function serializeFoodNutrition(nutrition: FoodNutrition | null): string | null {
  return nutrition ? JSON.stringify(nutrition) : null;
}

/**
 * A food's portion table with one self-weighed row added.
 *
 * The one place a `FoodPortion` is constructed by hand rather than read off a
 * source, so it validates the same way `readPortions` refuses a bad stored
 * row — a zero or negative `amount`/`grams`, or a blank label, is a row that
 * converts nothing or divides by it, not a portion this app has ever allowed
 * through the parse. `custom: true` is stamped unconditionally, since a row
 * built here is by definition somebody's own weighing, never a source's.
 */
export function addCustomPortion(
  nutrition: FoodNutrition,
  label: string,
  amount: number,
  grams: number,
): FoodNutrition | null {
  const trimmed = label.trim();
  if (!trimmed || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(grams) || grams <= 0) return null;
  return { ...nutrition, portions: [...nutrition.portions, { amount, label: trimmed, grams, custom: true }] };
}

/**
 * Whose figures speak for a food: the box in hand if it has its own, otherwise
 * the catalog row's generic ones.
 *
 * **The one place the two fields are read**, so the precedence lives here
 * rather than at each call site — the same discipline `estimatedMinutesFor` and
 * `deliverableKindFor` impose for a chain step's own value over its task's.
 * Read raw and half the app would show a generic yogurt's figures for the
 * specific pot someone actually scanned.
 *
 * A product with no nutrition of its own falls through to the item rather than
 * meaning "this box contains nothing", matching how the four pantry columns
 * beside it already read a null.
 */
export function nutritionFor(
  item: Pick<GroceryItem, 'nutrition'> | null | undefined,
  product?: Pick<ItemProduct, 'nutrition'> | null,
): FoodNutrition | null {
  return product?.nutrition ?? item?.nutrition ?? null;
}

/**
 * What filing a panel found elsewhere onto a catalog row would do to the row.
 *
 * The food log can turn up figures for a food the catalog has never had any:
 * a food database answered a search, and the person is looking straight at
 * the food it describes. Keeping those figures is the difference between
 * searching the database again every time that food is eaten and having it in
 * the list of things this app can already measure.
 *
 * **Which of the three answers comes back decides what the user is asked, and
 * that is why this is a rule rather than an `if` at the call site.** The same
 * question is asked from the search sheet and from a relink, and a row quietly
 * losing the figures it already had is the one outcome neither may produce.
 *
 * - `'write'` — the row has no record, so filing costs nothing and needs no
 *   asking.
 * - `'replace'` — the row already states figures. Filing overwrites them, so
 *   the caller has to ask first. It is deliberately not refused outright: a
 *   row carrying a bad transcription is exactly the row somebody wants to
 *   correct from a database.
 * - `'refuse'` — there is nothing to file. A panel with no amounts records a
 *   food containing nothing, which is the refuse-rather-than-approximate call
 *   every read in this module already makes.
 *
 * **It answers about a `GroceryItem`, never an `ItemProduct`.** A database
 * result describes a food ("Milk, whole, 3.25% milkfat") rather than a box on
 * a shelf, and `nutritionFor`'s precedence above is what makes that
 * load-bearing: a panel filed onto a box becomes the answer for that box only,
 * where the same figures on the item answer for every helping of the food.
 * Barcode figures go the other way for the same reason, and `FoodLogScreen`'s
 * scan handler says so at length.
 */
export type CatalogPanelWrite = 'write' | 'replace' | 'refuse';

export function catalogPanelWrite(
  existing: FoodNutrition | null | undefined,
  incoming: FoodNutrition | null | undefined,
): CatalogPanelWrite {
  if (!incoming || Object.keys(incoming.amounts).length === 0) return 'refuse';
  return existing ? 'replace' : 'write';
}

/**
 * A one-line summary of a stored panel, for a row that shows what it has.
 *
 * Calories lead because they are what somebody is looking for, and the count
 * that follows is how many of the ten this food actually reports — a figure
 * worth showing because plenty of real rows carry a great many nutrients and
 * no energy at all. Null for no record, which a caller renders as the field
 * being empty rather than as a food containing nothing.
 */
export function describeFoodPanel(nutrition: FoodNutrition | null): string | null {
  if (!nutrition) return null;
  const count = Object.keys(nutrition.amounts).length;
  const calories = nutrition.amounts.calorieKcal;
  const counted = `${count} ${count === 1 ? 'nutrient' : 'nutrients'}`;
  if (calories === undefined) return counted;
  return `${Math.round(calories)} cal ${NUTRITION_BASIS_LABEL[nutrition.basis]}, ${counted}`;
}

/**
 * What to call each nutrient on screen, and the unit its figure is in.
 *
 * **One vocabulary, because the unit is the bug with no symptom.** A field
 * labelled "Sodium" beside a box expecting milligrams, transcribed by somebody
 * reading a label printed in grams, is a figure a thousand times too high that
 * looks entirely ordinary until it reaches a health record. The stored unit is
 * already in each key's name (`sodiumMg`, `waterMl`); this is the same fact
 * written for a person, kept beside the parse rather than in whichever screen
 * happened to need it first.
 *
 * Label order is `NUTRIENT_KEYS`' own order, which is the order a nutrition
 * panel prints them, so a form built by walking it reads like the packet
 * somebody is copying from.
 */
export const NUTRIENT_LABEL: Record<NutrientKey, { label: string; unit: string }> = {
  calorieKcal: { label: 'Calories', unit: 'cal' },
  fatG: { label: 'Total fat', unit: 'g' },
  satFatG: { label: 'Saturated fat', unit: 'g' },
  carbsG: { label: 'Total carbohydrate', unit: 'g' },
  fiberG: { label: 'Dietary fiber', unit: 'g' },
  sugarG: { label: 'Total sugars', unit: 'g' },
  proteinG: { label: 'Protein', unit: 'g' },
  sodiumMg: { label: 'Sodium', unit: 'mg' },
  caffeineMg: { label: 'Caffeine', unit: 'mg' },
  waterMl: { label: 'Water', unit: 'ml' },
};

/**
 * The exact US fluid ounce, for the one nutrient somebody might rather type in
 * cups/fl oz than millilitres. Written out rather than rounded to 29.57, same
 * reasoning as `weightLog.ts`'s `KG_PER_LB`: a round trip through this must
 * never drift the millilitre figure a caller actually writes to Health.
 */
export const ML_PER_FL_OZ = 29.5735295625;

export function mlToFlOz(ml: number): number {
  return ml / ML_PER_FL_OZ;
}

export function flOzToMl(flOz: number): number {
  return flOz * ML_PER_FL_OZ;
}

/**
 * How a basis reads in a sentence — "per 100g", "per serving".
 *
 * Shared so the one-line summary above and the form that writes the figures
 * name it identically. A panel described one way and edited under another
 * heading is a person checking whether they typed the right thing and finding
 * two different questions.
 */
export const NUTRITION_BASIS_LABEL: Record<FoodNutrition['basis'], string> = {
  per100g: 'per 100g',
  per100ml: 'per 100ml',
  perServing: 'per serving',
};
