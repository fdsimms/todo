import type { FoodNutrition, FoodPortion } from '../types';
import { parseQuantity, rationalToNumber, unitKey, type Quantity } from './quantity';
import { measureParsedQuantity, unitBase } from './unitConvert';

/**
 * How much a recipe line actually weighs, or nothing at all.
 *
 * **The piece everything downstream is only as honest as.** Nutrient figures
 * are per 100 grams; a recipe line is written in whatever the recipe felt like.
 * Relating the two is the whole problem, and getting it wrong is not a rounding
 * error — a cup of flour read as a cup of honey is off by nearly a factor of
 * three, and the resulting calorie count looks entirely ordinary. So this
 * module answers grams or it answers null, and null is the common case rather
 * than a failure.
 *
 * **Every weight comes from the food's own portion table.** There is no global
 * density constant here and there must never be one: "most things are about
 * 1 g/ml" is wrong at both ends of the shelf while being plausible in the
 * middle, which is the worst way for this to be wrong. What a cup of a given
 * food weighs is a fact about that food, and `FoodPortion` is where FoodData
 * Central's answer to it is kept.
 *
 * **A refusal is reported, never silently zero**, the same call `costLine`
 * makes in `recipeCost.ts` — the module this one is shaped after, and worth
 * reading first. The rollup above has to be able to say "from 6 of 9
 * ingredients", which it can only do if each line comes back either related or
 * explicitly not.
 */

/** How far two of a food's own portions may disagree on density and still be treated as agreeing. */
const DENSITY_AGREEMENT = 1.05;

/**
 * A portion label reduced to comparable words.
 *
 * The parenthetical goes because FoodData Central writes dimensions into it —
 * `medium (2-1/2" dia)` — which describe the portion rather than name it, and
 * commas become spaces because `cup, chopped` and `tbsp chopped` are the same
 * shape written two ways in the same table.
 *
 * Every word is keyed through `unitKey`, so a line saying "cloves" meets a
 * label saying "clove".
 */
function labelWords(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(unitKey);
}

/** What one of a portion's stated units weighs — its `amount` is not always 1 ("10 rings = 60g"). */
function gramsPerUnit(portion: FoodPortion): number {
  return portion.grams / portion.amount;
}

/**
 * A portion's density in grams per millilitre, or null when it doesn't name a
 * volume.
 *
 * **This is a density derived from the food's own table, which is the only kind
 * allowed here.** Onion's "1 cup, chopped = 160g" says a chopped cup of *onion*
 * is 0.68 g/ml, and it is what lets a line written in tablespoons be answered
 * when the table only lists cups. FoodData Central's own numbers agree across
 * those rows (a tablespoon of chopped onion is 10g, which is the cup's 160
 * over sixteen), so this is reading the table rather than extrapolating past
 * it.
 */
function densityOf(portion: FoodPortion): number | null {
  const words = labelWords(portion.label);
  if (words.length === 0) return null;
  const unit = unitBase(words[0]);
  if (!unit || unit.dimension !== 'volume' || unit.base <= 0) return null;
  return gramsPerUnit(portion) / unit.base;
}

/**
 * The one portion `words` names, or null when the table can't say which.
 *
 * Three passes, narrowing only when it has to. An exact label match wins
 * outright, which is what keeps "2 medium onions" off the `slice, medium` row
 * sitting beside plain `medium` in the same table. Failing that, a single
 * label containing the word answers. Failing *that*, the line's own prep
 * clause is the tie-breaker, because `cup, chopped` and `cup, sliced` are a
 * real 45g apart for onion and the recipe already said which one it meant.
 *
 * Anything still ambiguous is refused. Substituting a medium onion for the
 * large one the recipe asked for is exactly the silent wrongness this whole
 * module is arranged to avoid.
 */
function pickPortion(
  candidates: readonly FoodPortion[],
  token: string,
  prep: string | null,
): FoodPortion | null {
  if (candidates.length === 0) return null;

  const exact = candidates.filter(p => {
    const words = labelWords(p.label);
    return words.length === 1 && words[0] === token;
  });
  if (exact.length === 1) return exact[0];

  const containing = exact.length > 1 ? exact : candidates;
  if (containing.length === 1) return containing[0];

  const prepWords = prep ? labelWords(prep) : [];
  if (prepWords.length === 0) return null;
  const matched = containing.filter(p => {
    const words = labelWords(p.label);
    return prepWords.every(w => words.includes(w));
  });
  return matched.length === 1 ? matched[0] : null;
}

/**
 * Grams for a line written as a volume, using the food's own density.
 *
 * When several of the food's portions name a volume and they agree on density,
 * any of them answers — a table listing cups and tablespoons of the same
 * chopped onion is one fact written twice. When they *disagree*, they are
 * describing different preparations and the prep clause has to say which,
 * because a sliced cup and a chopped cup of the same onion are not the same
 * weight.
 */
function agreedDensity(
  candidates: readonly { portion: FoodPortion; density: number }[],
): number | null {
  if (candidates.length === 0) return null;
  const densities = candidates.map(c => c.density);
  const low = Math.min(...densities);
  const high = Math.max(...densities);
  if (low <= 0 || high / low > DENSITY_AGREEMENT) return null;
  return densities[0];
}

function gramsFromVolume(
  millilitres: number,
  portions: readonly FoodPortion[],
  prep: string | null,
): number | null {
  const withDensity = portions
    .map(p => ({ portion: p, density: densityOf(p) }))
    .filter((p): p is { portion: FoodPortion; density: number } => p.density !== null);

  // Agreement is asked for before the prep clause is, because a table listing
  // cups *and* tablespoons of one chopped onion is one fact written twice —
  // and asking for a single matching row would refuse that, which is a
  // refusal with nothing behind it.
  const agreed = agreedDensity(withDensity);
  if (agreed !== null) return millilitres * agreed;

  const prepWords = prep ? labelWords(prep) : [];
  if (prepWords.length === 0) return null;
  const matched = withDensity.filter(p => {
    const words = labelWords(p.portion.label);
    return prepWords.every(w => words.includes(w));
  });
  const settled = agreedDensity(matched);
  return settled === null ? null : millilitres * settled;
}

/**
 * What one recipe line weighs in grams, or null when it can't be said honestly.
 *
 * `quantity` is already parsed rather than raw text, deliberately: this is not
 * meant to become another reader of quantity strings, and the refusals
 * `parseQuantity` already makes (the `x2` notation, a percentage, "a pinch")
 * arrive here as `amount: null` rather than being re-derived.
 *
 * The rules, in the order they apply:
 *
 * 1. **A range takes its low end.** `parseQuantity` keeps the low end in
 *    `amount` already, so this only has to stop `measureParsedQuantity`
 *    refusing the line outright. The low end matches what `stepTimers` decided
 *    for durations and is the conservative direction for a calorie count.
 * 2. **Mass is free**, and needs no portion table: a line already written in
 *    grams or pounds is a weight.
 * 3. **Volume needs a portion naming a volume**, and refuses without one.
 * 4. **A count needs a portion naming that same word**, size included, and
 *    refuses without one.
 * 5. **Everything else refuses** — a bare count with no size word among sized
 *    portions, a counted container, an unparseable amount.
 */
export function gramsForLine(
  quantity: Quantity,
  prep: string | null,
  portions: readonly FoodPortion[],
): number | null {
  if (quantity.amount === null) return null;
  const value = rationalToNumber(quantity.amount);
  if (value <= 0) return null;

  // The low end of a range is a real amount, where `measureParsedQuantity`
  // refuses the pair outright — it is measuring how much a line calls for,
  // and this is choosing which end to believe.
  const single: Quantity = quantity.rangeMax ? { ...quantity, rangeMax: null } : quantity;

  const measured = measureParsedQuantity(single);
  if (measured?.dimension === 'mass') return measured.base;
  if (portions.length === 0) return null;
  if (measured?.dimension === 'volume') return gramsFromVolume(measured.base, portions, prep);

  // A counted container ("2 14 oz cans") names how many tins, not how much is
  // in one, and its words would otherwise be hunted for in the portion table.
  // A *bare* sized container is a real weight and was measured above.
  if (single.container) return null;

  // Neither a mass nor a volume, so the line is a count and the word beside
  // the number is what has to be found in the table.
  if (single.unit) {
    const token = unitKey(single.unit);
    const named = portions.filter(p => labelWords(p.label).includes(token));
    const portion = pickPortion(named, token, prep);
    return portion ? value * gramsPerUnit(portion) : null;
  }

  /**
   * A bare count — "1 lemon", "2 chicken breasts" — which names no size at
   * all. A third of the recipe lines in the demo seed are this shape, so
   * refusing them outright costs more coverage than every other rule here
   * combined.
   *
   * **It is answerable exactly when the food describes one whole item and no
   * others.** A table holding only "1 fruit = 58g" is not being substituted
   * for anything: the recipe named no size and the food offers no choice, so
   * there is nothing to get wrong. A table holding small, medium and large is
   * the opposite case and is refused, which is the same call rule 4 makes
   * about "2 large onions" against a medium-only table.
   *
   * Volume rows are out of the running because a bare count is not a measure
   * of volume: "1 onion" is not one cup of onion.
   */
  const wholeItem = portions.filter(p => densityOf(p) === null);
  return wholeItem.length === 1 ? value * gramsPerUnit(wholeItem[0]) : null;
}

/**
 * How many hundred units of a food's panel one line amounts to, or null.
 *
 * **Here rather than in `recipeNutrition.ts`, where it started.** Two callers
 * need it now, the recipe rollup and the food log, and a helping scaled by one
 * rule in one and another rule in the other is two different calorie counts for
 * one plate of food. It also has to live somewhere that reaches no store: this
 * module and the two it imports are pure, where `recipeNutrition` pulls in the
 * meal plan and through it the settings store and SQLite, which is not
 * something a figure-scaling helper should drag behind it.
 *
 * **The line is measured in the panel's own unit, never converted into it.**
 * A per-100g panel wants grams, a per-100ml panel wants millilitres, and
 * turning one into the other needs a density this app does not have. So a
 * volume line against a per-100g food goes through the food's own portion
 * table (`gramsForLine`), and a per-100ml food is answered only by a line that
 * is itself a volume. Anything else refuses, which is the whole posture.
 *
 * A per-serving panel needs a serving to weigh something, since otherwise
 * "how many servings is 300g" has no answer.
 */
export function panelMultiplier(
  quantity: string,
  prep: string | null,
  nutrition: FoodNutrition,
): number | null {
  const parsed = parseQuantity(quantity);

  if (nutrition.basis === 'per100ml') {
    const single = parsed.rangeMax ? { ...parsed, rangeMax: null } : parsed;
    const measured = measureParsedQuantity(single);
    if (!measured || measured.dimension !== 'volume') return null;
    return measured.base / 100;
  }

  const grams = gramsForLine(parsed, prep, nutrition.portions);
  if (grams === null) return null;
  if (nutrition.basis === 'per100g') return grams / 100;
  // perServing
  return nutrition.servingGrams ? grams / nutrition.servingGrams : null;
}
