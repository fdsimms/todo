import type { FoodLogEntry, FoodNutrition, MealPlanEntry, MealSlot, NutrientKey, SavedMealItem } from '../types';
import { MEAL_SLOTS, NUTRIENT_KEYS } from '../types';
import { aisleForName } from './groceryAisles';
import { isWaterEntry } from './waterLog';
import { isNutrientOnlyEntry } from './nutrientLog';
import { gramsForLine, hasKnownDensity, panelMultiplier } from './ingredientGrams';
import { formatQuantityAmount, inflectUnit, parseQuantity, rationalToNumber } from './quantity';
import { measureParsedQuantity, unitBase } from './unitConvert';

/**
 * The food log's rules: what a helping of something works out to, and what a
 * day of them adds up to.
 *
 * **Eating is the thing this app has never had.** `MealPlanEntry.cookedAt` is
 * when a dish was made and `Leftover.outcome` is whether a container ended up
 * empty; both types say outright that neither is somebody eating a known
 * amount. See `FoodLogEntry` for why a log is the right shape for it and a task
 * or a quota is not.
 *
 * **A total never sums an absent figure as zero.** This is the same rule
 * `FoodNutrition.amounts` states and `moodInsights` states generally as "a day
 * you didn't log is not a zero", and a day's totals are where it does the most
 * damage: a US label declares a short list, so a day of ordinary food will have
 * fibre on three entries and not the other four. Adding those as zeroes gives a
 * fibre total that looks like a measurement and is not one. So a nutrient
 * absent everywhere stays absent from the total, and every total carries a
 * count of how many entries actually stated it.
 *
 * **Nothing here grades anything.** No daily-value percentages, no colours, no
 * "good day". Those need an RDA the app has never asked for, and
 * `cookingStats.ts`'s rule holds here as it does on the recipe line: counts,
 * never a score.
 *
 * The scaling half deliberately reuses `panelMultiplier` rather than repeating
 * it. A helping measured by one rule here and another rule in the recipe
 * rollup would be two different calorie counts for one plate of food.
 *
 * **Nothing here imports `recipeNutrition.ts`, and that is load-bearing rather
 * than tidiness.** That module reaches the meal plan and through it the
 * settings store and SQLite, so importing it would make this one impossible to
 * exercise without standing up a database, which is exactly the split
 * `foodSearchMatch` keeps against the service it ranks for. So the per-serving
 * figures of a cooked dish are *passed in* rather than computed here: the
 * caller already holds a `RecipeNutrition` and can divide it.
 */

/** A day's figures, and how much of the day each one actually speaks for. */
export interface FoodLogTotals {
  /** Summed amounts. A nutrient no entry stated is absent, never 0. */
  total: Partial<Record<NutrientKey, number>>;
  /** How many entries stated each nutrient, so a caller can say what a figure covers. */
  reported: Partial<Record<NutrientKey, number>>;
  /** How many entries went into this. */
  entries: number;
}

/** One meal's worth of the day, plus what it came to. */
export interface FoodLogSection {
  /** Null for the run of entries eaten outside a meal. */
  slot: MealSlot | null;
  entries: FoodLogEntry[];
  totals: FoodLogTotals;
}

/**
 * A stored panel is rounded to a tenth, because a figure carried to fourteen
 * decimal places is float noise pretending to be precision, and these numbers
 * are read back and summed rather than recomputed.
 */
function round(amount: number): number {
  return Math.round(amount * 10) / 10;
}

/**
 * Whether `name` reads as a beverage or other drinkable liquid.
 *
 * The one thing `scalePanelToAmount`'s beverage fallback is allowed to ask
 * about a food before approximating its density — reuses the grocery aisle
 * lexicon rather than a second list of drink words, since "is this a
 * beverage" is exactly the question `aisleForName` already answers for every
 * catalog row.
 */
export function isBeverageName(name: string): boolean {
  return aisleForName(name) === 'Beverages';
}

/** A volume line's millilitres, or null when it isn't a volume at all. */
function volumeMillilitres(quantity: string): number | null {
  const parsed = parseQuantity(quantity);
  if (parsed.amount === null) return null;
  const single = parsed.rangeMax ? { ...parsed, rangeMax: null } : parsed;
  const measured = measureParsedQuantity(single);
  if (!measured || measured.dimension !== 'volume') return null;
  return measured.base;
}

/**
 * What one helping of a food works out to, and what it weighs.
 *
 * **Refuses rather than approximates**, which is the posture the whole nutrition
 * tree keeps and matters most here: this figure is what a day's total is built
 * from and, eventually, what goes into a health record. An amount that cannot
 * be measured against this food's own panel gets no entry rather than a guessed
 * one. `panelMultiplier` states the three ways that happens.
 *
 * **One deliberate exception: a beverage with no density of its own.** A label
 * that states its figures per 100g or per serving, with no stated pack volume
 * and no portion naming a volume, refuses every ml/fl oz amount outright —
 * which blocks logging a drink whose own panel just happens to be weight-basis
 * rather than `per100ml` (a barcode source's choice, not a fact about the
 * drink). Water's own density, 1 ml ≈ 1 g, is close enough for most drinks and
 * is the one density this app is willing to assume without being told — but
 * only once `panelMultiplier` has already asked the food's own data and been
 * refused, and only for a food `isBeverageName` calls a beverage, never a solid
 * food. It is genuinely wrong for anything syrupy or creamy, which is why
 * `approximate` comes back true: callers show a disclaimer next to the amount
 * rather than presenting it as a measured figure.
 *
 * The result's `basis` is `perServing` and its figures are the amounts actually
 * eaten. An entry records one helping rather than a food, so the scaling has
 * already happened by the time anything reads it back and no reader needs to
 * know what the source panel was per 100g. Its `source` is carried through
 * unchanged, because who stated the underlying figures is exactly as true of
 * the helping as of the food.
 */
export function scalePanelToAmount(
  panel: FoodNutrition,
  quantity: string,
  prep: string | null,
  now: Date = new Date(),
  foodName: string | null = null,
): { nutrition: FoodNutrition; grams: number | null; approximate: boolean } | null {
  const target = nutrientTarget(quantity);
  if (target !== null) return scaleToNutrient(panel, target, quantity, now);

  let factor = panelMultiplier(quantity, prep, panel);
  let approximate = false;
  let fallbackGrams: number | null = null;

  if (factor === null && panel.basis !== 'per100ml' && foodName !== null && isBeverageName(foodName)) {
    const millilitres = volumeMillilitres(quantity);
    if (millilitres !== null && millilitres > 0) {
      const scaled = panel.basis === 'per100g'
        ? millilitres / 100
        : (panel.servingGrams !== null && panel.servingGrams > 0 ? millilitres / panel.servingGrams : null);
      if (scaled !== null) {
        factor = scaled;
        approximate = true;
        fallbackGrams = millilitres;
      }
    }
  }

  // A weight against a per-100ml panel that has no density of its own: water's
  // (1 g is about 1 ml), flagged approximate for the same reason as the volume
  // fallback above. A per-100ml panel is a liquid by construction, so no name
  // check is needed, and a weighed portion (which `panelMultiplier` reads
  // first) always outranks this.
  if (factor === null && panel.basis === 'per100ml') {
    const measured = measureParsedQuantity(parseQuantity(quantity));
    if (measured && measured.dimension === 'mass' && measured.base > 0) {
      factor = measured.base / 100;
      approximate = true;
      fallbackGrams = measured.base;
    }
  }

  if (factor === null || !(factor > 0)) return null;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = panel.amounts[key];
    if (amount !== undefined) amounts[key] = round(amount * factor);
  }
  if (Object.keys(amounts).length === 0) return null;

  // Best effort and allowed to fail on its own: a volume against a per-100ml
  // panel is a perfectly good entry whose weight nobody knows, and inventing
  // one would need a density this app deliberately has not got.
  //
  // Rounded here rather than in `gramsForLine`, which is right to hand back
  // whatever the arithmetic gave it: the recipe rollup divides its answer by
  // 100 and never shows it, where this one is stored on the row and rendered
  // as a weight. A cup of milk off a 244g portion comes back as
  // 243.99999999999997, and that is a number nobody should be shown.
  //
  // A line written in servings weighs `servingGrams` times itself, the same
  // fact `panelMultiplier` used to answer `factor` above — `gramsForLine`
  // can't answer this at all, since it only reads the portion table, and a
  // packaged product's table never names a "serving" (see `FoodPortion`).
  const parsedQuantity = parseQuantity(quantity);
  const rawGrams = fallbackGrams !== null
    ? fallbackGrams
    : parsedQuantity.unit === 'serving' && parsedQuantity.amount !== null
      ? (panel.servingGrams !== null ? rationalToNumber(parsedQuantity.amount) * panel.servingGrams : null)
      : gramsForLine(parsedQuantity, prep, panel.portions);
  const grams = rawGrams === null ? null : round(rawGrams);

  return {
    grams,
    approximate,
    nutrition: {
      basis: 'perServing',
      servingGrams: grams,
      servingText: quantity.trim() || null,
      amounts,
      source: panel.source,
      sourceId: panel.sourceId,
      // Deliberately dropped. A portion table describes the food, and this
      // describes one helping of it that has already been measured: carrying
      // the rows forward would invite something to scale an amount that is
      // already scaled.
      portions: [],
      recordedAt: now.toISOString(),
    },
  };
}

const KJ_PER_KCAL = 4.184;

/** An amount stated as a quantity of one nutrient rather than of the food. */
interface NutrientTarget {
  nutrient: 'calorieKcal' | 'proteinG' | 'carbsG' | 'fatG';
  /** In the nutrient's own stored unit (kcal, or grams). */
  value: number;
}

/**
 * "250 cal", "250 kcal", "1000 kJ", "30 g protein" and the like, or null for an
 * amount of the food itself. kJ is converted to kcal here, so everything
 * downstream works in the one stored unit.
 */
function nutrientTarget(quantity: string): NutrientTarget | null {
  const number = '(\\d+(?:[.,]\\d+)?)';
  const text = quantity.trim();
  const energy = new RegExp(`^${number}\\s*(k?cals?|calories|kj)$`, 'i').exec(text);
  if (energy) {
    const raw = Number(energy[1].replace(',', '.'));
    const value = energy[2].toLowerCase() === 'kj' ? raw / KJ_PER_KCAL : raw;
    return Number.isFinite(value) && value > 0 ? { nutrient: 'calorieKcal', value } : null;
  }
  const macro = new RegExp(`^${number}\\s*(?:g|grams?)\\s+(?:of\\s+)?(protein|carbs?|carbohydrates?|fat)$`, 'i').exec(text);
  if (macro) {
    const value = Number(macro[1].replace(',', '.'));
    const word = macro[2].toLowerCase();
    const nutrient = word === 'protein' ? 'proteinG' : word === 'fat' ? 'fatG' : 'carbsG';
    return Number.isFinite(value) && value > 0 ? { nutrient, value } : null;
  }
  return null;
}

/**
 * An amount stated as a quantity of one nutrient: the helping that holds that
 * much, with every other nutrient in the panel's own proportion to it.
 *
 * Refused (null) when the panel states no figure for that nutrient, since
 * nothing then relates the typed number to the rest of the panel. The panel's
 * amounts are all per the same basis unit, so the ratio of the stated nutrient
 * is the multiplier for every figure, whatever the basis. Grams follow only
 * where the basis gives a weight to scale (per 100g, or a serving with a stated
 * weight); a per-100ml panel has none, and a density is not invented for it.
 */
function scaleToNutrient(
  panel: FoodNutrition,
  target: NutrientTarget,
  quantity: string,
  now: Date,
): { nutrition: FoodNutrition; grams: number | null; approximate: boolean } | null {
  const perBasis = panel.amounts[target.nutrient];
  if (perBasis === undefined || !(perBasis > 0)) return null;
  const factor = target.value / perBasis;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = panel.amounts[key];
    if (amount !== undefined) amounts[key] = round(amount * factor);
  }

  let rawGrams: number | null = null;
  if (panel.basis === 'per100g') rawGrams = factor * 100;
  else if (panel.basis === 'perServing' && panel.servingGrams !== null) rawGrams = factor * panel.servingGrams;
  const grams = rawGrams === null ? null : round(rawGrams);

  return {
    grams,
    approximate: false,
    nutrition: {
      basis: 'perServing',
      servingGrams: grams,
      servingText: quantity.trim() || null,
      amounts,
      source: panel.source,
      sourceId: panel.sourceId,
      portions: [],
      recordedAt: now.toISOString(),
    },
  };
}

/**
 * Amounts this food's own portion table can measure — "1 cup", "2 tbsp" — for
 * a hint that says what will actually resolve before someone types something
 * `scalePanelToAmount` has to refuse.
 *
 * Listed from the panel rather than a fixed example like "1 cup": that
 * placeholder was suggesting a measure a given food often can't answer
 * (`FoodLogEntrySheet`'s "e.g. 1 cup" placeholder read as a promise on a
 * per-100ml panel with no stated portions), which is the exact complaint this
 * exists to fix. A weight in grams is left off — every food answers that one,
 * portion table or not, and the caller's own copy already says so.
 */
export function portionExamples(panel: FoodNutrition, limit = 3): string[] {
  return panel.portions.slice(0, limit).map(p => {
    const count = Number.isInteger(p.amount) ? String(p.amount) : p.amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${count} ${p.label}`;
  });
}

/**
 * What actually resolves against this panel, in a sentence — the same
 * question `weighableLine`'s offer answers for one refused line, said up
 * front instead of only after a refusal.
 *
 * **Basis-specific, not "a weight always works".** `panelMultiplier` refuses
 * a gram amount against a `per100ml` panel with no known density — a drink's
 * weight is a fact nobody here has, the same reason `servingGrams` is null
 * for one — so a hint that named grams for every food would be wrong for
 * exactly the foods (drinks) most likely to reach for it. Volume, by
 * contrast, needs no portion row for a `per100ml` panel: it's measured
 * directly, `fl oz` included since `unitConvert.ts` now carries it. Once a
 * volume has been weighed onto the panel's own table, `hasKnownDensity`
 * says so and the hint adds grams back in — `panelMultiplier` can answer
 * one from here on, off that same density.
 */
function baseAmountHint(panel: FoodNutrition): string {
  if (panel.basis === 'per100ml') {
    const grams = hasKnownDensity(panel.portions);
    const weight = grams ? ', or a weight now that one has been weighed' : '';
    return panel.servingGrams
      ? `A volume, like 250 ml or 1 cup${weight}, or a number of servings.`
      : `A volume, like 250 ml or 1 cup${weight}.`;
  }
  if (panel.basis === 'perServing' && panel.servingGrams === null) {
    return 'A number of servings, like 1 serving. This food has no weight per serving, so nothing else can be entered.';
  }
  const servings = panel.basis !== 'perServing' && panel.servingGrams !== null;
  const examples = portionExamples(panel);
  if (examples.length > 0) {
    return `A weight (like 100g), or one of this food’s stated portions: ${examples.join(', ')}${servings ? ', or a number of servings' : ''}.`;
  }
  return servings
    ? 'A weight, like 100g, or a number of servings.'
    : 'A weight, like 100g. This food has no stated portions.';
}

/**
 * What a typed amount can be for this food: `baseAmountHint`'s sentence about
 * the food itself, then a second naming the nutrient amounts the panel's own
 * figures allow (the same list `foodUnitOptionsFor` offers as pills, so the two
 * cannot disagree), and one on weights against a liquid.
 */
export function amountHint(panel: FoodNutrition): string {
  const parts = [baseAmountHint(panel)];
  if (panel.basis === 'per100ml' && !hasKnownDensity(panel.portions)) {
    parts.push('A weight also works, counted as water, so it is approximate.');
  }
  const names: string[] = [];
  for (const unit of NUTRIENT_UNIT_OPTIONS) {
    const stated = panel.amounts[unit.nutrient];
    if (stated !== undefined && stated > 0) names.push(unit.hint);
  }
  if (names.length > 0) {
    const last = names.pop() as string;
    parts.push(`You can also enter ${names.length > 0 ? `${names.join(', ')}, or ${last}` : last}.`);
  }
  return parts.join(' ');
}

/**
 * One example amount this panel will actually accept, for an "e.g." field
 * placeholder — the single-value counterpart to `amountHint`, and basis-aware
 * for the same reason: a per-100ml panel's placeholder has to be a volume,
 * never the "100g" that `panelMultiplier` refuses for it.
 */
export function amountExample(panel: FoodNutrition): string {
  const [first] = portionExamples(panel, 1);
  if (first) return first;
  if (panel.basis === 'per100ml') return '250ml';
  if (panel.basis === 'perServing' && panel.servingGrams === null) return '1 serving';
  return '100g';
}

/**
 * One unit an amount can be entered in, offered as a pill beside an amount
 * field — `FoodLogEntrySheet` and `ScanPortionSheet` both build this list
 * from `foodUnitOptionsFor` rather than keeping their own copies. `suffix` is
 * what turns a typed number into the amount text `scalePanelToAmount` (via
 * `panelMultiplier`) actually reads — a space before a word unit, none before
 * "g", matching how those already read as amounts ("0.5 tsp", "100g").
 */
export interface FoodUnitOption {
  key: string;
  label: string;
  suffix: string;
}

/**
 * A `per100ml` panel needs no portion row to measure a volume —
 * `unitConvert.ts` carries fixed conversions for all of these (see
 * `panelMultiplier`'s `per100ml` branch), so they resolve for every drink
 * regardless of what its own source data stated. Cup first, matching what
 * people reach for most.
 */
export const VOLUME_UNIT_OPTIONS: FoodUnitOption[] = [
  { key: 'cup', label: 'cup', suffix: ' cup' },
  { key: 'tbsp', label: 'tbsp', suffix: ' tbsp' },
  { key: 'tsp', label: 'tsp', suffix: ' tsp' },
  { key: 'fl oz', label: 'fl oz', suffix: ' fl oz' },
  { key: 'ml', label: 'ml', suffix: ' ml' },
];

/** US weights, offered beside grams. `unitConvert` carries both. */
const WEIGHT_UNIT_OPTIONS: FoodUnitOption[] = [
  { key: 'oz', label: 'oz', suffix: ' oz' },
  { key: 'lb', label: 'lb', suffix: ' lb' },
];

/**
 * Amounts stated as a quantity of one nutrient, which `nutrientTarget` reads.
 * `hint` is how the free-text hint names each.
 */
const NUTRIENT_UNIT_OPTIONS: Array<FoodUnitOption & { nutrient: NutrientTarget['nutrient']; hint: string }> = [
  { key: 'cal', label: 'cal', suffix: ' cal', nutrient: 'calorieKcal', hint: 'calories (like 250 cal)' },
  { key: 'kj', label: 'kJ', suffix: ' kJ', nutrient: 'calorieKcal', hint: 'kJ' },
  { key: 'protein', label: 'g protein', suffix: ' g protein', nutrient: 'proteinG', hint: 'grams of protein' },
  { key: 'carbs', label: 'g carbs', suffix: ' g carbs', nutrient: 'carbsG', hint: 'grams of carbs' },
  { key: 'fat', label: 'g fat', suffix: ' g fat', nutrient: 'fatG', hint: 'grams of fat' },
];

/**
 * Every unit this food's own panel can measure — its stated portions, plus
 * grams and/or servings wherever `panelMultiplier` would actually resolve
 * them (mirrors `amountHint` above). Grams are left off a `per100ml` panel
 * with no known density and a `perServing` panel with no stated serving
 * weight, because typing them would only ever be refused; a `serving` pill
 * is offered for a `perServing` panel (whose own figures already are one
 * serving) and for any other basis that states a `servingGrams` weight to
 * scale by. A `per100ml` panel gets `VOLUME_UNIT_OPTIONS` — the fixed table
 * above, rather than anything drawn from the panel, since a per100ml basis
 * resolves any of them without needing the food's own data — and a `g` pill
 * too once `hasKnownDensity` says a volume has actually been weighed onto
 * its table, at which point `panelMultiplier` can read that same density
 * back to answer a mass line.
 */
export function foodUnitOptionsFor(panel: FoodNutrition): FoodUnitOption[] {
  const out: FoodUnitOption[] = [];
  const seen = new Set<string>();
  for (const p of panel.portions) {
    const key = p.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: p.label, suffix: ` ${p.label}` });
  }
  // A per-100ml panel always takes a weight: its own density when one has been
  // weighed, otherwise water's, which `scalePanelToAmount` flags approximate.
  const gramsResolve = panel.basis === 'per100g'
    || (panel.basis === 'perServing' && panel.servingGrams !== null)
    || panel.basis === 'per100ml';
  if (gramsResolve) {
    if (!seen.has('g')) out.push({ key: 'g', label: 'g', suffix: 'g' });
    for (const unit of WEIGHT_UNIT_OPTIONS) {
      if (seen.has(unit.key)) continue;
      seen.add(unit.key);
      out.push(unit);
    }
  }
  if (panel.basis === 'perServing' || panel.servingGrams !== null) {
    out.push({ key: 'serving', label: 'serving', suffix: ' serving' });
  }
  if (panel.basis === 'per100ml') {
    for (const unit of VOLUME_UNIT_OPTIONS) {
      if (seen.has(unit.key)) continue;
      seen.add(unit.key);
      out.push(unit);
    }
  }
  // Last, so they never displace the unit a food is usually measured in. Each
  // only where the panel states that nutrient, or `scalePanelToAmount` would
  // refuse it.
  for (const unit of NUTRIENT_UNIT_OPTIONS) {
    const stated = panel.amounts[unit.nutrient];
    if (stated !== undefined && stated > 0 && !seen.has(unit.key)) {
      out.push({ key: unit.key, label: unit.label, suffix: unit.suffix });
    }
  }
  return out;
}

/** Whether a unit option is "a quantity of one nutrient" (cal, g protein) rather than a unit of the food. */
export function isNutrientUnitOption(option: FoodUnitOption): boolean {
  return NUTRIENT_UNIT_OPTIONS.some(n => n.key === option.key);
}

/** A typed number for a pill, turned into the amount text the rest of the sheet reads. */
export function composeFoodAmount(numberText: string, unit: FoodUnitOption | undefined): string {
  const n = numberText.trim();
  if (!n || !unit) return '';
  return `${n}${unit.suffix}`;
}

/**
 * The reverse of `composeFoodAmount`, for reopening a correction: what number
 * and which of `options` a previously saved amount text was. Only recognises
 * the exact shapes these sheets themselves write, so an amount saved before
 * this split existed (a fraction, "1 lemon", a per100ml volume typed free)
 * simply doesn't match — the saved text is left as-is and still saves
 * correctly untouched, it just can't be shown pre-filled in the split fields.
 */
export function parseFoodAmount(raw: string, options: FoodUnitOption[]): { number: string; unitKey: string } | null {
  const match = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(raw.trim());
  if (!match) return null;
  const [, numberText, unitText] = match;
  const word = unitText.trim().toLowerCase();
  if (!word) return null;
  for (const option of options) {
    if (option.key === 'g' ? (word === 'g' || word === 'gram' || word === 'grams') :
      option.key === 'serving' ? word.startsWith('serving') :
        option.key === 'cal' ? /^(?:k?cals?|calories)$/.test(word) :
        word === option.label.toLowerCase()) {
      return { number: numberText, unitKey: option.key };
    }
  }
  return null;
}

/** What the entry sheet's amount fields open on when a food was logged before. */
export interface RecalledAmount {
  /** The amount text Save would read, exactly as if it had been typed. */
  amount: string;
  /**
   * The unit pill to select: one of the panel's own, `'other'` for the free
   * text field, or null where there are no pills (a dish, or a panel with no
   * resolvable units).
   */
  unitKey: string | null;
  /** The number-only field's text beside a selected pill; empty otherwise. */
  number: string;
  /** Which question a dish's amount field is asking. Null for a food. */
  dishMeasure: 'weight' | 'servings' | null;
}

/** What `recallAmount` measures a remembered amount against: the food or dish as it stands today. */
export type RecallTarget =
  | { kind: 'food'; panel: FoodNutrition; name: string | null }
  | { kind: 'dish'; weighed: boolean; served: boolean };

/**
 * The amount a food was last logged in, re-measured against the panel it has
 * now, or null when the old amount no longer means anything to it.
 *
 * **Read back the way a correction reads one** (`foodLogEntryEdit`), so the
 * two routes into the amount field cannot disagree about what an entry's
 * amount was. That also means an entry a correction refuses (a dish with
 * "Anything else?" lines answered, an amount that doesn't parse) recalls
 * nothing, and the field opens as it would for a food never logged.
 *
 * **The remembered amount has to resolve against today's panel**, not the one
 * it was logged against. A food's panel can be re-filed, replaced by a scan,
 * or lose the portion row the amount named, and a pre-filled "2 slices" that
 * Save then refuses is worse than an empty field. So a food's amount is run
 * through `scalePanelToAmount` again, and a dish's measure has to be one the
 * dish can still answer (grams need a weighed dish, servings a servings
 * count). Anything that fails opens on the sheet's ordinary default instead:
 * the first unit pill with no number, or one serving of a dish.
 *
 * An amount that resolves but isn't one of the pills (a fraction, a plural
 * the panel's label doesn't spell) opens on "Something else" with its text
 * intact, the same fallback a correction makes.
 */
export function recallAmount(
  last: FoodLogEntryEdit | null | undefined,
  target: RecallTarget,
): RecalledAmount | null {
  if (!last) return null;
  if (target.kind === 'dish') {
    if (!last.dishMeasure) return null;
    if (last.dishMeasure === 'weight' && !target.weighed) return null;
    if (last.dishMeasure === 'servings' && !target.served) return null;
    const typed = Number(last.amount);
    if (!Number.isFinite(typed) || typed <= 0) return null;
    return { amount: last.amount, unitKey: null, number: '', dishMeasure: last.dishMeasure };
  }
  if (last.dishMeasure) return null;
  const options = foodUnitOptionsFor(target.panel);
  const parsed = options.length > 0 ? parseFoodAmount(last.amount, options) : null;
  if (parsed) {
    const amount = composeFoodAmount(parsed.number, options.find(o => o.key === parsed.unitKey));
    if (!scalePanelToAmount(target.panel, amount, null, undefined, target.name)) return null;
    return { amount, unitKey: parsed.unitKey, number: parsed.number, dishMeasure: null };
  }
  if (!scalePanelToAmount(target.panel, last.amount, null, undefined, target.name)) return null;
  return {
    amount: last.amount,
    unitKey: options.length > 0 ? 'other' : null,
    number: '',
    dishMeasure: null,
  };
}

/**
 * What some number of helpings of a cooked dish works out to.
 *
 * **Takes the dish's per-serving figures, not the dish**, so this module needs
 * nothing from `recipeNutrition.ts` at runtime. The caller has a
 * `RecipeNutrition` already and `perServing` is what turns one into these; the
 * coverage floor has been applied by the time it answers at all, so anything
 * reaching here is a dish whose figures were worth stating.
 *
 * **Null when the caller had no per-serving figures**, which is what
 * `perServing` answers for a recipe that never said how many servings it makes.
 * Treating the whole dish as one helping instead is the failure worth refusing:
 * "how much of this did you eat" has no answer without a servings count, and a
 * whole tray of lasagne logged as one serving is out by a factor of six while
 * looking entirely plausible on the screen.
 */
export function recipeHelpingNutrition(
  perServingAmounts: Partial<Record<NutrientKey, number>> | null,
  helpings: number,
  source: FoodNutrition['source'] = 'estimated',
  now: Date = new Date(),
): FoodNutrition | null {
  if (!perServingAmounts) return null;
  if (!(helpings > 0)) return null;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = perServingAmounts[key];
    if (amount !== undefined) amounts[key] = round(amount * helpings);
  }
  return helpingNutrition(
    amounts,
    helpings === 1 ? '1 serving' : `${helpings} servings`,
    null,
    source,
    now,
  );
}

/**
 * One helping's panel, from amounts that have already been scaled to it.
 *
 * The last step `recipeHelpingNutrition` takes, split out because a helping
 * measured on a scale rather than counted in servings arrives with its amounts
 * already worked out (`weighedHelping` in `mealLog.ts` does that arithmetic
 * against the whole dish) and needs the same panel around them. One place
 * builds the record either way, so the two ways of saying how much can't end
 * up describing themselves differently.
 *
 * `grams` is what the helping weighed, which a weighed plate always knows and
 * a counted one knows only for a dish somebody weighed. It is the eaten
 * amount rather than a serving size: `basis` is `perServing` and these figures
 * are already that helping, so `servingGrams` is what this one helping was.
 */
export function helpingNutrition(
  amounts: Partial<Record<NutrientKey, number>>,
  servingText: string,
  grams: number | null,
  source: FoodNutrition['source'] = 'estimated',
  now: Date = new Date(),
): FoodNutrition | null {
  if (Object.keys(amounts).length === 0) return null;

  return {
    basis: 'perServing',
    servingGrams: grams,
    servingText,
    amounts,
    // A dish's figures are built from its ingredients' panels through a
    // coverage floor, so the dish itself is an estimate however good the
    // panels under it were. Nothing downstream may render this the way it
    // renders a label. See FoodNutrition.source.
    source,
    sourceId: null,
    portions: [],
    recordedAt: now.toISOString(),
  };
}

/**
 * One panel with some others folded into it, for an entry made of more than
 * one measured thing — a dish's own figures plus a side that has no fixed
 * amount in the recipe, so it was never part of the coverage floor
 * `recipeNutrition.ts` applies ("1 baguette, warmed, for serving" is not a
 * gap in that rollup's arithmetic, it is a line with nothing to count). What's
 * actually eaten still varies every time, which is why this stays a per-entry
 * question asked at log time rather than a figure fixed on the recipe.
 *
 * **Summed key by key, a key present on either side counted.** The dish
 * states no fibre and the baguette's own panel might be the only source that
 * does; dropping it because the *dish* didn't state it would be the same
 * silent-zero mistake `foodLogTotals` is built to avoid, just one level down.
 *
 * **`grams` and a single provenance stop meaning one thing once two foods are
 * involved**, so the merged panel carries neither: `servingGrams` is null and
 * `source` is `'estimated'`, the same call `recipeHelpingNutrition` already
 * makes about a dish's own figures and for the same reason — an entry built
 * from more than one measured amount is an estimate however good each of
 * those amounts was on its own.
 */
export function combineFoodNutrition(
  base: FoodNutrition,
  extras: readonly { nutrition: FoodNutrition }[],
  now: Date = new Date(),
): FoodNutrition {
  if (extras.length === 0) return base;
  const amounts: Partial<Record<NutrientKey, number>> = { ...base.amounts };
  for (const extra of extras) {
    for (const key of NUTRIENT_KEYS) {
      const amount = extra.nutrition.amounts[key];
      if (amount === undefined) continue;
      amounts[key] = round((amounts[key] ?? 0) + amount);
    }
  }
  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: base.servingText,
    amounts,
    source: 'estimated',
    sourceId: null,
    portions: [],
    recordedAt: now.toISOString(),
  };
}

/** What a run of entries came to, absent figures staying absent. */
export function foodLogTotals(entries: readonly FoodLogEntry[]): FoodLogTotals {
  const total: Partial<Record<NutrientKey, number>> = {};
  const reported: Partial<Record<NutrientKey, number>> = {};
  for (const entry of entries) {
    for (const key of NUTRIENT_KEYS) {
      const amount = entry.nutrition.amounts[key];
      if (amount === undefined) continue;
      total[key] = round((total[key] ?? 0) + amount);
      reported[key] = (reported[key] ?? 0) + 1;
    }
  }
  return { total, reported, entries: entries.length };
}

/**
 * A saved meal's total calories, or null when nothing in it states any —
 * same absent-versus-zero rule `foodLogTotals` keeps, just for one nutrient
 * and one meal rather than a whole day's report. This is a caption, not a
 * total somebody logs against, so it doesn't need the per-nutrient count
 * `foodLogTotals` carries.
 */
export function savedMealCalories(items: readonly SavedMealItem[]): number | null {
  let total: number | null = null;
  for (const item of items) {
    const amount = item.nutrition.amounts.calorieKcal;
    if (amount === undefined) continue;
    total = round((total ?? 0) + amount);
  }
  return total;
}

/**
 * A day's entries split into meals, in the order a day is read.
 *
 * A slot with nothing in it is dropped rather than rendered empty: a day with
 * no breakfast should not have a heading saying so. The unslotted run comes
 * last, since it is a catch-all rather than a time of day, and it is present
 * only when something is in it.
 */
export function foodLogSections(entries: readonly FoodLogEntry[]): FoodLogSection[] {
  // sortOrder first, since that's the hand-set position a drag leaves behind;
  // atISO only breaks a tie, which is every row that predates the column
  // (they all read as 0) and so keeps its original chronological order.
  const ordered = [...entries].sort((a, b) => a.sortOrder - b.sortOrder || a.atISO.localeCompare(b.atISO));
  const sections: FoodLogSection[] = [];
  for (const slot of MEAL_SLOTS) {
    const inSlot = ordered.filter(e => e.slot === slot);
    if (inSlot.length > 0) sections.push({ slot, entries: inSlot, totals: foodLogTotals(inSlot) });
  }
  const loose = ordered.filter(e => e.slot === null);
  if (loose.length > 0) sections.push({ slot: null, entries: loose, totals: foodLogTotals(loose) });
  return sections;
}

/**
 * One row of the day view's draggable list — a meal header or an entry. Only
 * `entry` rows are ever handed a drag handle; a header rides along as a fixed
 * landmark, same as Today's own section headers (see `CategoryListItem`).
 */
export type FoodLogListItem =
  | { type: 'header'; slot: MealSlot | null }
  | { type: 'entry'; entry: FoodLogEntry };

/**
 * What a drop hands back: each entry's new slot (the nearest header above it
 * after the drop) and its new position in the day's one running order.
 *
 * Mirrors `resolveDrop` in `taskGrouping.ts` — one rank shared across every
 * section rather than a per-section counter, which is what lets a single
 * `reorderEntries` call carry a row across a section boundary and reorder it
 * in the same drop. Every list this is called with is expected to open on a
 * header (built by `foodLogSections`), so there is no "above every header"
 * case to account for the way Today's uncategorized group is.
 */
export function resolveFoodLogDrop(items: readonly FoodLogListItem[]): FoodLogEntry[] {
  // Seeded from the first header rather than from null, because a drop *can*
  // land above every header: the list opens on one, and the gap above it is a
  // real drop target. Starting at null re-filed that entry as unslotted, and
  // since the loose run renders last, a row dragged to the very top of
  // Breakfast reappeared at the bottom of the day under "Other". Today's own
  // list dodges this by rendering its header-less group *first* (see
  // `makeCategoryGroups`), which this one can't: "Other" is a catch-all rather
  // than a time of day, so it belongs last. So the top gap joins the first
  // section instead, which is what the gesture was asking for.
  const firstHeader = items.find(item => item.type === 'header');
  let currentSlot: MealSlot | null = firstHeader?.type === 'header' ? firstHeader.slot : null;
  let rank = 0;
  const resolved: FoodLogEntry[] = [];
  for (const item of items) {
    if (item.type === 'header') { currentSlot = item.slot; continue; }
    rank += 1;
    resolved.push({ ...item.entry, slot: currentSlot, sortOrder: rank });
  }
  return resolved;
}

/** The nutrients a day's one-line summary leads with, same two the recipe line uses. */
const SUMMARY_KEYS: readonly NutrientKey[] = ['calorieKcal', 'proteinG'];

const SUMMARY_LABEL: Record<string, (amount: number) => string> = {
  calorieKcal: n => `${Math.round(n)} cal`,
  proteinG: n => `${Math.round(n)}g protein`,
};

/**
 * "1,840 cal, 78g protein, from 5 of 7 entries", or null while there is nothing
 * worth saying.
 *
 * **The coverage clause is not optional**, and is what stops the number reading
 * as the day's calorie count rather than as the count of what was logged and
 * measurable. It drops only when every entry stated the nutrient, exactly as
 * `describeRecipeNutrition` drops its own. Counted per nutrient rather than per
 * day, because a day where every entry has calories and three have fibre is
 * fully covered for one figure and not the other.
 */
export function describeFoodLogTotals(totals: FoodLogTotals): string | null {
  if (totals.entries === 0) return null;
  const parts = SUMMARY_KEYS
    .filter(key => totals.total[key] !== undefined)
    .map(key => SUMMARY_LABEL[key](totals.total[key] as number));
  if (parts.length === 0) return null;

  const covered = Math.min(...SUMMARY_KEYS
    .filter(key => totals.total[key] !== undefined)
    .map(key => totals.reported[key] ?? 0));
  const clause = covered === totals.entries
    ? ''
    : `, from ${covered} of ${totals.entries} ${totals.entries === 1 ? 'entry' : 'entries'}`;
  return `${parts.join(', ')}${clause}`;
}

/** One entry's stated amount of a nutrient, or `null` when it never said. */
export interface NutrientContribution {
  entry: FoodLogEntry;
  amount: number | null;
}

/**
 * What each of a run of entries put toward one nutrient, most first.
 *
 * This is `foodLogTotals` broken back out by entry, for the one place a total
 * needs to answer "which of these": the coverage clause on the day's card
 * says a figure speaks for 5 of 7 entries and nothing else there says which
 * five. An entry that never stated the nutrient sorts to the bottom rather
 * than being dropped, so the list still accounts for every entry the total's
 * coverage count is measured against.
 */
export function nutrientContributions(
  entries: readonly FoodLogEntry[],
  key: NutrientKey,
): NutrientContribution[] {
  return entries
    .map(entry => ({ entry, amount: entry.nutrition.amounts[key] ?? null }))
    .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
}

/**
 * How an entry's amount and provenance read on its row.
 *
 * The source is named rather than assumed because it decides what the figure
 * may be taken for: a label a manufacturer declared, a database's analysis, a
 * person's own transcription and a dish estimated from its ingredients are four
 * different claims, and the row is the only place a person can tell them apart.
 *
 * The day's water names no source (see the check below), since its figure
 * isn't a claim about a panel.
 *
 * `quantity` stands in for the stored words when the row has a better way to
 * say them: the day's water entry is written in millilitres and shown in the
 * unit the person picked (`waterEntryQuantity`).
 */
export function describeFoodLogEntry(entry: FoodLogEntry, quantity: string = entry.quantity): string {
  const calories = entry.nutrition.amounts.calorieKcal;
  const parts: string[] = [];
  if (quantity.trim()) parts.push(quantity.trim());
  if (calories !== undefined) parts.push(`${Math.round(calories)} cal`);
  // A nutrient logged on its own (the day's water, a task's sodium) carries no
  // provenance. Its `manual` source only records that no label or database was
  // asked, and "typed in" read as a claim about how this row got here: a glass
  // logged from a task, a stepper press or a bottle all land in the same row,
  // and the row can't tell them apart.
  if (!isNutrientOnlyEntry(entry)) parts.push(SOURCE_WORDS[entry.nutrition.source]);
  return parts.join(' · ');
}

/** What reopening an entry puts back in the entry sheet's amount field. */
export interface FoodLogEntryEdit {
  /** The text the amount field opens on. */
  amount: string;
  /** Which question a dish's amount field is asking. Null for a food. */
  dishMeasure: 'weight' | 'servings' | null;
}

/**
 * How an entry reopens for correction, or null when it cannot be reopened.
 *
 * **An amount is re-measured against the food's own panel, never multiplied out
 * of the stored figures.** What an entry holds is one helping: `basis` is
 * always `perServing`, the amounts are what was actually eaten, and `portions`
 * was emptied when the helping was built. So "make it 2 cups instead of 1" has
 * no arithmetic available to it here, and correcting an amount means running
 * `scalePanelToAmount` over the panel again. That panel is reachable through
 * the entry's own links, or through the one it kept (`sourcePanel`) when no
 * row holds it, and which of those exists is what decides the refusals below.
 *
 * **An unfiled database food keeps its panel on the entry and reopens on it**
 * (#2914). It is the database's own per-100 g record with its portions, so
 * re-measuring against it is exactly what re-measuring against a catalog row
 * is, and weighing out 170 g of chicken logged as 200 g is a correction rather
 * than a delete and a fresh search. A link wins over it: a linked entry is
 * re-measured against its row, the same as it always was.
 *
 * Four entries get null, and each is a case where an edit would have to invent
 * something:
 *
 * - **No link and no kept panel.** A described meal the model estimated, or a
 *   database food logged before entries kept their panel. There is nothing to
 *   measure a new amount against, and offering the figures as fields to
 *   retype would put an unmeasured panel into a health record. An estimate
 *   has its own narrower correction, `estimateAmountPatch`, which scales the
 *   figures the model stated by an amount the person chose and re-measures
 *   nothing.
 * - **Answered "Anything else?" lines.** What was typed against each varying
 *   line of a dish is not stored, only the line's name in `quantity`, so the
 *   sheet would reopen with them blank and a save would silently drop them.
 * - **A dish whose helping does not parse.** `describeHelping` writes the five
 *   phrasings read back below, and anything else means the amount field has no
 *   number to open on.
 * - **No amount recorded at all**, which nothing writes today and which would
 *   otherwise reopen on an empty field claiming to be the entry's own.
 *
 * `atISO` and `dayKey` stay out of this entirely, as `updateEntry` already
 * says: they were stamped together from one instant under one reset time, and
 * re-dating means a new entry.
 */
export function foodLogEntryEdit(entry: FoodLogEntry): FoodLogEntryEdit | null {
  if (entry.quantity.includes(', plus ')) return null;

  // The helping says how it was measured; `quantity` is the fallback for a row
  // written before a panel carried the text, and reads the same for a food.
  const typed = (entry.nutrition.servingText ?? entry.quantity).trim();
  if (!typed) return null;

  if (entry.recipeId) {
    const dish = dishAmountFrom(typed);
    return dish && { amount: dish.amount, dishMeasure: dish.dishMeasure };
  }
  if (entry.productId || entry.itemId || keptDatabasePanel(entry)) {
    // A scan logged with "The whole package (10 servings)" stores that button
    // label as its helping (`packageChoices` in scanPortion.ts), which has no
    // leading number to re-measure. The count inside it is the amount.
    const pkg = WHOLE_PACKAGE_LABEL.exec(typed);
    return { amount: pkg ? `${pkg[1]} servings` : typed, dishMeasure: null };
  }
  return null;
}

const WHOLE_PACKAGE_LABEL = /^the whole package \((\d+(?:\.\d+)?) servings\)$/i;

/**
 * The panel an entry keeps so its amount can be corrected later: the database's
 * own record while no catalog row holds it, else null (a linked entry is
 * re-measured against its row, and a stale kept panel is cleared). The one rule
 * `FoodLogEntrySheet.handleSave` and `remeasureEntry` both apply.
 */
export function panelToKeep(panel: FoodNutrition, linked: boolean): FoodNutrition | null {
  return linked ? null : panel;
}

/** The fields a re-measured entry takes, the ones `FoodLogEntrySheet.handleSave` hands `reviseEntry`. */
export interface RemeasuredFields {
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  sourcePanel: FoodNutrition | null;
}

/**
 * What an entry becomes when its amount is changed to `amount` ("23 g",
 * "2 servings"), for a caller with no sheet to type into: the same arithmetic
 * "Edit" runs, so an agent's correction and a thumb's land on the same figures.
 *
 * **The sheet's own steps, in its order.** `foodLogEntryEdit` decides whether
 * the app would reopen this entry at all; the panel is the linked row's
 * (`linkedPanel`, which the caller reads from the catalog because it holds the
 * rows) or else the one the entry kept (`keptDatabasePanel`); and
 * `scalePanelToAmount` measures the amount against that panel, never against
 * the figures already on the entry. Scaling the stored helping instead would
 * compound its rounding, and a helping has no portions to resolve "1 slice" by.
 * `sourcePanel` follows `handleSave`: kept only while no row holds the panel.
 *
 * A dish (`recipeId`) is refused: its helping is rebuilt from the recipe's
 * ingredients and the servings it makes, which this has no way to see.
 *
 * Returns the reason in words when it cannot, since each refusal is a different
 * thing for a person to do next.
 */
export function remeasureEntry(
  entry: FoodLogEntry,
  linkedPanel: FoodNutrition | null,
  amount: string,
  now: Date = new Date(),
): { ok: true; fields: RemeasuredFields; approximate: boolean } | { ok: false; reason: string } {
  if (entry.recipeId) return { ok: false, reason: 'This entry is a dish, whose amount is rebuilt from its recipe. Change it in the app.' };
  if (!foodLogEntryEdit(entry)) return { ok: false, reason: 'This entry has no food record to measure a new amount against (it was described rather than looked up, or answers extra lines). Change it in the app.' };
  const linked = !!(entry.itemId || entry.productId);
  const panel = linked ? linkedPanel : keptDatabasePanel(entry);
  if (!panel) return { ok: false, reason: 'The food record this entry was measured against is no longer there. Change it in the app.' };
  const typed = amount.trim();
  const scaled = typed ? scalePanelToAmount(panel, typed, null, now, entry.label) : null;
  if (!scaled) return { ok: false, reason: `"${typed}" cannot be measured against this food’s record. Try grams, or a portion it lists.` };
  return {
    ok: true,
    fields: { quantity: typed, grams: scaled.grams, nutrition: scaled.nutrition, sourcePanel: panelToKeep(panel, linked) },
    // A drink measured by assuming water's density; the sheet shows a
    // disclaimer beside it, so a caller has to be able to say so too.
    approximate: scaled.approximate,
  };
}

/**
 * The panel an entry kept that a new amount can be re-measured against, or
 * null when it kept none or kept an estimate's whole.
 *
 * **`sourcePanel` holds one of two different things** (#2914), and only the
 * first is something to measure with. For a database food nobody filed it is
 * the database's own per-100 g record with its portions, which measures a new
 * amount exactly as a catalog row's panel would. For an estimate it is the
 * whole meal as the model described it: the base "Change amount" scales
 * (`wholeEstimate`), with no amounts or portions to measure a weight
 * against. Every path that re-measures asks this rather than testing the
 * field, so the second is never read as the first: `foodLogEntryEdit` here,
 * and the Describe sheet's recall (`recallMeasuringPanel`).
 *
 * Says nothing about links. A linked entry is re-measured against its row
 * whatever it kept, and that is each caller's own check.
 */
export function keptDatabasePanel(entry: { sourcePanel?: FoodNutrition | null }): FoodNutrition | null {
  const kept = entry.sourcePanel;
  return kept && kept.source !== 'estimated' ? kept : null;
}

/**
 * The number and the measure behind one of `describeHelping`'s phrasings, or
 * `weighedHelping`'s weight.
 *
 * Read back rather than stored, because what a dish's amount field holds is a
 * bare number and the entry records the sentence it became. "The whole dish"
 * and "half the dish" are what an unserved dish says instead of a servings
 * count, and both are ordinary numbers to that field: `mealHelping` decides
 * which words to use from the dish, not from what was typed.
 */
function dishAmountFrom(text: string): { amount: string; dishMeasure: 'weight' | 'servings' } | null {
  const grams = /^(\d+(?:\.\d+)?) g$/.exec(text);
  if (grams) return { amount: grams[1], dishMeasure: 'weight' };
  if (text === 'the whole dish') return { amount: '1', dishMeasure: 'servings' };
  if (text === 'half the dish') return { amount: '0.5', dishMeasure: 'servings' };
  const ofDish = /^(\d+(?:\.\d+)?) of the dish$/.exec(text);
  if (ofDish) return { amount: ofDish[1], dishMeasure: 'servings' };
  const servings = /^(\d+(?:\.\d+)?) servings?$/.exec(text);
  if (servings) return { amount: servings[1], dishMeasure: 'servings' };
  return null;
}

/**
 * The most "Change amount" lets an estimate become, as a multiple of the whole
 * meal as estimated.
 *
 * A bound rather than a judgement about appetite: it is what keeps a count
 * typed with one digit too many ("30 slices" for 3) from landing in a health
 * record as ten times the meal. Past it the meal is a different one, and a
 * fresh description is the way to say so.
 */
export const MAX_ESTIMATE_MULTIPLE = 10;

/**
 * One amount "Change amount" offers an estimate whose words give no count
 * (`estimateCount`), and how the entry's amount says it.
 */
export interface EstimateAmount {
  /** Times the whole meal as estimated. */
  value: number;
  /** The segment's own label. */
  label: string;
  /** Read aloud, where the label is a glyph. */
  spoken: string;
  /**
   * What goes in front of the meal's own words ("half of 1 burger and a
   * regular fries", "twice a bowl of pho"). Empty for the whole.
   */
  words: string;
}

/**
 * The amounts of an estimated meal with no count of its own that can be said
 * to have been eaten, smallest first: the shares, the whole, then a few
 * multiples of it.
 *
 * A closed set rather than a typed number, because "about half" or "about
 * twice that" is the precision the estimate itself has: a model's figure for
 * a described meal is not improved by saying 0.47 of it. A meal whose words
 * do give a count ("2 slices") is asked for that count instead, which is the
 * more direct question and needs no set at all.
 */
export const ESTIMATE_AMOUNTS: readonly EstimateAmount[] = [
  { value: 1 / 4, label: '¼', spoken: 'A quarter', words: 'a quarter of' },
  { value: 1 / 3, label: '⅓', spoken: 'A third', words: 'a third of' },
  { value: 1 / 2, label: '½', spoken: 'Half', words: 'half of' },
  { value: 2 / 3, label: '⅔', spoken: 'Two-thirds', words: 'two-thirds of' },
  { value: 3 / 4, label: '¾', spoken: 'Three-quarters', words: 'three-quarters of' },
  { value: 1, label: 'All', spoken: 'All of it', words: '' },
  { value: 3 / 2, label: '1½×', spoken: 'One and a half times', words: 'one and a half times' },
  { value: 2, label: '2×', spoken: 'Twice', words: 'twice' },
  { value: 3, label: '3×', spoken: 'Three times', words: 'three times' },
];

/**
 * What an estimate's own words count, when they count one thing: "2 slices",
 * "1 burger", "3 tacos", "2 slices of pepperoni pizza".
 */
export interface EstimateCount {
  /** How many the words say: 2 out of "2 slices". */
  count: number;
  /** The noun or unit as written: "slices". */
  noun: string;
  /** Whatever followed it, verbatim: " of pepperoni pizza", or ''. */
  rest: string;
  /** Written as a decimal ("1.5 cups"), so a new count is written back the same way. */
  decimal: boolean;
  /**
   * A measure (grams, ounces, cups) rather than a count of things, which
   * changes how the question is put ("How much, in oz" rather than "How many
   * oz") and nothing else.
   */
  measure: boolean;
  /** How far one press of a stepper moves it: whole things, or halves of a small count. */
  step: number;
}

/** "of" and the name of the one thing counted: " of pepperoni pizza". */
const COUNTED_OF = /^\s+of\s+[a-z][a-z' -]*$/i;

/**
 * Words that make the tail more than one thing. "1 plate of rice and beans"
 * counts plates, but a plate is not what was estimated: the beans came with it.
 */
const MORE_THAN_ONE_THING = /\b(?:and|with|plus|or)\b/i;

/**
 * The count an estimate's words give, or null when they give none.
 *
 * **Only a count of one thing.** "2 slices" scales cleanly: 3 slices is one
 * and a half times the meal the model described, because the model described
 * two of the same slice. "1 burger and a regular fries" has a leading 1 as
 * well, but it counts only the burger, and "2 burger and a regular fries"
 * would double the fries while saying it hadn't. So the count has to be the
 * whole of the words, or the whole with "of" and one thing after it, and
 * anything else (a second food, a size word in front, a range, a sized
 * container, words with no number at all like "a bowl of pho") has none. An
 * estimate without one is offered `ESTIMATE_AMOUNTS` instead.
 *
 * Read through `parseQuantity`, so a count is read exactly as a recipe line's
 * amount is: "1 1/2 cups" and "1.5 cups" are both one and a half.
 */
export function estimateCount(words: string | null | undefined): EstimateCount | null {
  const text = (words ?? '').trim();
  if (!text) return null;
  const parsed = parseQuantity(text);
  if (parsed.amount === null || parsed.container || parsed.rangeMax || !parsed.unitWritten) return null;
  const count = rationalToNumber(parsed.amount);
  if (!(count > 0)) return null;
  const rest = parsed.trailing;
  if (rest && (!COUNTED_OF.test(rest) || MORE_THAN_ONE_THING.test(rest))) return null;
  return {
    count,
    noun: parsed.unitWritten,
    rest,
    decimal: parsed.decimal,
    measure: unitBase(parsed.unitWritten) !== null,
    step: Number.isInteger(count) && count >= 2 ? 1 : 0.5,
  };
}

/** Whether `unitKey`'s own table inflects this word, which then decides its number. */
function inflectsItself(word: string): boolean {
  return inflectUnit(word, 1) !== word || inflectUnit(word, 2) !== word;
}

/**
 * A count noun the unit table does not know, made plural or singular.
 *
 * `inflectUnit` passes an unknown word through untouched on purpose ("1 bulb"
 * doubles to "2 bulb"), which suits a recipe line, whose unit is the cook's
 * own word. It does not suit this: the noun is what the question is asked in
 * ("How many burgers?") and what the log row then says, and "2 burger" reads
 * as a typo in both. These are the plain English rules and they are only ever
 * run in the one direction the count actually moved.
 *
 * Making a word singular is where the rules are least sure, so it is the
 * narrower of the two: "-ies" loses only its "s" ("cookies", "pies",
 * "brownies" outnumber "patties" on a plate).
 */
function pluralNoun(word: string): string {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function singularNoun(word: string): string {
  if (/(?:ch|sh|x|ss|zz|o)es$/i.test(word)) return word.slice(0, -2);
  if (/[^s]s$/i.test(word) && !/(?:us|is)$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** The count's noun agreeing with `n`, in the form it would be written. */
export function estimateCountNoun(count: EstimateCount, n: number): string {
  const { noun } = count;
  if (count.measure || inflectsItself(noun)) return inflectUnit(noun, n);
  // Written grammatically for its own count, so it only changes when the new
  // count crosses one.
  if ((n > 1) === (count.count > 1)) return noun;
  return n > 1 ? pluralNoun(noun) : singularNoun(noun);
}

/** "3 slices", or "3 slices of pepperoni pizza": `n` of what the estimate counted. */
export function describeEstimateCount(count: EstimateCount, n: number): string {
  return `${formatQuantityAmount(n, count.decimal)} ${estimateCountNoun(count, n)}${count.rest}`;
}

/**
 * The question "Change amount" asks for a counted estimate: "How many slices"
 * for things, "How much, in oz" for a measure (where "How many g" would read
 * as a typo).
 */
export function estimateCountQuestion(count: EstimateCount): string {
  const plural = estimateCountNoun(count, 2);
  return count.measure ? `How much, in ${plural}` : `How many ${plural}`;
}

/**
 * The entry fields `wholeEstimate` reads: a logged entry has them all, and so
 * does a food the Describe sheet recalls from the log (`RecalledFood`).
 */
export type EstimatedHelping = Pick<FoodLogEntry, 'recipeId' | 'itemId' | 'productId' | 'nutrition' | 'quantity' | 'grams'>
  & { sourcePanel?: FoodNutrition | null };

/**
 * The whole meal an estimated entry described, which "Change amount" scales,
 * or null for an entry that cannot be changed that way.
 *
 * **Only an estimate linked to nothing.** A linked entry is corrected by
 * re-measuring against its row (`foodLogEntryEdit`), and so is a database food
 * that kept its panel. What is left is the described meal, which has no panel
 * to re-measure against and so, until this, had no correction but a rename.
 *
 * **The whole is the estimate as first logged, not the helping stored now.**
 * The first change keeps the whole estimate in `sourcePanel`, and every later
 * one is a multiple of that rather than of the last one. So a half chosen by
 * mistake is undone by choosing All (or the count the model described), and a
 * half then a three-quarters is three-quarters of the meal rather than
 * three-eighths of it. Scaling the stored helping each time would have lost
 * the model's own figures for good the first time, with only a division by a
 * rounded number to get them back.
 */
export function wholeEstimate(entry: EstimatedHelping): FoodNutrition | null {
  if (entry.recipeId || entry.itemId || entry.productId) return null;
  if (entry.nutrition.source !== 'estimated') return null;
  const kept = entry.sourcePanel;
  if (kept) return kept.source === 'estimated' ? kept : null;
  // Nothing changed yet, so the helping is the whole. Its words and weight are
  // carried onto the copy that will be kept, from wherever the entry holds
  // them, so a later change can still say what it is a multiple of.
  return {
    ...entry.nutrition,
    servingText: entry.nutrition.servingText?.trim() || entry.quantity.trim() || null,
    servingGrams: entry.nutrition.servingGrams ?? entry.grams,
  };
}

/** A weight the words open with: "56 g (15g pepitas, 27g walnuts)". */
const LEADING_GRAMS = /^\s*(\d+(?:[.,]\d+)?)\s*(?:g|grams?)\b/i;

/**
 * The weight of the whole estimated meal, for asking "how many grams" about it,
 * or null when nothing states one.
 *
 * Read from the stored weight first, then from a weight the meal's own words
 * open with. Estimates store no weight (`estimateToPanel` keeps it null so none
 * is invented), but a description like "mixed nuts (15g pepitas, 27g walnuts)"
 * comes back as "56 g (15g pepitas, ...)", and that figure is the person's own
 * and the model's sum of them. Words that merely count a weight ("56 g") are
 * `estimateCount`'s and never reach here.
 */
export function estimateWholeGrams(whole: FoodNutrition): number | null {
  if (whole.servingGrams && whole.servingGrams > 0) return whole.servingGrams;
  const match = LEADING_GRAMS.exec(whole.servingText ?? '');
  const grams = match ? parseFloat(match[1].replace(',', '.')) : NaN;
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

/** What "Change amount" writes: the new helping, and the whole it was scaled from. */
export interface EstimateAmountPatch {
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  sourcePanel: FoodNutrition;
}

/** Whether `a` and `b` are the same multiple, past the dust division leaves. */
function sameFactor(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/**
 * How a multiple of an estimate is said: in its own count when its words give
 * one ("3 slices"), or in words in front of them ("half of 1 burger and a
 * regular fries", "twice a bowl of pho").
 */
export function estimateAmountWords(wholeWords: string, factor: number): string {
  const base = wholeWords.trim();
  const count = estimateCount(base);
  if (count) return describeEstimateCount(count, count.count * factor);
  const preset = ESTIMATE_AMOUNTS.find(a => sameFactor(a.value, factor));
  const lead = preset
    ? preset.words
    : factor < 1 ? `${Math.round(factor * 100)}% of` : `${formatQuantityAmount(factor)} times`;
  // With no words of its own to scale, the amount stands alone.
  if (!base) return lead.replace(/ of$/, '');
  return lead ? `${lead} ${base}` : base;
}

/**
 * An estimated entry changed to a multiple of what it described, or null when
 * the entry can't be changed that way or the multiple isn't one.
 *
 * **The one correction here that multiplies stored figures rather than
 * re-measuring them**, and the exception is narrow on purpose. "Re-measured,
 * never multiplied" exists because a measured helping's figures are one
 * amount's worth of a food with a real panel behind it, so scaling them claims
 * a measurement of the new amount that nobody made; the panel was right
 * there to be measured against instead. An estimate has no such panel, and
 * its figures were never a measurement: they are the model's guess at a meal
 * of a stated size. Three slices of a meal estimated as two is that same
 * guess at a meal half as big again, which is every figure the model stated,
 * times a number the person chose, and no nutrient appears that the estimate
 * did not state. Going up claims nothing more than going down does, so either
 * direction is allowed, up to `MAX_ESTIMATE_MULTIPLE`. The source stays
 * `estimated` and the figures keep the moment they were estimated at.
 *
 * The factor is always of the whole meal as estimated (`wholeEstimate`),
 * never of the helping stored now, and 1 returns that whole exactly, figures
 * untouched rather than rounded again, so choosing All (or the count the
 * model described) puts the entry back as it was logged.
 */
export function estimateAmountPatch(entry: EstimatedHelping, factor: number): EstimateAmountPatch | null {
  const whole = wholeEstimate(entry);
  if (!whole) return null;
  if (!Number.isFinite(factor) || factor <= 0 || factor > MAX_ESTIMATE_MULTIPLE + 1e-9) return null;

  const base = whole.servingText?.trim() ?? '';
  if (sameFactor(factor, 1)) {
    return { quantity: base, grams: whole.servingGrams, nutrition: whole, sourcePanel: whole };
  }

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = whole.amounts[key];
    if (amount !== undefined) amounts[key] = round(amount * factor);
  }
  const quantity = estimateAmountWords(base, factor);
  const grams = whole.servingGrams !== null ? Math.round(whole.servingGrams * factor) : null;
  return {
    quantity,
    grams,
    nutrition: { ...whole, servingText: quantity, servingGrams: grams, amounts },
    sourcePanel: whole,
  };
}

/** Whether two sets of stated figures are the same figures. */
function sameAmounts(a: FoodNutrition['amounts'], b: FoodNutrition['amounts']): boolean {
  return NUTRIENT_KEYS.every(key => a[key] === b[key]);
}

/**
 * How many times the whole meal as estimated an entry stands at now, or null
 * when it can't be changed that way or its figures are no multiple of it.
 *
 * Worked out by trying multiples and comparing figures, rather than stored,
 * so there is no second record of the choice to fall out of step with the
 * figures Health was told. The candidates, in order: the whole (so figures
 * every multiple agrees on, an estimate of nothing but zeros, read as the
 * whole), the count the entry's own words say when that is what the change
 * wrote, each preset, and last whatever one stated figure divides out to.
 */
export function currentEstimateFactor(entry: EstimatedHelping): number | null {
  const whole = wholeEstimate(entry);
  if (!whole) return null;
  const candidates: number[] = [1];
  const count = estimateCount(whole.servingText);
  const said = (entry.nutrition.servingText ?? entry.quantity).trim();
  const saidCount = count ? estimateCount(said) : null;
  if (count && saidCount && describeEstimateCount(count, saidCount.count) === said) {
    candidates.push(saidCount.count / count.count);
  }
  candidates.push(...ESTIMATE_AMOUNTS.map(a => a.value));
  const key = NUTRIENT_KEYS.find(k => (whole.amounts[k] ?? 0) > 0);
  const now = key ? entry.nutrition.amounts[key] : undefined;
  if (key && now !== undefined) candidates.push(now / whole.amounts[key]!);

  for (const factor of candidates) {
    const patch = estimateAmountPatch(entry, factor);
    if (patch && sameAmounts(patch.nutrition.amounts, entry.nutrition.amounts)) return factor;
  }
  return null;
}

/**
 * The count a counted estimate stands at now ("3" for an entry changed to 3
 * slices of a 2-slice estimate), or null when its words give no count or its
 * figures are no multiple of the whole.
 *
 * Rounded past the dust a division leaves, so a stepper opened on it shows 3
 * rather than 3.0000000000000004.
 */
export function currentEstimateCount(entry: EstimatedHelping): number | null {
  const whole = wholeEstimate(entry);
  const count = whole ? estimateCount(whole.servingText) : null;
  const factor = count ? currentEstimateFactor(entry) : null;
  if (!count || factor === null) return null;
  return Math.round(count.count * factor * 1e6) / 1e6;
}

/**
 * Whether a patch would leave the entry as it is: the same figures under the
 * same words, so there is nothing to retract from Health and write again.
 */
export function estimateAmountUnchanged(entry: EstimatedHelping, patch: EstimateAmountPatch): boolean {
  return sameAmounts(patch.nutrition.amounts, entry.nutrition.amounts) && patch.quantity === entry.quantity.trim();
}

/**
 * Which planned meal a manually-typed entry probably belongs to, if any.
 *
 * `FoodLogEntry.mealPlanEntryId` is stamped for free when a log starts from
 * `offerMealLog`'s prompt, but a food typed straight into the plain log never
 * gets one — a known, accepted gap `mealLogNudgeTasks.ts` already names
 * ("logged by hand", the same shape `mealPlanEntryId`'s own doc comment calls
 * "resolve-or-shrug"). This is the other half of that shrug: a caller with a
 * day's plan entries in hand can offer a confident guess instead of leaving
 * the field null forever.
 *
 * Deliberately conservative — a wrong guess re-points a real record, so this
 * only answers when unambiguous:
 * - `alreadyLinked` excludes any plan entry a food log row already claims,
 *   so a second lunch logged the same day doesn't steal the first one's slot.
 * - A `recipeId` in common decides it outright when it points at exactly one
 *   remaining candidate; more than one (a recipe cooked twice today) is
 *   treated as no signal rather than guessed at.
 * - Otherwise the day's `slot` alone has to name exactly one remaining
 *   candidate. A `slot` of `null` (the sheet's "no meal" option) never
 *   matches anything — there is nothing to be confident about.
 *
 * Takes plain data rather than reaching into a store, same restraint this
 * module's own doc comment states for `recipeNutrition.ts`: the caller reads
 * the day's plan entries and its own already-logged rows, and this stays
 * exercisable with no database standing up behind it.
 */
export function matchMealPlanEntry(
  dayPlan: MealPlanEntry[],
  alreadyLinked: ReadonlySet<string>,
  logged: { slot: MealSlot | null; recipeId: string | null },
): MealPlanEntry | null {
  const unclaimed = dayPlan.filter(entry => !alreadyLinked.has(entry.id));
  if (unclaimed.length === 0) return null;

  if (logged.recipeId) {
    const byRecipe = unclaimed.filter(entry => entry.recipeId === logged.recipeId);
    if (byRecipe.length === 1) return byRecipe[0];
    if (byRecipe.length > 1) return null;
  }

  if (!logged.slot) return null;
  const bySlot = unclaimed.filter(entry => entry.slot === logged.slot);
  return bySlot.length === 1 ? bySlot[0] : null;
}

/**
 * The planned meal a recipe logged from its own page belongs to, or null.
 *
 * The recipe page's log button raises the after-meal prompt with no meal of
 * the day and no plan entry, so tonight's dinner logged from the page filed
 * under no meal, left the plan reading unlogged (`mealLogCoverage.ts` joins on
 * the slot), and the Eat step offered to log it again. This is
 * `matchMealPlanEntry` asked with the recipe alone: one unclaimed entry for it
 * on the day's plan links, and anything else (none, or the dish planned twice)
 * is no answer rather than a guess. `dayLog` is the day's food log, whose
 * links say which plan entries are already claimed.
 */
export function plannedEntryForRecipe(
  dayPlan: MealPlanEntry[],
  dayLog: readonly FoodLogEntry[],
  recipeId: string,
): MealPlanEntry | null {
  const alreadyLinked = new Set(
    dayLog.map(e => e.mealPlanEntryId).filter((id): id is string => id != null),
  );
  return matchMealPlanEntry(dayPlan, alreadyLinked, { slot: null, recipeId });
}

/**
 * The instant an entry logged against `dayKey` is stamped with.
 *
 * The logical today logs at the real moment; any other day logs at midday,
 * which is inside that logical day whichever way the reset time falls (the
 * reasoning `getLogicalToday` uses for noon). One rule for every path that
 * logs against a day rather than a clock: the food log's own picker, the
 * after-meal prompt and the search sheet a planned meal opens. The last two
 * used to stamp noon unconditionally, so tonight's dinner reached Apple
 * Health as lunch, and a breakfast logged at 8 AM as four hours from now.
 *
 * `todayKey` is passed in rather than read here, so this module stays free of
 * the settings store `dateUtils` reaches for.
 */
export function logInstantFor(dayKey: string, todayKey: string, now: Date = new Date()): Date {
  if (dayKey === todayKey) return new Date(now);
  const noon = new Date(`${dayKey}T00:00:00`);
  noon.setHours(12, 0, 0, 0);
  return noon;
}

/**
 * How each provenance reads on a row.
 *
 * All four are named, not just `estimated`. The doc above says the row is the
 * only place a person can tell these apart, and naming one of them left the
 * other three indistinguishable — a transcription off a jar read exactly like
 * a manufacturer's declared label, which is the distinction the record keeps
 * `FoodNutrition.source` for in the first place.
 *
 * Plain phrases rather than the source's own name, since "fdc" and
 * "openFoodFacts" are facts about where the app looked rather than about what
 * the figures are. Nothing here ranks them: a panel typed off a packet in your
 * hand is a perfectly good record. See `SourceMix` in `nutritionStats.ts`,
 * which makes the same point at length about the same four.
 */
const SOURCE_WORDS: Record<FoodNutrition['source'], string> = {
  openFoodFacts: 'from the label',
  fdc: 'from a database',
  manual: 'typed in',
  estimated: 'estimated',
};

/**
 * Whether the add sheet's search text, with nothing picked yet, is worth a
 * discard confirm. A food's name ("egg", "oat milk") costs nothing to retype
 * and confirming over it would put a prompt on every look-and-cancel; a
 * description of a meal ("chicken burrito with rice and guacamole") is the
 * text the Estimate path reads, and losing it to a swipe-down was silent.
 * Three words is where the field stops reading as a name and starts reading
 * as a description.
 */
export function isDescriptionDraft(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length >= 3;
}

/**
 * "from 3 of 7 entries" when only some of a day's food stated a nutrient, and
 * null when every one did (or none could). The totals card shows one row per
 * nutrient, and a fiber row summed from three of seven entries otherwise reads
 * as the day's fiber; `describeFoodLogTotals` says the same for its one-line
 * summary. Water rows are left out of the count: they state water and nothing
 * else by definition, so "from 4 of 5" for calories would be blaming a glass
 * of water for not having any.
 */
export function totalCoverageNote(
  entries: readonly FoodLogEntry[],
  key: NutrientKey,
): string | null {
  if (key === 'waterMl') return null;
  const food = entries.filter(e => !isWaterEntry(e));
  const reported = food.filter(e => e.nutrition.amounts[key] !== undefined).length;
  if (reported === 0 || reported === food.length) return null;
  return `from ${reported} of ${food.length} ${food.length === 1 ? 'entry' : 'entries'}`;
}
