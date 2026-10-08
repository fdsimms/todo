import type { FoodLogEntry } from '../types';
import { isNutrientOnlyEntry } from './nutrientLog';

/**
 * How many servings of vegetables and fruit a day of food log entries holds.
 *
 * **Derived at read time and never stored.** A name in a lexicon decides what
 * counts, so fixing the lexicon fixes every past day too, which is right for a
 * classification and wrong for a nutrient figure (those are snapshotted at log
 * time, see `FoodLogEntry.nutrition`). Nothing is written and nothing leaves the
 * device.
 *
 * **The unit is a weight, not a cup.** One serving is 80 g, the "5 a day" portion
 * (WHO's 400 g a day over five). Entries already carry `grams`, and a volume
 * would need a density per food. The two special cases are the NHS's own:
 * dried fruit counts at 30 g a serving (the same fruit with the water taken out),
 * and beans and pulses count as a vegetable but never for more than one serving a
 * day, however much is eaten.
 *
 * **What does not count is named, not an oversight.** White potato (a starch, so
 * the "5 a day" rule leaves it out; sweet potato counts), juice, jam, sauce and
 * chips (processed), and herbs, garlic and ginger (seasoning). An onion is not on
 * that list: it counts by what it weighs, so a handful in a stew is a fraction of
 * a serving rather than a refusal.
 *
 * **A food not named as produce counts as none, and that is the main limit.**
 * "Chicken" is silently zero, though a plate can hold anything. The one thing
 * that widens what a name can say is the database category an entry kept when
 * it logged a food from the food database (`FoodNutrition.foodCategory`, read
 * from `entry.sourcePanel`). It covers only that case: an entry linked to a
 * catalog row, or typed by hand, has no category and goes by its name. What the reader
 * *can* say is when it knows it is missing something, which is `unmeasured`: a
 * produce food with no weight, a mixed dish ("salad", "stir fry") with no recipe
 * behind it, a recipe whose ingredients could not be weighed. A caller shows that
 * count beside the figure so a low number reads as "could not tell" rather than
 * "ate little". The same posture `nutritionStats.ts` takes on a day nobody
 * logged.
 *
 * **Counts, never a score.** `nutritionStats.ts` states why. Nothing here
 * judges a day against a target. The one exception is the Food log's bar
 * toward the fixed 5 a day (`dailyProduceProgress`): neutral accent, no status
 * colour, nothing that changes when it fills.
 *
 * Store-free and node-testable. The recipe half (which needs the catalog and the
 * recipe walk) is `recipeProduce.ts`, so this file reaches no store.
 */

/** One 5-a-day portion, in grams. */
export const PORTION_GRAMS = 80;
/** Dried fruit has the water taken out, so the same serving weighs less. */
export const DRIED_PORTION_GRAMS = 30;
/** Beans and pulses count once a day, however many are eaten. */
export const LEGUME_DAILY_CAP = 1;

export type ProduceKind = 'vegetable' | 'fruit' | 'dried' | 'legume';

/** Grams eaten of each kind, before any serving size or cap is applied. */
export type ProduceGrams = Record<ProduceKind, number>;

export function emptyProduceGrams(): ProduceGrams {
  return { vegetable: 0, fruit: 0, dried: 0, legume: 0 };
}

export interface ProduceServings {
  vegetable: number;
  fruit: number;
}

/** What one day came to, and how much of it the reader could not weigh. */
export interface DayProduce extends ProduceServings {
  /** Entries that named produce, or a dish that holds some, but could not be weighed. */
  unmeasured: number;
}

/**
 * Lowercase word stems. Plurals are folded by `stem`, and the lists below go
 * through it too, so "tomatoes" and "tomato" are one entry whichever is written.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

function stems(words: string): Set<string> {
  return new Set(words.split(/\s+/).filter(Boolean).map(stem));
}

function tokensOf(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter(Boolean).map(stem);
}

/** A processed form of produce, which the 5-a-day rule leaves out. */
const PROCESSED = stems(
  'juice jam jelly jelli sauce paste ketchup chip fry crisp candy cake pie bread muffin cookie '
  + 'syrup oil powder flavored flavoured soda cordial puree preserve marmalade gummy snack leather '
  + 'bar cereal yogurt yoghurt',
);

/** Names that stand for a dish with produce somewhere in it, in an amount the name does not say. */
const MIXED = stems(
  'salad soup stew stir curry smoothie bowl wrap sandwich burrito taco pizza pasta casserole '
  + 'chili chilli stirfry ratatouille slaw coleslaw',
);

/** Seasoning: counted nowhere, by the user's rule, whatever the weight. */
const SEASONING = stems(
  'garlic ginger basil parsley cilantro coriander mint chive dill thyme rosemary oregano sage '
  + 'tarragon herb',
);

const DRIED_MARKERS = stems('dried dehydrated raisin prune sultana medjool');

const LEGUMES = stems('lentil chickpea garbanzo edamame');

/** A bean that is a vegetable, or is not food at all, rather than a pulse. */
const NON_PULSE_BEAN = stems('green string runner french snap jelly coffee vanilla cocoa');

const VEGETABLES = stems(
  'broccoli carrot spinach kale lettuce cabbage cauliflower zucchini courgette cucumber tomato '
  + 'celery asparagus mushroom eggplant aubergine beet beetroot radish turnip squash pumpkin '
  + 'corn pea parsnip leek fennel artichoke arugula rocket chard bok choy sprout kohlrabi okra '
  + 'watercress collard onion scallion shallot yam rutabaga swede jicama cress endive radicchio '
  + 'veg veggie vegetable jalapeno poblano serrano',
);

const FRUITS = stems(
  'apple banana orange grape strawberry blueberry raspberry blackberry berry pear peach plum '
  + 'nectarine apricot cherry mango pineapple melon watermelon cantaloupe kiwi grapefruit '
  + 'tangerine clementine mandarin pomegranate fig papaya guava avocado cranberry persimmon '
  + 'lychee fruit',
);

/**
 * What a name is, for counting.
 *
 * Null is "not produce, or not a kind this counts", and `'mixed'` is "a dish
 * whose produce this cannot weigh from the name". Order matters and is the whole
 * rule: a processed form beats the produce word in it ("tomato sauce"), and a
 * dish word beats the produce word too ("vegetable soup") because the split
 * between its parts is not in the name.
 *
 * `category` is the food database's own category, when the entry kept one
 * (`FoodNutrition.foodCategory`). It is a **fallback for a name the lexicon does
 * not know** ("Pomelo, raw"), never an override: the exclusions above and the
 * potato rule below run first, so a "Vegetables and Vegetable Products" potato
 * or a juice filed under "Fruits and Fruit Juices" is still not counted.
 */
export function produceKindOf(name: string, category?: string | null): ProduceKind | 'mixed' | null {
  const tokens = tokensOf(name);
  if (tokens.length === 0) return null;
  const has = (set: Set<string>) => tokens.some(token => set.has(token));

  // "Stir fry" is a dish; its "fry" must not read as the processed "fries".
  if (tokens.includes('stir')) return 'mixed';
  if (has(PROCESSED)) return null;
  if (has(MIXED)) return 'mixed';
  if (has(SEASONING)) return null;
  if (tokens.includes('potato') && !tokens.includes('sweet')) return null;

  return kindFromName(tokens, has) ?? kindFromCategory(tokens, category);
}

function kindFromName(tokens: string[], has: (set: Set<string>) => boolean): ProduceKind | null {
  const hasFruit = has(FRUITS);
  if (has(DRIED_MARKERS) && (hasFruit || tokens.some(t => t === 'raisin' || t === 'prune' || t === 'sultana' || t === 'date'))) {
    return 'dried';
  }

  if (tokens.includes('potato')) return 'vegetable';
  if (tokens.includes('bean') && !has(NON_PULSE_BEAN)) return 'legume';
  if (has(LEGUMES)) return 'legume';
  if (tokens.includes('split') && tokens.includes('pea')) return 'legume';

  // Bare "pepper" is the spice; a bell or chile pepper is the vegetable.
  if (tokens.includes('pepper') && !tokens.some(t => ['bell', 'sweet', 'jalapeno', 'poblano', 'serrano', 'chile', 'chili'].includes(t))) {
    return null;
  }

  if (has(VEGETABLES) || tokens.includes('pepper') || tokens.includes('bean')) return 'vegetable';
  if (hasFruit) return 'fruit';
  return null;
}

/** FoodData Central's own groupings, matched whole so "Fruit juices" does not read as a fruit. */
function kindFromCategory(tokens: string[], category: string | null | undefined): ProduceKind | null {
  if (!category) return null;
  const text = category.toLowerCase();
  if (text.includes('legume')) return 'legume';
  if (text.includes('vegetable')) return 'vegetable';
  if (text.includes('fruit')) {
    // A dried fruit's category is the same as the fresh one's, so only its name says.
    return tokens.some(t => DRIED_MARKERS.has(t)) ? 'dried' : 'fruit';
  }
  return null;
}

/** Adds one entry's grams into a running total. Beans are a vegetable only at the day's end. */
export function addProduceGrams(into: ProduceGrams, from: Partial<ProduceGrams>): void {
  into.vegetable += from.vegetable ?? 0;
  into.fruit += from.fruit ?? 0;
  into.dried += from.dried ?? 0;
  into.legume += from.legume ?? 0;
}

/**
 * Servings from a day's summed grams, with the dried-fruit serving and the daily
 * bean cap applied. The cap is on the day, not the entry, which is why grams are
 * summed first and only then turned into servings.
 */
export function servingsFromGrams(grams: ProduceGrams): ProduceServings {
  const beans = Math.min(LEGUME_DAILY_CAP, grams.legume / PORTION_GRAMS);
  return {
    vegetable: grams.vegetable / PORTION_GRAMS + beans,
    fruit: grams.fruit / PORTION_GRAMS + grams.dried / DRIED_PORTION_GRAMS,
  };
}

/**
 * A recipe entry's grams of each kind, or null when they could not be worked out.
 * Supplied by the caller (`recipeProduce.ts`) because it needs the catalog.
 */
export type RecipeProduceResolver = (entry: FoodLogEntry) => ProduceGrams | null;

/**
 * Servings of vegetables and fruit in one day's entries.
 *
 * Nutrient-only entries (water, a logged sodium figure) are skipped, since they
 * are not food. A recipe entry is answered by `recipeGrams`, and one the
 * resolver cannot answer is `unmeasured` rather than counted as none.
 */
export function dayProduce(
  entries: readonly FoodLogEntry[],
  recipeGrams?: RecipeProduceResolver,
): DayProduce {
  const grams = emptyProduceGrams();
  let unmeasured = 0;

  for (const entry of entries) {
    if (isNutrientOnlyEntry(entry)) continue;

    if (entry.recipeId !== null) {
      const fromRecipe = recipeGrams ? recipeGrams(entry) : null;
      if (fromRecipe) addProduceGrams(grams, fromRecipe);
      else unmeasured += 1;
      continue;
    }

    const kind = produceKindOf(entry.label, entry.sourcePanel?.foodCategory);
    if (kind === null) continue;
    if (kind === 'mixed') {
      unmeasured += 1;
      continue;
    }
    if (entry.grams !== null && entry.grams > 0) grams[kind] += entry.grams;
    else unmeasured += 1;
  }

  return { ...servingsFromGrams(grams), unmeasured };
}

/** Rounds to the nearest half, which is as fine as a name-based estimate can honestly claim. */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/** "2.5", "1", "0": a half-serving figure without a trailing ".0". */
/** The "5 a day" figure: vegetable and fruit servings together. */
export const DAILY_PRODUCE_SERVINGS = 5;

/** How far a day's vegetable and fruit servings are toward 5 a day, 0..1. */
export function dailyProduceProgress(vegetable: number, fruit: number): number {
  return Math.min(1, Math.max(0, (vegetable + fruit) / DAILY_PRODUCE_SERVINGS));
}

export function formatServings(value: number): string {
  const rounded = roundToHalf(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
