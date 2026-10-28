import type { FoodNutrition, GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { choiceGroupKey, entryResolution } from '../utils/recipeComponents';
import { eitherPairKey, UNANSWERED } from '../utils/itemEither';
import { standingSwapMap } from '../utils/standingSwaps';
import {
  describeNutritionCoverage,
  describeRecipeNutrition,
  describeRecipeNutritionRange,
  describeWeekNutrition,
  estimateRequestLine,
  excludedNutritionLines,
  lineContribution,
  nutritionGaps,
  perServing,
  readRecipeNutrition,
  recipeNutrition,
  recipeNutritionLines,
  recipesWithoutFigures,
  weekNutrition,
} from '../utils/recipeNutrition';

// Same mock recipeCost.test.ts uses, and for the same reason: the week read
// reaches mealPlanGroceries → mealPlan → dateUtils → the settings store for
// dayResetTime, which a calendar day key does not need.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function ing(name: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
    ...overrides,
  };
}

function recipe(name: string, ingredients: RecipeIngredient[], overrides: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [],
    id: `r-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    cookedWeightG: null,
    leftoverKeepDays: null, ovenTemp: null, ovenTempUnit: 'F', ovenTempStepId: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients,
    emptySections: [],
    emptyStepSections: [],
    components: [],
    blanks: [],
    prepTasks: [],
    steps: [],
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
  };
}

function entry(date: string, recipeId: string | null, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`,
    date,
    slot: 'dinner',
    recipeId,
    title: overrides.title ?? 'Leftovers',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [], recipeOverrides: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    logMeal: null,
    calendarEventId: null,
    ...overrides,
  };
}

function item(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    id: `gi-${++seq}`,
    nameKey: groceryNameKey(overrides.name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    nutrition: null,
    ...overrides,
  } as GroceryItem;
}

function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 100, proteinG: 10 },
    portions: [],
    source: 'fdc',
    sourceId: '1',
    recordedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

describe('recipeNutrition', () => {
  it('is null for a recipe with no ingredients', () => {
    expect(recipeNutrition(recipe('Toast', []), [])).toBeNull();
  });

  it('sums a per-100g panel against a line already written as a mass', () => {
    const dish = recipe('Chicken', [ing('Chicken', { quantity: '200 g' })]);
    const catalog = [item({ name: 'Chicken', nutrition: panel() })];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.total.calorieKcal).toBe(200);
    expect(read.total.proteinG).toBe(20);
    expect(read.covered).toBe(1);
    expect(read.lines).toBe(1);
  });

  it('reads a volume line through the food\'s own portion table', () => {
    const dish = recipe('Soup', [ing('Onion', { quantity: '1 cup', prep: 'chopped' })]);
    const catalog = [item({
      name: 'Onion',
      nutrition: panel({
        amounts: { calorieKcal: 40 },
        portions: [{ amount: 1, label: 'cup, chopped', grams: 160 }],
      }),
    })];
    // 160g of a 40kcal/100g food.
    expect(recipeNutrition(dish, catalog)!.total.calorieKcal).toBe(64);
  });

  it('counts a line it cannot relate as uncovered rather than as zero', () => {
    const dish = recipe('Stew', [
      ing('Beef', { quantity: '500 g' }),
      // No portion table, so a cup of it cannot become a weight.
      ing('Stock', { quantity: '2 cups' }),
    ]);
    const catalog = [
      item({ name: 'Beef', nutrition: panel() }),
      item({ name: 'Stock', nutrition: panel() }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.covered).toBe(1);
    expect(read.lines).toBe(2);
    // Only the beef is in the total.
    expect(read.total.calorieKcal).toBe(500);
  });

  it('declines entirely below the line coverage floor', () => {
    const dish = recipe('Stew', [
      ing('Beef', { quantity: '500 g' }),
      ing('Stock', { quantity: '2 cups' }),
      ing('Wine', { quantity: '1 cup' }),
    ]);
    const catalog = [
      item({ name: 'Beef', nutrition: panel() }),
      item({ name: 'Stock', nutrition: panel() }),
      item({ name: 'Wine', nutrition: panel() }),
    ];
    // One of three related, which is a number confident about mostly nothing.
    expect(recipeNutrition(dish, catalog)).toBeNull();
  });

  it('leaves a nutrient too few lines reported out of the total', () => {
    // The failure this whole tree is arranged to avoid: a "0g fiber" line on a
    // dish where only one of three foods ever mentioned fibre.
    const dish = recipe('Bowl', [
      ing('Rice', { quantity: '100 g' }),
      ing('Beans', { quantity: '100 g' }),
      ing('Oil', { quantity: '100 g' }),
    ]);
    const catalog = [
      item({ name: 'Rice', nutrition: panel({ amounts: { calorieKcal: 130 } }) }),
      item({ name: 'Beans', nutrition: panel({ amounts: { calorieKcal: 120, fiberG: 7 } }) }),
      item({ name: 'Oil', nutrition: panel({ amounts: { calorieKcal: 880 } }) }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.total.calorieKcal).toBe(1130);
    expect(read.total.fiberG).toBeUndefined();
    // ...but the count is still carried, so a caller can say why.
    expect(read.reported.fiberG).toBe(1);
    expect(read.reported.calorieKcal).toBe(3);
  });

  it('excludes a staple from both sides of the fraction', () => {
    const dish = recipe('Chicken', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Salt', { quantity: '1 tsp' }),
    ]);
    const catalog = [
      item({ name: 'Chicken', nutrition: panel() }),
      item({ name: 'Salt', isStaple: true, nutrition: panel() }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.lines).toBe(1);
    expect(read.covered).toBe(1);
  });

  it('still counts a staple written in a bulk weight', () => {
    // Sugar marked "Always have it", but this dish uses a pound of it —
    // not a dash, so it isn't waved through the way a pinch of salt is.
    const dish = recipe('Cake', [
      ing('Flour', { quantity: '200 g' }),
      ing('Sugar', { quantity: '1 lb' }),
    ]);
    const catalog = [
      item({ name: 'Flour', nutrition: panel() }),
      item({ name: 'Sugar', isStaple: true, nutrition: panel({ amounts: { calorieKcal: 400 } }) }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.lines).toBe(2);
    expect(read.covered).toBe(2);
    // 200g flour @ 100 kcal/100g + ~453.6g sugar @ 400 kcal/100g.
    expect(read.total.calorieKcal).toBe(Math.round((200 + 453.59237 * 4) * 10) / 10);
  });

  it('still excludes a staple written in a small weight', () => {
    // A packet of yeast, well under the bulk threshold — stays waved through.
    const dish = recipe('Bread', [
      ing('Flour', { quantity: '200 g' }),
      ing('Yeast', { quantity: '7 g' }),
    ]);
    const catalog = [
      item({ name: 'Flour', nutrition: panel() }),
      item({ name: 'Yeast', isStaple: true, nutrition: panel() }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.lines).toBe(1);
    expect(read.covered).toBe(1);
  });

  it('weighs a drained can by the food\'s own drained portion, and the whole can otherwise', () => {
    const beans = (portions: { amount: number; label: string; grams: number }[]) => [
      item({ name: 'Black beans', nutrition: panel({ amounts: { calorieKcal: 120 }, portions }) }),
    ];
    const dish = recipe('Bake', [
      ing('Black beans', { quantity: '2 14 oz cans', prep: 'drained and rinsed' }),
    ]);
    // 2 x 240 g drained @ 120 kcal/100g.
    expect(recipeNutrition(dish, beans([{ amount: 1, label: '14 oz can, drained', grams: 240 }]))!.total.calorieKcal).toBe(576);
    // No drained row: the whole 28 oz, as before.
    expect(recipeNutrition(dish, beans([]))!.total.calorieKcal).toBeCloseTo(952.6, 0);
  });

  it('still counts a staple written in a tablespoon or more', () => {
    // Olive oil marked "Always have it", at 3 tbsp: not a dash, so it counts
    // rather than leaving the dish "fully counted" with its fat missing.
    const dish = recipe('Beans', [
      ing('Beans', { quantity: '200 g' }),
      ing('Olive oil', { quantity: '3 tbsp' }),
    ]);
    const catalog = [
      item({ name: 'Beans', nutrition: panel() }),
      item({
        name: 'Olive oil',
        isStaple: true,
        nutrition: panel({
          amounts: { calorieKcal: 884 },
          portions: [{ amount: 1, label: 'tbsp', grams: 13.5 }],
        }),
      }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.lines).toBe(2);
    expect(read.covered).toBe(2);
    // 200g beans @ 100 kcal/100g + 3 x 13.5g oil @ 884 kcal/100g.
    expect(read.total.calorieKcal).toBe(Math.round((200 + 40.5 * 8.84) * 10) / 10);
  });

  it('counts a staple at exactly a tablespoon, but not at a teaspoon or a count', () => {
    const catalog = [
      item({ name: 'Beans', nutrition: panel() }),
      item({ name: 'Oil', isStaple: true, nutrition: panel() }),
    ];
    const lineCount = (qty: string) =>
      recipeNutritionLines(recipe('D', [ing('Beans', { quantity: '200 g' }), ing('Oil', { quantity: qty })]), catalog).length;
    expect(lineCount('1 tbsp')).toBe(2);
    expect(lineCount('2 tsp')).toBe(1);
    expect(lineCount('3 cloves')).toBe(1);
  });

  it('turns a staple written in a tablespoon or more into a real gap when it has no figures', () => {
    const dish = recipe('Beans', [
      ing('Beans', { quantity: '200 g' }),
      ing('Olive oil', { quantity: '3 tbsp' }),
    ]);
    const catalog = [
      item({ name: 'Beans', nutrition: panel() }),
      item({ name: 'Olive oil', isStaple: true }),
    ];
    expect(recipeNutritionLines(dish, catalog).map(l => [l.name, l.state])).toEqual([
      ['Beans', 'covered'],
      ['Olive oil', 'noPanel'],
    ]);
  });

  it('turns a staple written in a bulk weight into a real gap when it has no figures', () => {
    const dish = recipe('Cake', [
      ing('Flour', { quantity: '200 g' }),
      ing('Sugar', { quantity: '1 lb' }),
    ]);
    const catalog = [
      item({ name: 'Flour', nutrition: panel() }),
      item({ name: 'Sugar', isStaple: true }),
      // No panel — a pound of sugar with nothing on file is a real gap, not
      // the "salt missing a panel" case this exclusion exists for.
    ];
    const lines = recipeNutritionLines(dish, catalog);
    expect(lines.map(l => [l.name, l.state])).toEqual([
      ['Flour', 'covered'],
      ['Sugar', 'noPanel'],
    ]);
  });

  it('excludes a line marked excludeFromNutrition from both sides of the fraction', () => {
    const dish = recipe('Pasta', [
      ing('Pasta', { quantity: '200 g' }),
      ing('Basil', { quantity: '1 handful', excludeFromNutrition: true }),
    ]);
    const catalog = [
      item({ name: 'Pasta', nutrition: panel() }),
      // No panel at all — if this line weren't excluded it would drag
      // coverage down, not just leave a nutrient out.
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.lines).toBe(1);
    expect(read.covered).toBe(1);
  });

  describe('a cooking oil cooked in a pan', () => {
    const oilPanel = () => panel({ amounts: { calorieKcal: 900 } });
    const sauté = [{ id: 's1', text: 'Heat the oil in a skillet and cook the onion.' }] as Recipe['steps'];

    it('counts PAN_OIL_SHARE of the written amount when the steps cook it in a pan', () => {
      const dish = recipe('Onions', [ing('Olive oil', { quantity: '100 g' })], { steps: sauté });
      const read = readRecipeNutrition(dish, [item({ name: 'Olive oil', nutrition: oilPanel() })]);
      expect(read.nutrition!.total.calorieKcal).toBe(675);
      expect(read.lines[0].share).toBe(0.75);
    });

    it('counts all of it when the steps do not cook it', () => {
      const dish = recipe('Salad', [ing('Olive oil', { quantity: '100 g' })], {
        steps: [{ id: 's1', text: 'Whisk the oil into the lemon juice.' }] as Recipe['steps'],
      });
      expect(recipeNutrition(dish, [item({ name: 'Olive oil', nutrition: oilPanel() })])!.total.calorieKcal).toBe(900);
    });

    it('counts all of it when the person said it was not cooked in the pan', () => {
      const dish = recipe('Onions', [ing('Olive oil', { quantity: '100 g', cookedInPan: false })], { steps: sauté });
      expect(recipeNutrition(dish, [item({ name: 'Olive oil', nutrition: oilPanel() })])!.total.calorieKcal).toBe(900);
    });

    it('still counts a bulk staple oil, since the staple check reads the written amount', () => {
      // 100 g is the bulk threshold. Applying the share before that check would
      // read it as 75 g and drop the line as negligible.
      const dish = recipe('Onions', [ing('Olive oil', { quantity: '100 g' })], { steps: sauté });
      const read = readRecipeNutrition(dish, [item({ name: 'Olive oil', isStaple: true, nutrition: oilPanel() })]);
      expect(read.lines).toHaveLength(1);
      expect(read.nutrition!.total.calorieKcal).toBe(675);
    });

    it('counts only DEEP_FRY_SHARE of an oil the steps deep fry', () => {
      const dish = recipe('Fritters', [ing('Vegetable oil', { quantity: '100 g' })], {
        steps: [{ id: 's1', text: 'Heat the oil to 350°F and deep fry the fritters.' }] as Recipe['steps'],
      });
      const read = readRecipeNutrition(dish, [item({ name: 'Vegetable oil', nutrition: oilPanel() })]);
      expect(read.nutrition!.total.calorieKcal).toBe(90);
      expect(read.lines[0].share).toBe(0.1);
    });

    it('applies the same share to a planned week', () => {
      const dish = recipe('Onions', [ing('Olive oil', { quantity: '100 g' })], { steps: sauté });
      const recipesById = new Map([[dish.id, dish]]);
      const read = weekNutrition(
        [entry('2026-08-10', dish.id)], recipesById, [item({ name: 'Olive oil', nutrition: oilPanel() })],
        { startKey: '2026-08-10', endKey: '2026-08-16' },
      )!;
      expect(read.total.calorieKcal).toBe(675);
    });
  });

  it('applies the scale to the total', () => {
    const dish = recipe('Chicken', [ing('Chicken', { quantity: '200 g' })]);
    const catalog = [item({ name: 'Chicken', nutrition: panel() })];
    const doubled = recipeNutrition(dish, catalog, [], undefined, undefined, 2)!;
    expect(doubled.total.calorieKcal).toBe(400);
  });

  it('answers an either/or that resolved to one option', () => {
    // With nothing said, the flatten takes the group's default, so there is
    // exactly one pepper in the dish and nothing ambiguous about it.
    const dish = recipe('Salsa', [
      ing('Serrano', { quantity: '100 g', choiceGroup: 'Pepper' }),
      ing('Jalapeno', { quantity: '100 g', choiceGroup: 'Pepper' }),
    ]);
    const catalog = [
      item({ name: 'Serrano', nutrition: panel() }),
      item({ name: 'Jalapeno', nutrition: panel() }),
    ];
    const read = recipeNutrition(dish, catalog)!;
    expect(read.lines).toBe(1);
    expect(read.total.calorieKcal).toBe(100);
  });

  it('refuses an either/or the shopper left to decide at the shelf', () => {
    // `undecided` yields *both* options, which for shopping means buying
    // either and here would mean counting both. Serrano and jalapeño are close
    // enough that nobody would notice; mash or roast potatoes is not.
    const dish = recipe('Salsa', [
      ing('Serrano', { quantity: '100 g', choiceGroup: 'Pepper' }),
      ing('Jalapeno', { quantity: '100 g', choiceGroup: 'Pepper' }),
    ]);
    const catalog = [
      item({ name: 'Serrano', nutrition: panel() }),
      item({ name: 'Jalapeno', nutrition: panel() }),
    ];
    const undecided = { undecided: [choiceGroupKey(dish.id, 'Pepper')] };
    expect(recipeNutrition(dish, catalog, [], undefined, undecided)).toBeNull();
  });

  it('relates a per-100ml panel only to a line that is itself a volume', () => {
    // Turning grams into millilitres needs a density this app does not have.
    const drinkPanel = panel({ basis: 'per100ml', amounts: { calorieKcal: 42 } });
    const byVolume = recipe('Float', [ing('Cola', { quantity: '500 ml' })]);
    const byMass = recipe('Float', [ing('Cola', { quantity: '500 g' })]);
    const catalog = [item({ name: 'Cola', nutrition: drinkPanel })];
    expect(recipeNutrition(byVolume, catalog)!.total.calorieKcal).toBe(210);
    expect(recipeNutrition(byMass, catalog)).toBeNull();
  });

  it('needs a serving weight to use a per-serving panel', () => {
    const dish = recipe('Yogurt bowl', [ing('Yogurt', { quantity: '340 g' })]);
    const weighed = [item({
      name: 'Yogurt',
      nutrition: panel({ basis: 'perServing', servingGrams: 170, amounts: { calorieKcal: 90 } }),
    })];
    const unweighed = [item({
      name: 'Yogurt',
      nutrition: panel({ basis: 'perServing', servingGrams: null, amounts: { calorieKcal: 90 } }),
    })];
    expect(recipeNutrition(dish, weighed)!.total.calorieKcal).toBe(180);
    expect(recipeNutrition(dish, unweighed)).toBeNull();
  });
});

describe('perServing', () => {
  const dish = () => recipe('Chicken', [ing('Chicken', { quantity: '400 g' })], { servings: 4 });
  const catalog = () => [item({ name: 'Chicken', nutrition: panel() })];

  it('divides the total by the recipe\'s own count', () => {
    expect(perServing(recipeNutrition(dish(), catalog()))!.calorieKcal).toBe(100);
  });

  it('does not move when the scale does, which is the check that it is right', () => {
    // Doubling makes twice as many servings, not twice as large a serving.
    const doubled = recipeNutrition(dish(), catalog(), [], undefined, undefined, 2)!;
    expect(doubled.total.calorieKcal).toBe(800);
    expect(doubled.servings).toBe(8);
    expect(perServing(doubled)!.calorieKcal).toBe(100);
  });

  it('does not move for a canned line whose scaled text reads differently (#2918)', () => {
    // "14 oz can" can't be written at 1.5x, so its scaled text stays "14 oz
    // can", and at 2x it becomes "2 14 oz cans". Measuring those strings
    // counted one can at 1.5x and none at 2x.
    const chili = recipe('Chili', [ing('Black beans', { quantity: '14 oz can' })], { servings: 4 });
    const beans = [item({ name: 'Black beans', nutrition: panel() })];
    const at = (scale: number) => recipeNutrition(chili, beans, [], undefined, undefined, scale)!;

    const once = perServing(at(1))!.calorieKcal!;
    expect(at(1).total.calorieKcal).toBeCloseTo(396.9, 1);
    expect(at(1.5).total.calorieKcal).toBeCloseTo(595.3, 1);
    expect(at(2).total.calorieKcal).toBeCloseTo(793.8, 1);
    expect(perServing(at(1.5))!.calorieKcal).toBeCloseTo(once, 1);
    expect(perServing(at(2))!.calorieKcal).toBeCloseTo(once, 1);
  });

  it('never invents a servings count', () => {
    // Cronometer's own worst behaviour is confidently dividing by a number
    // nobody entered.
    const unserved = recipe('Chicken', [ing('Chicken', { quantity: '400 g' })]);
    const read = recipeNutrition(unserved, catalog())!;
    expect(read.servings).toBeNull();
    expect(perServing(read)).toBeNull();
  });

  it('is null for a recipe that produced no reading at all', () => {
    expect(perServing(null)).toBeNull();
  });
});

describe('describeRecipeNutrition', () => {
  const catalog = () => [item({ name: 'Chicken', nutrition: panel() })];

  it('is null while there is nothing worth saying', () => {
    expect(describeRecipeNutrition(null)).toBeNull();
  });

  it('leads per serving when the recipe says how many it makes', () => {
    const dish = recipe('Chicken', [ing('Chicken', { quantity: '400 g' })], { servings: 4 });
    expect(describeRecipeNutrition(recipeNutrition(dish, catalog())))
      .toBe('\u2248 100 cal, 10g protein per serving');
  });

  it('leads with the whole recipe when it does not', () => {
    const dish = recipe('Chicken', [ing('Chicken', { quantity: '400 g' })]);
    expect(describeRecipeNutrition(recipeNutrition(dish, catalog())))
      .toBe('\u2248 400 cal, 40g protein');
  });

  it('carries the coverage clause whenever anything is uncovered', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '400 g' }),
      ing('Stock', { quantity: '2 cups' }),
    ]);
    const items = [...catalog(), item({ name: 'Stock', nutrition: panel() })];
    expect(describeRecipeNutrition(recipeNutrition(dish, items)))
      .toBe('\u2248 400 cal, 40g protein, from 1 of 2 ingredients');
  });

  it('names only the nutrients that survived the per-nutrient floor', () => {
    // Protein is reported by one food of three, so it is unknown rather than
    // a total, and the line simply does not mention it.
    const dish = recipe('Bowl', [
      ing('Rice', { quantity: '100 g' }),
      ing('Beans', { quantity: '100 g' }),
      ing('Oil', { quantity: '100 g' }),
    ]);
    const items = [
      item({ name: 'Rice', nutrition: panel({ amounts: { calorieKcal: 130 } }) }),
      item({ name: 'Beans', nutrition: panel({ amounts: { calorieKcal: 120, proteinG: 8 } }) }),
      item({ name: 'Oil', nutrition: panel({ amounts: { calorieKcal: 880 } }) }),
    ];
    const line = describeRecipeNutrition(recipeNutrition(dish, items))!;
    expect(line).toContain('cal');
    expect(line).not.toContain('protein');
  });
});

// Mirrors estimateWeekCost's own suite one file over, because the two read the
// same planned lines through the same collector and differ only in what they
// accumulate.
describe('weekNutrition', () => {
  const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };
  const catalog = () => [
    item({ name: 'Chicken', nutrition: panel() }),
    item({ name: 'Rice', nutrition: panel({ amounts: { calorieKcal: 130, proteinG: 3 } }) }),
  ];

  it('is null when nothing in range resolves to a recipe', () => {
    expect(weekNutrition([entry('2026-08-11', null)], new Map(), [], RANGE)).toBeNull();
  });

  it('sums the week\'s planned meals', () => {
    const roast = recipe('Roast', [ing('Chicken', { quantity: '400 g' })]);
    const bowl = recipe('Bowl', [ing('Rice', { quantity: '100 g' })]);
    const recipesById = new Map([[roast.id, roast], [bowl.id, bowl]]);
    const entries = [entry('2026-08-10', roast.id), entry('2026-08-12', bowl.id)];
    const read = weekNutrition(entries, recipesById, catalog(), RANGE)!;
    expect(read.total.calorieKcal).toBe(530);
    expect(read.covered).toBe(2);
    expect(read.lines).toBe(2);
  });

  it('has no servings of its own, since a week is not a recipe', () => {
    // Dividing a week's total by anything would be inventing a number of
    // eaters, so `perServing` declines and the line never says "per serving".
    const roast = recipe('Roast', [ing('Chicken', { quantity: '400 g' })], { servings: 4 });
    const recipesById = new Map([[roast.id, roast]]);
    const read = weekNutrition([entry('2026-08-10', roast.id)], recipesById, catalog(), RANGE)!;
    expect(read.servings).toBeNull();
    expect(perServing(read)).toBeNull();
  });

  it('applies each entry\'s own scale', () => {
    const roast = recipe('Roast', [ing('Chicken', { quantity: '400 g' })]);
    const recipesById = new Map([[roast.id, roast]]);
    const entries = [entry('2026-08-10', roast.id, { recipeScale: 2 })];
    expect(weekNutrition(entries, recipesById, catalog(), RANGE)!.total.calorieKcal).toBe(800);
  });

  it('counts a scaled entry\'s canned line at its scale, not its shopping text (#2918)', () => {
    // The planned row's quantity is what the list shows: "14 oz can" at 1.5x
    // (unwritable, so left alone) would count one can.
    const chili = recipe('Chili', [ing('Black beans', { quantity: '14 oz can' })]);
    const recipesById = new Map([[chili.id, chili]]);
    const beans = [item({ name: 'Black beans', nutrition: panel() })];
    const at = (recipeScale: number) =>
      weekNutrition([entry('2026-08-10', chili.id, { recipeScale })], recipesById, beans, RANGE)!;
    expect(at(1).total.calorieKcal).toBeCloseTo(396.9, 1);
    expect(at(1.5).total.calorieKcal).toBeCloseTo(595.3, 1);
    expect(at(2).total.calorieKcal).toBeCloseTo(793.8, 1);
  });

  it('excludes a cooked entry, same as collectPlannedIngredients', () => {
    const roast = recipe('Roast', [ing('Chicken', { quantity: '400 g' })]);
    const recipesById = new Map([[roast.id, roast]]);
    const entries = [entry('2026-08-10', roast.id, { cookedAt: '2026-08-10T00:00:00.000Z' })];
    expect(weekNutrition(entries, recipesById, catalog(), RANGE)).toBeNull();
  });

  it('ignores a meal planned outside the range', () => {
    const roast = recipe('Roast', [ing('Chicken', { quantity: '400 g' })]);
    const recipesById = new Map([[roast.id, roast]]);
    expect(weekNutrition([entry('2026-09-01', roast.id)], recipesById, catalog(), RANGE)).toBeNull();
  });

  it('excludes a line marked excludeFromNutrition, same as a single recipe\'s reading', () => {
    const roast = recipe('Roast', [
      ing('Chicken', { quantity: '400 g' }),
      ing('Basil', { quantity: '1 handful', excludeFromNutrition: true }),
    ]);
    const recipesById = new Map([[roast.id, roast]]);
    const read = weekNutrition([entry('2026-08-10', roast.id)], recipesById, catalog(), RANGE)!;
    expect(read.lines).toBe(1);
    expect(read.covered).toBe(1);
  });

  it('keeps a nutrient below the per-nutrient floor out of the total', () => {
    // The same floor a single recipe applies. Protein is stated by one food of
    // three, so the week has no protein total rather than a confident one.
    const bowl = recipe('Bowl', [
      ing('Rice', { quantity: '100 g' }),
      ing('Beans', { quantity: '100 g' }),
      ing('Oil', { quantity: '100 g' }),
    ]);
    const recipesById = new Map([[bowl.id, bowl]]);
    const items = [
      item({ name: 'Rice', nutrition: panel({ amounts: { calorieKcal: 130 } }) }),
      item({ name: 'Beans', nutrition: panel({ amounts: { calorieKcal: 120, proteinG: 8 } }) }),
      item({ name: 'Oil', nutrition: panel({ amounts: { calorieKcal: 880 } }) }),
    ];
    const read = weekNutrition([entry('2026-08-10', bowl.id)], recipesById, items, RANGE)!;
    expect(read.total.calorieKcal).toBeGreaterThan(0);
    expect(read.total.proteinG).toBeUndefined();
  });
});

describe('describeWeekNutrition', () => {
  const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };

  it('is null while there is nothing worth saying', () => {
    expect(describeWeekNutrition(null)).toBeNull();
  });

  it('counts items rather than ingredients, matching describeWeekCost', () => {
    const roast = recipe('Roast', [
      ing('Chicken', { quantity: '400 g' }),
      ing('Stock', { quantity: '2 cups' }),
    ]);
    const recipesById = new Map([[roast.id, roast]]);
    const items = [item({ name: 'Chicken', nutrition: panel() })];
    expect(describeWeekNutrition(weekNutrition([entry('2026-08-10', roast.id)], recipesById, items, RANGE)))
      .toBe('\u2248 400 cal, 40g protein, from 1 of 2 items');
  });

  it('never claims a per-serving basis for a week', () => {
    const roast = recipe('Roast', [ing('Chicken', { quantity: '400 g' })], { servings: 4 });
    const recipesById = new Map([[roast.id, roast]]);
    const items = [item({ name: 'Chicken', nutrition: panel() })];
    const line = describeWeekNutrition(
      weekNutrition([entry('2026-08-10', roast.id)], recipesById, items, RANGE),
    )!;
    expect(line).toBe('\u2248 400 cal, 40g protein');
    expect(line).not.toContain('per serving');
  });
});

describe('recipeNutritionLines', () => {
  it('names which of the three ways each uncounted line failed', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Onion', { quantity: '2 cups' }),
      ing('Thyme', { quantity: '1 sprig' }),
    ]);
    const catalog = [
      item({ name: 'Chicken', nutrition: panel() }),
      // A panel with no portion table, so a line written as a volume has
      // nothing to become a weight through.
      item({ name: 'Onion', nutrition: panel() }),
      item({ name: 'Salt', nutrition: panel() }),
    ];
    const lines = recipeNutritionLines(dish, catalog);
    expect(lines.map(l => [l.name, l.state])).toEqual([
      ['Chicken', 'covered'],
      ['Onion', 'unmeasured'],
      ['Thyme', 'unmatched'],
    ]);
  });

  it('leaves staples out entirely, exactly as the coverage fraction does', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Salt', { quantity: '1 tsp' }),
    ]);
    const catalog = [
      item({ name: 'Chicken', nutrition: panel() }),
      item({ name: 'Salt', isStaple: true }),
    ];
    expect(recipeNutritionLines(dish, catalog).map(l => l.name)).toEqual(['Chicken']);
    expect(recipeNutrition(dish, catalog)!.lines).toBe(1);
  });

  it('leaves an excluded line out entirely, and it carries which recipe it belongs to', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Basil', { quantity: '1 handful', excludeFromNutrition: true }),
    ]);
    const catalog = [item({ name: 'Chicken', nutrition: panel() })];
    const lines = recipeNutritionLines(dish, catalog);
    expect(lines.map(l => l.name)).toEqual(['Chicken']);
    expect(lines[0].recipeId).toBe(dish.id);
  });

  it('names an excluded line rather than dropping it with no trace', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Basil', { quantity: '1 handful', excludeFromNutrition: true }),
    ]);
    const lines = excludedNutritionLines(dish);
    expect(lines).toEqual([{ id: expect.any(String), recipeId: dish.id, name: 'Basil' }]);
  });

  it('says nothing is excluded once nobody has left anything out', () => {
    const dish = recipe('Stew', [ing('Chicken', { quantity: '200 g' })]);
    expect(excludedNutritionLines(dish)).toEqual([]);
  });

  it('comes back empty for an either/or nobody has decided, matching the rollup', () => {
    const dish = recipe('Salsa', [
      ing('Serrano', { quantity: '100 g', choiceGroup: 'Pepper' }),
      ing('Jalapeno', { quantity: '100 g', choiceGroup: 'Pepper' }),
    ]);
    const catalog = [item({ name: 'Serrano', nutrition: panel() })];
    const undecided = { undecided: [choiceGroupKey(dish.id, 'Pepper')] };
    expect(recipeNutritionLines(dish, catalog, [], undefined, undecided)).toEqual([]);
    expect(recipeNutrition(dish, catalog, [], undefined, undecided)).toBeNull();
  });

  it('carries the scaled quantity, so a gap is named in the amount on screen', () => {
    const dish = recipe('Soup', [ing('Onion', { quantity: '2 cups' })]);
    const catalog = [item({ name: 'Onion', nutrition: panel() })];
    expect(recipeNutritionLines(dish, catalog, [], undefined, undefined, 2)[0].quantity)
      .toBe('4 cups');
  });

  it('keeps a can that counted at 1x counted at 2x, shown in the scaled words (#2918)', () => {
    const dish = recipe('Chili', [ing('Black beans', { quantity: '14 oz can' })]);
    const catalog = [item({ name: 'Black beans', nutrition: panel() })];
    const [line] = recipeNutritionLines(dish, catalog, [], undefined, undefined, 2);
    expect(line.state).toBe('covered');
    expect(line.quantity).toBe('2 14 oz cans');
    expect(line.multiplier).toBeCloseTo(7.938, 3);
    expect(nutritionGaps([line]).fillable).toHaveLength(0);
  });

  it('weighs a staple against the scaled amount, not the written one', () => {
    // 60 g of a staple is a dash; doubled it is 120 g, past the bulk line.
    const dish = recipe('Bread', [ing('Sugar', { quantity: '60 g' })]);
    const catalog = [item({ name: 'Sugar', isStaple: true, nutrition: panel() })];
    expect(recipeNutritionLines(dish, catalog)).toHaveLength(0);
    expect(recipeNutritionLines(dish, catalog, [], undefined, undefined, 2)).toHaveLength(1);
  });

  it('reports the panel it actually read, so a correction lands on that row', () => {
    const dish = recipe('Soup', [ing('Stock', { quantity: '200 g' })]);
    const stock = item({ name: 'Stock', nutrition: panel({ amounts: { calorieKcal: 10 } }) });
    const boxed = { ...stock, preferredProductId: 'p-1' };
    const product = {
      id: 'p-1',
      itemId: boxed.id,
      nutrition: panel({ amounts: { calorieKcal: 50 } }),
    } as never;
    const [line] = recipeNutritionLines(dish, [boxed], [product]);
    expect(line.nutrition!.amounts.calorieKcal).toBe(50);
    expect(line.product).not.toBeNull();
  });
});

describe('lineContribution', () => {
  it('is the amount times the multiplier, the same arithmetic the fold sums', () => {
    const dish = recipe('Stew', [ing('Chicken', { quantity: '200 g' })]);
    const catalog = [item({ name: 'Chicken', nutrition: panel() })];
    const [line] = recipeNutritionLines(dish, catalog);
    expect(lineContribution(line)).toEqual({ calorieKcal: 200, proteinG: 20 });
  });

  it('is null for a line that never reached the total', () => {
    const dish = recipe('Stew', [ing('Onion', { quantity: '2 cups' })]);
    // No portion table, so this resolves to 'unmeasured' rather than 'covered'.
    const catalog = [item({ name: 'Onion', nutrition: panel() })];
    const [line] = recipeNutritionLines(dish, catalog);
    expect(line.state).toBe('unmeasured');
    expect(lineContribution(line)).toBeNull();
  });

  it('adds up across lines to the same total the rollup reports', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Rice', { quantity: '150 g' }),
    ]);
    const catalog = [
      item({ name: 'Chicken', nutrition: panel({ amounts: { calorieKcal: 165, proteinG: 31 } }) }),
      item({ name: 'Rice', nutrition: panel({ amounts: { calorieKcal: 130, proteinG: 2.7 } }) }),
    ];
    const lines = recipeNutritionLines(dish, catalog);
    const summed = lines.reduce((total, line) => total + (lineContribution(line)?.calorieKcal ?? 0), 0);
    expect(Math.round(summed * 10) / 10).toBe(recipeNutrition(dish, catalog)!.total.calorieKcal);
  });
});

describe('nutritionGaps', () => {
  const dish = () => recipe('Stew', [
    ing('Chicken', { quantity: '200 g' }),
    ing('Onion', { quantity: '2 cups' }),
    ing('Butter'),
    ing('Thyme', { quantity: '1 sprig' }),
  ]);
  const catalog = () => [
    item({ name: 'Chicken', nutrition: panel() }),
    item({ name: 'Onion', nutrition: panel() }),
    item({ name: 'Butter' }),
  ];

  it('offers only the lines somebody could answer from the recipe page', () => {
    const gaps = nutritionGaps(recipeNutritionLines(dish(), catalog()));
    expect(gaps.covered).toBe(1);
    expect(gaps.total).toBe(4);
    expect(gaps.fillable.map(l => l.name)).toEqual(['Onion', 'Butter']);
    expect(gaps.unmatched.map(l => l.name)).toEqual(['Thyme']);
  });

  it('says how far a dish got even when there is no total to show', () => {
    const gaps = nutritionGaps(recipeNutritionLines(dish(), catalog()));
    expect(describeNutritionCoverage(gaps)).toBe('Nutrition from 1 of 4 ingredients');
  });

  it('says nothing about a dish with no lines to count', () => {
    expect(describeNutritionCoverage(nutritionGaps([]))).toBeNull();
  });
});

describe('readRecipeNutrition', () => {
  it('gives the rollup and the lines behind it from one walk', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Thyme', { quantity: '1 sprig' }),
    ], { servings: 2 });
    const catalog = [item({ name: 'Chicken', nutrition: panel() })];
    const read = readRecipeNutrition(dish, catalog);
    // The sentence on the row and the list in the sheet describe one set of
    // lines, which is the whole reason this exists rather than three calls.
    expect(read.nutrition).toEqual(recipeNutrition(dish, catalog));
    expect(read.gaps.total).toBe(read.nutrition!.lines);
    expect(read.gaps.covered).toBe(read.nutrition!.covered);
    expect(read.lines).toHaveLength(2);
  });

  it('carries excluded lines alongside the reading, outside the coverage fraction', () => {
    const dish = recipe('Stew', [
      ing('Chicken', { quantity: '200 g' }),
      ing('Basil', { quantity: '1 handful', excludeFromNutrition: true }),
    ]);
    const catalog = [item({ name: 'Chicken', nutrition: panel() })];
    const read = readRecipeNutrition(dish, catalog);
    expect(read.excluded.map(l => l.name)).toEqual(['Basil']);
    expect(read.gaps.total).toBe(1);
  });
});

describe('a used recipe is counted at the share the parent eats', () => {
  const comp = (id: string) => ({ id: `c-${id}`, recipeId: id, name: id, choiceGroup: null });
  const salt = () => item({ name: 'Salt', nutrition: panel({ amounts: { calorieKcal: 0, sodiumMg: 1000 } }) });

  it('counts "1 tbsp" of a 3/4 cup batch as 1/12 of it, not the whole batch', () => {
    const mix = recipe('Mix', [ing('Salt', { quantity: '12 g' })], { recipeYield: '12 tbsp' });
    const fish = recipe('Fish', [ing('Mix', { quantity: '1 tbsp' })], { components: [comp(mix.id)] });
    const byId = new Map([[mix.id, mix], [fish.id, fish]]);
    // 12 g of salt at 1000 mg per 100 g is 120 mg for the batch; a twelfth is 10.
    const read = recipeNutrition(fish, [salt()], [], byId)!;
    expect(read.total.sodiumMg).toBeCloseTo(10, 5);
  });

  it('compounds down a chain of parts', () => {
    const inner = recipe('Inner', [ing('Salt', { quantity: '12 g' })], { recipeYield: '4 cup' });
    const mid = recipe('Mid', [ing('Inner', { quantity: '2 cup', excludeFromNutrition: true })], { recipeYield: '4 cup', components: [comp(inner.id)] });
    const top = recipe('Top', [ing('Mid', { quantity: '1 cup', excludeFromNutrition: true })], { components: [comp(mid.id)] });
    const byId = new Map([[inner.id, inner], [mid.id, mid], [top.id, top]]);
    expect(recipeNutrition(top, [salt()], [], byId)!.total.sodiumMg).toBeCloseTo(120 / 8, 5);
  });

  it('counts a part whole when no line names it, it has no yield, or the units differ', () => {
    const noLine = recipe('Dressing', [ing('Salt', { quantity: '12 g' })], { recipeYield: '12 tbsp' });
    const a = recipe('A', [], { components: [comp(noLine.id)] });
    expect(recipeNutrition(a, [salt()], [], new Map([[noLine.id, noLine], [a.id, a]]))!.total.sodiumMg).toBeCloseTo(120, 5);

    const noYield = recipe('Mix2', [ing('Salt', { quantity: '12 g' })]);
    const b = recipe('B', [ing('Mix2', { quantity: '1 tbsp' })], { components: [comp(noYield.id)] });
    expect(recipeNutrition(b, [salt()], [], new Map([[noYield.id, noYield], [b.id, b]]))!.total.sodiumMg).toBeCloseTo(120, 5);

    const count = recipe('Mix3', [ing('Salt', { quantity: '12 g' })], { recipeYield: '4 fillets' });
    const c = recipe('C', [ing('Mix3', { quantity: '1 tbsp' })], { components: [comp(count.id)] });
    expect(recipeNutrition(c, [salt()], [], new Map([[count.id, count], [c.id, c]]))!.total.sodiumMg).toBeCloseTo(120, 5);
  });

  describe('an amount typed on the link', () => {
    const withAmount = (amountUsed: string, yieldText: string | null) => {
      const mix = recipe('Mix', [ing('Salt', { quantity: '12 g' })], { recipeYield: yieldText });
      const dish = recipe('Dish', [], { components: [{ ...comp(mix.id), amountUsed }] });
      return recipeNutrition(dish, [salt()], [], new Map([[mix.id, mix], [dish.id, dish]]))!.total.sodiumMg;
    };

    it('counts a volume against the yield with no line naming the part', () => {
      expect(withAmount('1 tbsp', '12 tbsp')).toBeCloseTo(10, 5);
    });

    it('counts a bare number as batches, with or without a yield', () => {
      expect(withAmount('1/4', null)).toBeCloseTo(30, 5);
      expect(withAmount('2', '12 tbsp')).toBeCloseTo(240, 5);
    });

    it('counts two of four fillets as half', () => {
      expect(withAmount('2 fillets', '4 fillets')).toBeCloseTo(60, 5);
    });

    it('counts whole when the amount cannot be compared with the yield', () => {
      expect(withAmount('1 tbsp', '4 fillets')).toBeCloseTo(120, 5);
      expect(withAmount('1 tbsp', null)).toBeCloseTo(120, 5);
      expect(withAmount('to taste', '12 tbsp')).toBeCloseTo(120, 5);
    });

    it('wins over the parent line that names the part', () => {
      const mix = recipe('Mix', [ing('Salt', { quantity: '12 g' })], { recipeYield: '12 tbsp' });
      const dish = recipe('Dish', [ing('Mix', { quantity: '6 tbsp', excludeFromNutrition: true })], {
        components: [{ ...comp(mix.id), amountUsed: '1 tbsp' }],
      });
      expect(recipeNutrition(dish, [salt()], [], new Map([[mix.id, mix], [dish.id, dish]]))!.total.sodiumMg).toBeCloseTo(10, 5);
    });
  });

  it('leaves a recipe with no parts as it was', () => {
    const solo = recipe('Solo', [ing('Salt', { quantity: '12 g' })]);
    expect(recipeNutrition(solo, [salt()])!.total.sodiumMg).toBeCloseTo(120, 5);
  });
});

describe('recipesWithoutFigures', () => {
  const recipes = [
    { id: 'a', name: 'JUST Egg Omelette' },
    { id: 'b', name: 'JUST Egg Omurice' },
    { id: 'c', name: 'Overnight Waffles' },
  ];

  it('names the recipes the search matches that cannot be logged', () => {
    expect(recipesWithoutFigures(recipes, new Set(['b']), 'Just egg')).toEqual(['JUST Egg Omelette']);
  });

  it('ignores recipes that can be logged, and ones the search does not match', () => {
    expect(recipesWithoutFigures(recipes, new Set(['a', 'b']), 'just egg')).toEqual([]);
    expect(recipesWithoutFigures(recipes, new Set(), 'pancake')).toEqual([]);
  });

  it('says nothing before anything is typed', () => {
    expect(recipesWithoutFigures(recipes, new Set(), '  ')).toEqual([]);
  });
});

describe('optional lines count only when a meal picks them', () => {
  const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };
  const bread = ing('Bread', { quantity: '100 g', optional: true, purpose: 'serving' });
  const soup = recipe('Soup', [ing('Chicken', { quantity: '200 g' }), bread], { servings: 2 });
  const catalog = [
    item({ name: 'Chicken', nutrition: panel() }),
    item({ name: 'Bread', nutrition: panel({ amounts: { calorieKcal: 250, proteinG: 8 } }) }),
  ];

  it('leaves an unpicked optional line out of the figures and the line list', () => {
    expect(recipeNutrition(soup, catalog)!.total.calorieKcal).toBe(200);
    expect(recipeNutritionLines(soup, catalog).map(l => l.name)).toEqual(['Chicken']);
  });

  it('counts it once the meal picks it, or for the top of the range', () => {
    expect(recipeNutrition(soup, catalog, [], undefined, { chosen: [bread.id] })!.total.calorieKcal).toBe(450);
    expect(recipeNutrition(soup, catalog, [], undefined, { withOptional: true })!.total.calorieKcal).toBe(450);
  });

  it('leaves it out of a week unless that meal picked it', () => {
    const byId = new Map([[soup.id, soup]]);
    expect(weekNutrition([entry('2026-08-10', soup.id)], byId, catalog, RANGE)!.total.calorieKcal).toBe(200);
    expect(weekNutrition([entry('2026-08-10', soup.id, { recipeChoices: [bread.id] })], byId, catalog, RANGE)!.total.calorieKcal).toBe(450);
  });

  it('describes the two as a range per serving, and as one figure when they agree', () => {
    const low = recipeNutrition(soup, catalog)!;
    const high = recipeNutrition(soup, catalog, [], undefined, { withOptional: true })!;
    expect(describeRecipeNutritionRange(low, high)).toBe('≈ 100–225 cal, 10–14g protein per serving, the higher with every optional line');
    expect(describeRecipeNutritionRange(low, low)).toBe(describeRecipeNutrition(low));
    expect(describeRecipeNutritionRange(low, null)).toBe(describeRecipeNutrition(low));
    expect(describeRecipeNutritionRange(null, high)).toBeNull();
  });
});

describe('an "either one" pair', () => {
  const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };
  const butter = item({ name: 'Butter', nutrition: panel({ amounts: { calorieKcal: 700 } }) });
  const vegan = item({ name: 'Vegan butter', nutrition: panel({ amounts: { calorieKcal: 600 } }) });
  const pairKey = eitherPairKey(butter.nameKey, vegan.nameKey);
  const links = [
    { itemId: butter.id, subItemId: vegan.id, note: null, createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false, either: true },
    { itemId: vegan.id, subItemId: butter.id, note: null, createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false, either: true },
  ];
  const catalog = [butter, vegan];
  const swaps = () => standingSwapMap(links, catalog);
  const loaf = () => recipe('Banana bread', [ing('Butter', { quantity: '100 g' })]);
  const kcal = (r: Recipe, resolution?: Parameters<typeof recipeNutrition>[4]) =>
    recipeNutrition(r, catalog, [], new Map([[r.id, r]]), resolution, 1, swaps())?.total.calorieKcal;

  it('reads the line as written for a read with no cooking in hand', () => {
    // The recipe page and every other context-free read: nothing changed.
    expect(kcal(loaf())).toBe(700);
  });

  it('refuses to put figures on a cooking that has not said which was used', () => {
    expect(kcal(loaf(), { itemPicks: [] })).toBeUndefined();
    expect(recipeNutritionLines(loaf(), catalog, [], new Map(), { itemPicks: [] }, 1, swaps())).toEqual([]);
    expect(kcal(loaf(), UNANSWERED)).toBeUndefined();
  });

  it('measures the item that was used, either way round', () => {
    expect(kcal(loaf(), { itemPicks: [{ pair: pairKey, use: 'vegan butter' }] })).toBe(600);
    expect(kcal(loaf(), { itemPicks: [{ pair: pairKey, use: 'butter' }] })).toBe(700);
  });

  it('answers every recipe in the cooking with the one pick, through a used recipe', () => {
    const glaze = recipe('Glaze', [ing('Vegan butter', { quantity: '100 g' })]);
    const cake = recipe('Cake', [ing('Butter', { quantity: '100 g' })], {
      components: [{ id: 'c1', recipeId: glaze.id, name: 'Glaze', choiceGroup: null }],
    });
    const byId = new Map([[cake.id, cake], [glaze.id, glaze]]);
    const asked = entryResolution({ recipeChoices: [], recipeOverrides: [], itemPicks: [{ pair: pairKey, use: 'butter' }] });
    expect(recipeNutrition(cake, catalog, [], byId, asked, 1, swaps())?.total.calorieKcal).toBe(1400);
    const vegans = entryResolution({ recipeChoices: [], recipeOverrides: [], itemPicks: [{ pair: pairKey, use: 'vegan butter' }] });
    expect(recipeNutrition(cake, catalog, [], byId, vegans, 1, swaps())?.total.calorieKcal).toBe(1200);
  });

  it('treats a planned meal as a cooking in hand, so entryResolution refuses until it is answered', () => {
    const r = loaf();
    expect(recipeNutrition(r, catalog, [], new Map([[r.id, r]]), entryResolution(entry('2026-08-10', r.id)), 1, swaps())).toBeNull();
    expect(recipeNutrition(
      r, catalog, [], new Map([[r.id, r]]),
      entryResolution(entry('2026-08-10', r.id, { itemPicks: [{ pair: pairKey, use: 'vegan butter' }] })), 1, swaps(),
    )?.total.calorieKcal).toBe(600);
  });

  it('is unaffected for a dish that names neither item', () => {
    const toast = recipe('Toast', [ing('Butter', { quantity: '100 g', noSwap: true })]);
    expect(kcal(toast, { itemPicks: [] })).toBe(700);
  });

  it('counts an unanswered planned meal against the week rather than as either item', () => {
    const r = loaf();
    const byId = new Map([[r.id, r]]);
    expect(weekNutrition([entry('2026-08-10', r.id)], byId, catalog, RANGE, [], swaps())).toBeNull();
    const answered = entry('2026-08-10', r.id, { itemPicks: [{ pair: pairKey, use: 'vegan butter' }] });
    expect(weekNutrition([answered], byId, catalog, RANGE, [], swaps())?.total.calorieKcal).toBe(600);
  });
});

describe('the week and the recipe page agree', () => {
  const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };

  it('weighs a line by its prep in the week, as the recipe page does', () => {
    const dish = recipe('Soup', [ing('Onion', { quantity: '1 cup', prep: 'chopped' })]);
    const catalog = [item({
      name: 'Onion',
      nutrition: panel({
        amounts: { calorieKcal: 40 },
        portions: [{ amount: 1, label: 'cup, chopped', grams: 160 }, { amount: 1, label: 'cup, sliced', grams: 115 }],
      }),
    })];
    const page = recipeNutrition(dish, catalog)!;
    const week = weekNutrition([entry('2026-08-11', dish.id)], new Map([[dish.id, dish]]), catalog, RANGE)!;
    expect(week.total.calorieKcal).toBe(page.total.calorieKcal);
    expect(week.covered).toBe(1);
  });

  it('counts only the share of a used recipe the dish eats, in the week too', () => {
    const mix = recipe('Mix', [ing('Salt mix', { quantity: '100 g' })], { recipeYield: '4 tbsp' });
    const fish = recipe('Fish', [ing('Cod', { quantity: '100 g' })], {
      components: [{ id: 'c-mix', recipeId: mix.id, name: 'Mix', choiceGroup: null, amountUsed: '1 tbsp' }],
    });
    const byId = new Map([[mix.id, mix], [fish.id, fish]]);
    const catalog = [item({ name: 'Cod', nutrition: panel() }), item({ name: 'Salt mix', nutrition: panel() })];
    const page = recipeNutrition(fish, catalog, [], byId)!;
    const week = weekNutrition([entry('2026-08-11', fish.id)], byId, catalog, RANGE)!;
    expect(page.total.calorieKcal).toBe(125);
    expect(week.total.calorieKcal).toBe(125);
  });
});

describe('a used recipe on both sides of an either/or', () => {
  it('counts it at the share of the side the meal picked', () => {
    const mix = recipe('Mix', [ing('Salt mix', { quantity: '120 g' })], { recipeYield: '12 tbsp' });
    const fries = recipe('Fries', [], { components: [{ id: 'c-f', recipeId: mix.id, name: 'Mix', choiceGroup: null, amountUsed: '1 tbsp' }] });
    const wings = recipe('Wings', [], { components: [{ id: 'c-w', recipeId: mix.id, name: 'Mix', choiceGroup: null, amountUsed: '6 tbsp' }] });
    const dinner = recipe('Dinner', [], {
      components: [
        { id: 'c-fries', recipeId: fries.id, name: 'Fries', choiceGroup: 'Side' },
        { id: 'c-wings', recipeId: wings.id, name: 'Wings', choiceGroup: 'Side' },
      ],
    });
    const byId = new Map([mix, fries, wings, dinner].map(r => [r.id, r]));
    const catalog = [item({ name: 'Salt mix', nutrition: panel() })];
    const read = recipeNutrition(dinner, catalog, [], byId, { chosen: ['c-wings'] })!;
    // Half of 120 g at 100 kcal/100g.
    expect(read.total.calorieKcal).toBe(60);
  });
});

describe('water', () => {
  it('is not a line of the dish, so it is neither a gap nor something to add to the catalog', () => {
    const dish = recipe('Brine', [ing('Salt', { quantity: '50 g' }), ing('Cold water', { quantity: '2 cups' })]);
    const read = readRecipeNutrition(dish, [item({ name: 'Salt', nutrition: panel() })]);
    expect(read.lines.map(l => l.name)).toEqual(['Salt']);
    expect(read.gaps.unmatched).toEqual([]);
  });
});

describe('a generic covered by a declared variety', () => {
  it('reads the variety, as the catalog review sheet links it', () => {
    const dish = recipe('Soup', [ing('Onion', { quantity: '100 g' })]);
    const white = item({ name: 'White onion', varietyOfKey: 'onion', nutrition: panel({ amounts: { calorieKcal: 40 } }) });
    const read = readRecipeNutrition(dish, [white]);
    expect(read.lines[0].state).toBe('covered');
    expect(read.nutrition!.total.calorieKcal).toBe(40);
  });
});

describe('estimateRequestLine', () => {
  it('says how little of a line reaches the dish when it is not all of it', () => {
    const base = { id: 'x', recipeId: 'r', name: 'Olive oil', quantity: '3 tbsp', prep: null, state: 'unmatched', item: null, product: null, nutrition: null, multiplier: null } as const;
    expect(estimateRequestLine({ ...base, share: 1 })).toBe('3 tbsp Olive oil');
    expect(estimateRequestLine({ ...base, share: 0.25 })).toBe('3 tbsp Olive oil (only about 25% of this ends up in the dish)');
    expect(estimateRequestLine({ ...base, share: 1, componentShare: 0.5, prep: 'warmed' }))
      .toBe('3 tbsp Olive oil, warmed (only about 50% of this ends up in the dish)');
  });
});
