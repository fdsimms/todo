import type { FoodNutrition, GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { choiceGroupKey } from '../utils/recipeComponents';
import {
  describeNutritionCoverage,
  describeRecipeNutrition,
  describeWeekNutrition,
  nutritionGaps,
  perServing,
  readRecipeNutrition,
  recipeNutrition,
  recipeNutritionLines,
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
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients,
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
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
    recipeChoices: [],
    personIds: [],
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
});
