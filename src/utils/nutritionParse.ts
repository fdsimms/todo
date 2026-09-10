import type { FoodNutrition, NutrientKey } from '../types';

/**
 * Reading a nutrition panel out of the two product databases `productLookup.ts`
 * already asks, and doing the unit arithmetic in one place while doing it.
 *
 * **The unit conversion is here rather than inline in the two parsers**, which
 * is the whole reason this module is separate from the service. Open Food Facts
 * and FoodData Central disagree about every name and half the units, and the
 * service around them can't be tested — it is a network call. So the judgement
 * lives here where a test can pin it, exactly the split `gtin.ts` already makes
 * against the same service and `receiptMatch.ts` makes against `extractReceipt`.
 *
 * **Everything refuses rather than approximates.** These figures are bound for
 * a person's Health record, and `docs/arch/health-data.md` sets out the
 * asymmetry that follows: a bad read shows a true number in the wrong place,
 * while a bad write creates a false fact in a medical record that outlives
 * whoever noticed. So a figure this module can't convert is a figure nobody
 * gets — never a figure converted on a guessed unit.
 *
 * **An absent figure stays absent and never becomes zero**, per the note on
 * `FoodNutrition.amounts`. Both sources are routinely partial: Open Food Facts
 * is crowd-maintained, and a US label only has to declare a short list. A key
 * this module didn't read is simply not in `amounts`.
 *
 * The field names, units and nutrient ids below were all read off live
 * responses rather than recalled, because each of the three ways to get this
 * wrong fails silently: a wrong unit is a 1000x error that looks ordinary, a
 * wrong payload shape parses to nothing at all, and a wrong nutrient id files a
 * real figure under the wrong name.
 */

/** The units either source states a figure in, once spelling is normalised. */
export type NutrientSourceUnit = 'kcal' | 'kj' | 'g' | 'mg' | 'ug' | 'ml' | 'l';

/**
 * What unit each `NutrientKey` is stored in — which its own name already says,
 * that being the point of naming them `sodiumMg` rather than `sodium`.
 */
const STORED_UNIT: Record<NutrientKey, NutrientSourceUnit> = {
  calorieKcal: 'kcal',
  proteinG: 'g',
  carbsG: 'g',
  fatG: 'g',
  satFatG: 'g',
  fiberG: 'g',
  sugarG: 'g',
  sodiumMg: 'mg',
  caffeineMg: 'mg',
  waterMl: 'ml',
};

/** Grams in one of each mass unit. */
const GRAMS_PER: Partial<Record<NutrientSourceUnit, number>> = { g: 1, mg: 1e-3, ug: 1e-6 };

/** Millilitres in one of each volume unit. */
const ML_PER: Partial<Record<NutrientSourceUnit, number>> = { ml: 1, l: 1000 };

/**
 * Kilocalories in one of each energy unit. The factor is the thermochemical
 * one the food labelling regulations use, not a rounded 4.2.
 */
const KCAL_PER: Partial<Record<NutrientSourceUnit, number>> = { kcal: 1, kj: 1 / 4.184 };

/**
 * The factor between salt as declared and the sodium in it.
 *
 * 2.5 exactly, which is the figure both EU and UK labelling rules define the
 * conversion by, rather than the 2.542 the molar masses of sodium and sodium
 * chloride actually give. The regulated number is the right one here because it
 * is the number the manufacturer used in the other direction when it printed
 * the packet: dividing by 2.542 would "correct" a declared figure back to
 * something the label never claimed.
 */
const SALT_TO_SODIUM = 2.5;

/**
 * The most of a nutrient that can be in 100g of anything, in that nutrient's
 * stored unit.
 *
 * **A gate on the impossible, not a guess at the implausible.** 100g of a food
 * cannot hold more than 100g of any one component, and cannot exceed 900kcal
 * because fat is the densest macronutrient at 9kcal/g. Both sources carry rows
 * where a contributor typed a per-serving figure into a per-100g field or lost
 * a decimal point, and a figure past these bounds is arithmetically impossible
 * rather than merely surprising — so it is dropped on the same grounds a
 * negative one is.
 *
 * It is applied to a `per100ml` record too, where it is looser by whatever the
 * liquid's density is. That is fine and deliberate: this is a bound on the
 * absurd, and stretching it by a few percent for a drink costs nothing, where
 * tightening it per basis would mean knowing the density this module refuses
 * to guess at.
 *
 * It is deliberately not tighter than that. Anything narrower would be this
 * module deciding which real foods are too unusual to record, which is a
 * judgement it has no business making and would silently drop the honest
 * outliers (pure oil at 900, salt, a caffeine tablet).
 */
const PER_100_CEILING: Record<NutrientKey, number> = {
  calorieKcal: 900,
  proteinG: 100,
  carbsG: 100,
  fatG: 100,
  satFatG: 100,
  fiberG: 100,
  sugarG: 100,
  sodiumMg: 100_000,
  caffeineMg: 100_000,
  waterMl: 100,
};

/**
 * Every unit spelling either source uses, mapped onto one vocabulary.
 *
 * **One table for both**, because they are not one convention and neither is
 * internally consistent. FoodData Central's nutrient list uses upper-case
 * abbreviations (`G`, `MG`, `UG`, `KCAL`) while `servingSizeUnit` on the same
 * food says `GRM` on one row and a lower-case `ml` on the next; Open Food Facts
 * writes its unit fields lower-case. Everything is upper-cased before it is
 * looked up here.
 *
 * Anything absent converts to nothing, which is the refusal doing its job.
 * `IU` is the one worth naming: an International Unit has no fixed mass
 * equivalent, because the factor differs per vitamin.
 */
const SOURCE_UNITS: Record<string, NutrientSourceUnit> = {
  G: 'g',
  GRM: 'g',
  MG: 'mg',
  UG: 'ug',
  MCG: 'ug',
  KCAL: 'kcal',
  KJ: 'kj',
  ML: 'ml',
  MLT: 'ml',
  L: 'l',
  LTR: 'l',
};

/** A unit a source named, in this module's vocabulary, or undefined if it named none this build knows. */
function readSourceUnit(value: unknown): NutrientSourceUnit | undefined {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return text ? SOURCE_UNITS[text] : undefined;
}

/**
 * Which per-100 basis a product's figures carry, from the unit the source
 * states the product itself is measured in.
 *
 * **Both sources label a drink's figures "per 100g" and mean per 100ml**, and
 * that is a real error rather than a rounding one: Red Bull's panel is per
 * 100ml, and storing it as per 100g overstates a can by whatever the drink's
 * density differs from water by. Open Food Facts' own `nutrition_data_per`
 * cannot settle it, since it reads `"100g"` for Red Bull and `"serving"` for
 * Coca-Cola whose figures are in the same `_100g` fields as everything else.
 *
 * **So the product's own quantity unit answers instead, which is a reading and
 * not a guess.** A pack sold as 250ml with a 250ml serving is measured by
 * volume, and the per-100 column of a thing measured by volume is per 100ml.
 * That asks nothing about density and nothing about what the food *is*: the
 * source states the unit, and this believes it. A source naming neither unit
 * leaves the figures per 100g, which is what it labelled them.
 */
function basisFor(measured: NutrientSourceUnit | undefined): FoodNutrition['basis'] {
  return measured === 'ml' || measured === 'l' ? 'per100ml' : 'per100g';
}

/**
 * Trims the floating-point tail a unit conversion leaves behind.
 *
 * `0.0428 * 1000` is `42.800000000000004`, and storing that would put a
 * fourteen-digit number on screen and into a Health sample for a figure the
 * packet printed to three. Four decimal places is finer than any label
 * declares and finer than any nutrient here is measured to.
 */
function roundAmount(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * A figure a source stated, as a number, or null.
 *
 * Strings are accepted because Open Food Facts returns several of its numeric
 * fields as strings depending on how the row was entered. Negatives are refused
 * alongside the unreadable: there is no food containing minus four grams of
 * fat, so such a row is wrong rather than surprising.
 */
export function readSourceNumber(value: unknown): number | null {
  // The empty string is checked before the conversion because `Number('')` is
  // 0, not NaN — so a field the source left blank would otherwise read as a
  // confident zero, which is the one reading this module must never invent.
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * A figure in a source's unit, converted to the one `key` is stored in, or null
 * when the two units have no defined conversion.
 *
 * Refusing an undefined pair is the point rather than a formality: the
 * alternative is passing the number through unconverted, which is how a
 * milligram figure becomes a gram figure and a sodium reading lands a thousand
 * times too high.
 *
 * **Mass converts to volume only for water**, and only because that conversion
 * isn't a guess: a millilitre is defined as the volume of a gram of water. Both
 * sources report water as a mass and `waterMl` stores a volume, so without this
 * the one nutrient stored in millilitres could never be read from either.
 */
export function convertNutrientAmount(
  value: number,
  from: NutrientSourceUnit,
  key: NutrientKey,
): number | null {
  const to = STORED_UNIT[key];
  if (from === to) return roundAmount(value);

  if (to === 'kcal') {
    const factor = KCAL_PER[from];
    return factor === undefined ? null : roundAmount(value * factor);
  }

  if (to === 'g' || to === 'mg') {
    const grams = GRAMS_PER[from];
    if (grams === undefined) return null;
    return roundAmount((value * grams) / GRAMS_PER[to]!);
  }

  // to === 'ml'
  const millilitres = ML_PER[from] ?? GRAMS_PER[from];
  return millilitres === undefined ? null : roundAmount(value * millilitres);
}

/**
 * Records one converted figure against `key`, unless it is impossible.
 *
 * Everything reaching here is per 100 units of the product, which is what makes
 * the ceiling checkable at all — a per-serving figure has no bound, since a
 * serving can be any size.
 */
function setPer100(
  amounts: Partial<Record<NutrientKey, number>>,
  key: NutrientKey,
  value: number,
  unit: NutrientSourceUnit,
): void {
  const converted = convertNutrientAmount(value, unit, key);
  if (converted === null || converted > PER_100_CEILING[key]) return;
  amounts[key] = converted;
}

/** A trimmed string, or null for anything else. */
function readSourceText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Which `nutriments` field holds each nutrient, and what unit it is in.
 *
 * **The `_100g` suffixed fields, and never the bare ones.** Open Food Facts
 * normalises `<nutrient>_100g` to the nutrient's standard unit — grams for
 * every mass, whatever the contributor typed and whatever the sibling
 * `<nutrient>_unit` says — while the bare `<nutrient>` field carries the
 * entered value in the entered unit. Reading `vitamin-c` gives a number in
 * milligrams; reading `vitamin-c_100g` gives the same figure in grams.
 *
 * **Energy is read from `energy-kcal_100g` specifically**, because the plain
 * `energy_100g` is in whichever of kJ and kcal `energy_unit` names, and is kJ
 * far more often than not: a Nutella jar reports `energy_100g: 2252` against
 * `energy-kcal_100g: 539`. Taking the wrong one of those overstates a food by
 * a factor of four.
 *
 * `sodiumMg` is deliberately absent and handled below.
 */
const OFF_FIELDS: Record<Exclude<NutrientKey, 'sodiumMg'>, { field: string; unit: NutrientSourceUnit }> = {
  calorieKcal: { field: 'energy-kcal_100g', unit: 'kcal' },
  proteinG: { field: 'proteins_100g', unit: 'g' },
  carbsG: { field: 'carbohydrates_100g', unit: 'g' },
  fatG: { field: 'fat_100g', unit: 'g' },
  satFatG: { field: 'saturated-fat_100g', unit: 'g' },
  fiberG: { field: 'fiber_100g', unit: 'g' },
  sugarG: { field: 'sugars_100g', unit: 'g' },
  caffeineMg: { field: 'caffeine_100g', unit: 'g' },
  waterMl: { field: 'water_100g', unit: 'g' },
};

/**
 * What one serving of an Open Food Facts product weighs, or null.
 *
 * **Only when the source says the serving is measured in grams.** A serving is
 * as often a volume — `serving_quantity: 250` with `serving_quantity_unit:
 * "ml"` on a can of Red Bull — and `servingGrams` is a mass. Taking the number
 * without reading the unit beside it would file 250ml as 250g, which is a
 * silent few percent on every drink and worse on anything that doesn't have the
 * density of water. There is no serving weight to be had for those, and null is
 * the honest answer.
 */
function readOffServingGrams(product: Record<string, unknown>): number | null {
  if (readSourceUnit(product.serving_quantity_unit) !== 'g') return null;
  const grams = readSourceNumber(product.serving_quantity);
  return grams !== null && grams > 0 ? grams : null;
}

/**
 * The unit Open Food Facts states this product's own quantity in.
 *
 * `product_quantity_unit` first, because the pack as sold is what the per-100
 * column describes, with the serving's unit filling in for a row that has no
 * pack size. The two agree wherever both are present.
 */
function readOffMeasuredUnit(product: Record<string, unknown>): NutrientSourceUnit | undefined {
  return readSourceUnit(product.product_quantity_unit)
    ?? readSourceUnit(product.serving_quantity_unit);
}

/**
 * An Open Food Facts product's nutrition, or null when it stated none this
 * build can read.
 *
 * **Sodium is derived from `salt_100g` and `sodium_100g` is never read**, which
 * looks like the wrong way round and is the single most important line here.
 * Open Food Facts' sodium field is not reliably in the unit it claims. A jar of
 * Nutella reports `salt_100g: 0.107` with `sodium_100g: 0.0428`, which is grams
 * and agrees with the salt figure; a can of Red Bull reports `salt_100g: 0.1`
 * with `sodium_100g: 40`, which is milligrams — and both carry `sodium_unit:
 * "g"`, so the field beside it does not disambiguate them. Taking the Red Bull
 * figure at its stated unit records 40 grams of sodium in 100ml of a soft
 * drink, and a sodium figure a thousand times high is precisely the kind of
 * false fact `docs/arch/health-data.md` is about.
 *
 * The salt field carries no such ambiguity in either row, and salt is the
 * figure an EU label declares in the first place, so it is the one worth
 * trusting. The cost is that a product carrying only sodium records no sodium
 * at all, which is the refusal this module is supposed to make.
 *
 * **`nutriments_estimated` is not read**, and mustn't be. It is Open Food Facts
 * computing a panel from the ingredient list, so its figures are a guess, while
 * `source: 'openFoodFacts'` claims a manufacturer's declared label. Those are
 * the two things `FoodNutrition.source` exists to keep apart.
 */
export function readOffNutrition(
  product: Record<string, unknown>,
  code: string,
  recordedAt: string,
): FoodNutrition | null {
  const raw = product.nutriments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const nutriments = raw as Record<string, unknown>;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of Object.keys(OFF_FIELDS) as Array<Exclude<NutrientKey, 'sodiumMg'>>) {
    const { field, unit } = OFF_FIELDS[key];
    const value = readSourceNumber(nutriments[field]);
    if (value !== null) setPer100(amounts, key, value, unit);
  }

  const salt = readSourceNumber(nutriments.salt_100g);
  if (salt !== null) setPer100(amounts, 'sodiumMg', salt / SALT_TO_SODIUM, 'g');

  if (Object.keys(amounts).length === 0) return null;

  return {
    basis: basisFor(readOffMeasuredUnit(product)),
    servingGrams: readOffServingGrams(product),
    servingText: readSourceText(product.serving_size),
    amounts,
    source: 'openFoodFacts',
    sourceId: code,
    recordedAt,
  };
}

/**
 * FoodData Central's numeric nutrient ids, each one read off a live response
 * rather than recalled.
 *
 * Energy is 1008 rather than the `2047`/`2048` Atwater variants, which only
 * some datasets carry. Sugar is 2000 ("Total Sugars"), which is what the
 * Branded dataset uses.
 */
const FDC_NUTRIENT_KEYS: Record<number, NutrientKey> = {
  1008: 'calorieKcal',
  1003: 'proteinG',
  1005: 'carbsG',
  1004: 'fatG',
  1258: 'satFatG',
  1079: 'fiberG',
  2000: 'sugarG',
  1093: 'sodiumMg',
  1057: 'caffeineMg',
  1051: 'waterMl',
};

/** What one serving of an FDC food weighs, or null. Grams only, same rule as OFF's. */
function readFdcServingGrams(food: Record<string, unknown>): number | null {
  if (readSourceUnit(food.servingSizeUnit) !== 'g') return null;
  const grams = readSourceNumber(food.servingSize);
  return grams !== null && grams > 0 ? grams : null;
}

/**
 * A FoodData Central search hit's nutrition, or null when it carried none.
 *
 * **Written against the search endpoint's shape, which is not the detail
 * endpoint's.** `/foods/search` returns each figure flat — `{ nutrientId,
 * unitName, value }` — where `/food/{id}` nests it as `{ nutrient: {...},
 * amount }`. `productLookup.ts` asks the search endpoint, because it is
 * searching by barcode. Reading the nested shape here would parse nothing at
 * all, silently, on every product.
 *
 * **The first entry for a nutrient wins, and the rest are another food's.** A
 * search hit's `foodNutrients` is not one panel: the Cheerios hit carries 84
 * entries covering the same 28 nutrients three times, at 12.8g of protein in
 * the first block and 5.56g in the third, with nothing in the entry to say
 * which is which. Fetching the hit's own `fdcId` from the detail endpoint
 * returns exactly 28, and their `foodNutrientId`s are exactly the first block's
 * — so the leading run is the food that was asked for and the rest are label
 * variants merged into the result. A key is claimed by its first entry even if
 * that entry's unit doesn't convert, because falling through to a later one
 * would be answering about a different food.
 *
 * The figures are per 100g. The Branded dataset states this in each entry's own
 * derivation ("Given by information provider as an approximate value per 100
 * unit measure"), and the arithmetic agrees: the Cheerios hit reports 359kcal
 * against a 20g serving, which is the box's per-100g column rather than its
 * per-serving one.
 */
export function readFdcNutrition(
  food: Record<string, unknown>,
  recordedAt: string,
): FoodNutrition | null {
  const entries = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];

  const amounts: Partial<Record<NutrientKey, number>> = {};
  const claimed = new Set<NutrientKey>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const key = FDC_NUTRIENT_KEYS[Number(row.nutrientId)];
    if (!key || claimed.has(key)) continue;
    claimed.add(key);
    const unit = readSourceUnit(row.unitName);
    const value = readSourceNumber(row.value);
    if (unit && value !== null) setPer100(amounts, key, value, unit);
  }

  if (Object.keys(amounts).length === 0) return null;

  return {
    // The Branded dataset has no pack-level unit, so the serving's is what says
    // whether this food is measured by volume. A cold brew's servingSizeUnit is
    // `ml` where a cereal's is `GRM`.
    basis: basisFor(readSourceUnit(food.servingSizeUnit)),
    servingGrams: readFdcServingGrams(food),
    servingText: readSourceText(food.householdServingFullText),
    amounts,
    source: 'fdc',
    sourceId: readSourceText(food.fdcId) ?? (readSourceNumber(food.fdcId) !== null ? String(food.fdcId) : null),
    recordedAt,
  };
}
