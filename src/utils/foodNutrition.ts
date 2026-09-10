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
    portions.push({ amount, label, grams });
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
  const per = nutrition.basis === 'per100ml' ? 'per 100ml' : nutrition.basis === 'perServing' ? 'per serving' : 'per 100g';
  const counted = `${count} ${count === 1 ? 'nutrient' : 'nutrients'}`;
  if (calories === undefined) return counted;
  return `${Math.round(calories)} cal ${per}, ${counted}`;
}
