import { addDays } from 'date-fns/addDays';
import { subDays } from 'date-fns/subDays';
import { setHours } from 'date-fns/setHours';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { GroceryItem, MealSlot, Recipe, Shop } from '../types';
import { buildWeekDays } from './calendarGrid';
import { getCurrentDayStart, dayKeyOf } from './dateUtils';
import { groceryNameKey } from './groceryParse';
import { OUT_OF_IT_UNTIL, defaultOnHandUntil } from './grocerySuggest';
import { generateId } from './id';

// Seeds a whole plausible-looking task list into whatever database is
// currently active. Demo mode points the db at a throwaway file first (see
// useDemoStore), so this only ever writes to that file — it must never be
// called against the user's real data.
//
// Everything goes through the normal store actions rather than raw db
// inserts, so seeded rows get exactly the same defaults, sort orders and
// derived fields a hand-created task would, and can't drift from the Task
// type as fields are added.
//
// The shape of the list matters as much as the contents: the demo is the
// whole app now, not one screen, so every view needs something in it —
// Today, Later, Unscheduled, Inbox, Projects, Logbook and Stats, plus the
// groceries/recipes/meal-plan hub and the fridge.
//
// **A feature with no demo data is a feature the demo says the app doesn't
// have.** Empty states are their own thing to show, but only for genuinely
// empty-by-default surfaces — an unused capability (composed recipes, choice
// groups, per-store links, leftovers) reads as missing rather than unused. So
// a change that adds a user-facing capability should add the one row here that
// makes it visible, in the same PR.
export function seedDemoData(): void {
  const {
    addTask,
    addSubtask,
    updateTask,
    completeTask,
    addNewGroupedTask,
    addExistingToProject,
    addTag,
  } = useTaskStore.getState();
  const { addCategory, setCategoryEmoji } = useCategoryStore.getState();
  const { createProject } = useProjectStore.getState();
  const { createGroup } = useTaskGroupStore.getState();

  const today = getCurrentDayStart();

  // --- Categories & tags ---------------------------------------------------
  const CATEGORIES: Array<[string, string]> = [
    ['Work', '💼'],
    ['Home', '🏠'],
    ['Health', '🌱'],
    ['Errands', '🛒'],
  ];
  CATEGORIES.forEach(([name, emoji]) => {
    addCategory(name);
    setCategoryEmoji(name, emoji);
  });
  ['bills', 'quick', 'reading', 'admin'].forEach(addTag);

  // --- Today ---------------------------------------------------------------
  addTask({
    title: 'Send the Q3 roadmap to Priya',
    notes: 'Draft is in the shared folder — just needs the headcount slide.',
    category: 'Work',
    priority: 4,
    effort: 2,
    dueDate: today.toISOString(),
    deadline: addDays(today, 2).toISOString(),
    tags: ['admin'],
    pinned: true,
  });

  addTask({
    title: 'Pay the electricity bill',
    category: 'Home',
    priority: 3,
    effort: 1,
    dueDate: today.toISOString(),
    tags: ['bills', 'quick'],
  });

  const standup = addTask({
    title: 'Morning standup',
    notes: 'Fifteen minutes, camera optional.',
    category: 'Work',
    recurrenceType: 'weekly',
    recurrenceDays: [1, 2, 3, 4, 5],
    timeSegments: ['morning'],
    effort: 1,
  });
  updateTask(standup.id, { streakCount: 9, streakDate: subDays(today, 1).toISOString() });

  const meditate = addTask({
    title: 'Ten minutes of quiet',
    notes: 'Streaks survive a vacation — this one is paused while Vacation mode is on.',
    category: 'Health',
    recurrenceType: 'daily',
    vacationPause: true,
    effort: 1,
  });
  updateTask(meditate.id, { streakCount: 23, streakDate: subDays(today, 1).toISOString() });

  addTask({
    title: 'Read a chapter of the Le Guin',
    category: 'Health',
    timeSegments: ['evening'],
    tags: ['reading'],
    effort: 2,
  });

  // The postpone check has nothing to show until a task has actually been
  // ducked a few times, and a fresh demo database has no history — so the count
  // is stamped on directly. Opening this one's date picker is the whole feature:
  // it's the classic put-off-able errand, and the banner offers a way out.
  // (updateTask honours an explicit postponeCount instead of re-deriving one,
  // which is the same door every undo goes through.)
  const dentist = addTask({
    title: 'Book the dentist',
    notes: 'Been meaning to do this since the reminder card arrived.',
    category: 'Errands',
    dueDate: today.toISOString(),
    priority: 2,
    effort: 1,
    tags: ['admin'],
  });
  updateTask(dentist.id, { postponeCount: 5 });

  addTask({
    title: 'Swing by the farmers market',
    notes: 'Only worth doing between 8 and 1 — after that the good stalls are gone.',
    category: 'Errands',
    dueDate: today.toISOString(),
    windowStart: '08:00',
    windowEnd: '13:00',
    effort: 2,
  });

  const morningRoutine = addTask({
    title: 'Morning routine',
    notes: 'A chain: finishing one step immediately hands you the next.',
    category: 'Health',
    chainEnabled: true,
    chainIndex: 0,
    chainItems: [
      { id: generateId(), title: 'Make the bed', estimatedMinutes: null },
      { id: generateId(), title: 'Stretch for five minutes', estimatedMinutes: null },
      { id: generateId(), title: 'Glass of water', estimatedMinutes: null },
    ],
  });
  updateTask(morningRoutine.id, { effort: 1 });

  // A number on a task is what puts the call/text button on its row — with no
  // row carrying one, that button and the Phone field both read as features
  // the app doesn't have.
  addTask({
    title: 'Call the dentist about the crown',
    notes: 'Ask whether the temporary needs replacing before the trip.',
    category: 'Health',
    dueDate: today.toISOString(),
    phoneNumber: '(555) 123-4567',
    effort: 1,
  });

  // The other two kinds the editor's Kind picker offers. Without a row apiece
  // the picker names two features demo mode can't show you.
  addTask({
    title: 'Practise the piano',
    notes: 'A timed task: the row counts down once you start it.',
    category: 'Health',
    dueDate: today.toISOString(),
    timedMinutes: 25,
    estimatedMinutes: 25,
    effort: 2,
  });

  const water = addTask({
    title: 'Drink a glass of water',
    notes: 'A daily target: log it through the day, and it only surfaces when you fall behind.',
    category: 'Health',
    dueDate: today.toISOString(),
    targetCount: 6,
    targetUnit: 'glasses',
    // A target resets by spawning its next occurrence, so it always repeats.
    recurrenceType: 'daily',
    recurrenceInterval: 1,
  });
  // Part-done, so the meter on the row reads as a meter rather than an empty bar.
  updateTask(water.id, { progressCount: 2 });

  // --- A stack (three independently-scheduled tasks under one label) --------
  const supplements = createGroup('Supplements', 'Health');
  addNewGroupedTask(supplements.id, 'Vitamin D');
  addNewGroupedTask(supplements.id, 'Omega-3');
  const iron = addNewGroupedTask(supplements.id, 'Iron');
  updateTask(iron.id, { timeSegments: ['evening'] });

  // --- Later (deferred / future-dated) -------------------------------------
  addTask({
    title: 'Renew the passport',
    notes: 'Six weeks of processing time, so this needs starting well before the trip.',
    category: 'Errands',
    priority: 4,
    effort: 3,
    dueDate: addDays(today, 9).toISOString(),
    deadline: addDays(today, 21).toISOString(),
  });

  addTask({
    title: 'Draft the quarterly report',
    notes: 'Nothing to do until the numbers land on Thursday.',
    category: 'Work',
    deferUntil: addDays(today, 3).toISOString(),
    effort: 4,
    priority: 2,
  });

  addTask({
    title: 'Water the plants',
    category: 'Home',
    recurrenceType: 'weekly',
    recurrenceDays: [1, 4],
    dueDate: addDays(today, 1).toISOString(),
    effort: 1,
  });

  addTask({
    title: 'Dentist — 2:40pm',
    category: 'Health',
    dueDate: addDays(today, 5).toISOString(),
    reminderTime: setHours(addDays(today, 5), 13).toISOString(),
    effort: 1,
  });

  // --- Unscheduled (organized, but no date) --------------------------------
  addTask({
    title: 'Deep clean the garage',
    notes: 'Effort is a size, not a time estimate — this one is an XL.',
    category: 'Home',
    effort: 6,
    priority: 1,
  });

  addTask({
    title: 'Find a decent standing desk',
    category: 'Work',
    tags: ['admin'],
    effort: 3,
  });

  addTask({
    title: 'Reread the Vonnegut essays',
    category: 'Health',
    tags: ['reading'],
    effort: 2,
  });

  // --- Inbox (captured, not yet filed — no metadata at all) ----------------
  addTask({ title: 'Look into the bike repair place on 4th' });
  addTask({ title: 'Ask Sam about the cabin in October' });

  // --- A project -----------------------------------------------------------
  const kitchen = createProject(
    'Kitchen refresh',
    today.toISOString(),
    addDays(today, 45).toISOString(),
  );
  const projectTasks = [
    { title: 'Measure the counters', effort: 1 as const, done: true },
    { title: 'Pick a tile', effort: 2 as const, done: true },
    { title: 'Get three quotes', effort: 3 as const, done: false },
    { title: 'Book the installer', effort: 2 as const, done: false },
  ];
  projectTasks.forEach(({ title, effort, done }) => {
    const t = addTask({ title, category: 'Home', effort });
    addExistingToProject(t.id, kitchen.id);
    if (done) completeTask(t.id);
  });

  // --- Subtasks ------------------------------------------------------------
  const trip = addTask({
    title: 'Plan the Japan trip',
    notes: 'Subtasks track their own progress count without cluttering Today.',
    category: 'Errands',
    effort: 4,
    deferUntil: addDays(today, 2).toISOString(),
  });
  ['Book flights', 'Reserve the ryokan', 'Sort a JR pass'].forEach(title => {
    addSubtask(trip.id, title);
  });

  // --- History, so Logbook and Stats aren't empty --------------------------
  const HISTORY: Array<[string, string, number]> = [
    ['Reply to the landlord', 'Home', 0],
    ['Ship the pricing changes', 'Work', 0],
    ['Pick up the dry cleaning', 'Errands', 1],
    ['Weekly review', 'Work', 1],
    ['Call Mum', 'Home', 2],
    ['Refill the prescription', 'Health', 2],
    ['Cancel the unused subscription', 'Home', 3],
    ['Fix the flaky login test', 'Work', 4],
  ];
  HISTORY.forEach(([title, category, daysAgo]) => {
    const t = addTask({ title, category, effort: 2 });
    completeTask(t.id);
    // completeTask stamps "now"; back-date it so the Logbook shows several
    // days of history and Stats has a real streak/trend to draw.
    const at = subDays(today, daysAgo);
    updateTask(t.id, { completedAt: setHours(at, 17).toISOString() });
  });

  // --- Groceries, recipes, the week's meals and the fridge -----------------
  // Ordered by what points at what: recipes first (grocery rows can be
  // attributed to the recipe that put them on the list), then the catalog,
  // then the plan that references both, then the leftovers a cooked meal left.
  const recipes = seedRecipes();
  seedGroceries(recipes);
  seedMealPlanAndFridge(recipes, today);
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** The recipe ids the plan and the fridge below need to point at. */
interface DemoRecipes {
  mash: string;
  roasties: string;
  salad: string;
  oats: string;
  sandwich: string;
  stirFry: string;
  salmon: string;
  steak: string;
  cake: string;
  tea: string;
  snacks: string;
}

/**
 * addRecipe refuses a name the box already holds. Every name below is distinct
 * and the demo database is wiped before seeding, so the fallback is
 * unreachable — it's there so a duplicate introduced later degrades to a
 * shared recipe rather than throwing out of enterDemoMode.
 */
function newRecipe(name: string): Recipe {
  const created = useRecipeStore.getState().addRecipe(name);
  if (created) return created;
  const key = groceryNameKey(name);
  return useRecipeStore.getState().recipes.find(r => r.nameKey === key)!;
}

/** An ingredient row's id, by the name it was parsed down to. Null if the line didn't take. */
function ingredientIdNamed(recipeId: string, name: string): string | null {
  const key = groceryNameKey(name);
  return (
    useRecipeStore.getState().recipeById(recipeId)?.ingredients.find(i => i.nameKey === key)?.id ??
    null
  );
}

/** A component *link's* id (not the recipe it points at) — what recipeChoices names. */
function componentIdFor(parentId: string, childRecipeId: string): string | null {
  return (
    useRecipeStore.getState().recipeById(parentId)?.components.find(c => c.recipeId === childRecipeId)
      ?.id ?? null
  );
}

/**
 * The recipe box. Deliberately covers every RecipeMealType, since the box
 * groups by it and a missing type reads as a missing section, and one instance
 * of each of the features that are otherwise invisible: components (shared and
 * either/or), ingredient alternatives, sections, prep tasks, both duration
 * fields, a live cook timer, cook history, and all three attribution shapes.
 */
function seedRecipes(): DemoRecipes {
  const {
    addIngredientsFromText,
    updateIngredient,
    addComponent,
    addPrepTask,
    updatePrepTask,
    setMealType,
    setTags,
    setNotes,
    setServings,
    setRecipeYield,
    setSourceUrl,
    setAuthor,
    setSource,
    setSourceType,
    setSourcePage,
    setEstimatedMinutes,
    setPrepMinutes,
    toggleFavorite,
    markCooked,
    startCookTimer,
  } = useRecipeStore.getState();

  // --- Sides, first: the two dinners below reference them as components ----
  const mash = newRecipe('Mashed potatoes');
  addIngredientsFromText(
    mash.id,
    ['2 lb potatoes, peeled and quartered', '4 tbsp butter', '1/2 cup milk', '1 tsp salt'].join('\n')
  );
  setMealType(mash.id, 'side');
  setServings(mash.id, 4);
  setEstimatedMinutes(mash.id, 25);
  setPrepMinutes(mash.id, 10);

  const roasties = newRecipe('Roast potatoes');
  addIngredientsFromText(
    roasties.id,
    ['2 lb potatoes, peeled and halved', '3 tbsp olive oil', '1 bunch rosemary', '1 tsp salt'].join('\n')
  );
  setMealType(roasties.id, 'side');
  setServings(roasties.id, 4);
  setEstimatedMinutes(roasties.id, 45);

  const salad = newRecipe('Simple green salad');
  addIngredientsFromText(
    salad.id,
    ['1 head lettuce', '1 shallot, thinly sliced', '1 lemon for the dressing', '3 tbsp olive oil'].join('\n')
  );
  setMealType(salad.id, 'side');
  setServings(salad.id, 4);
  setEstimatedMinutes(salad.id, 10);

  const salsaVerde = newRecipe('Salsa verde');
  addIngredientsFromText(
    salsaVerde.id,
    ['6 tomatillos, husked', '1 jalapeno', '1/2 white onion', '1 bunch cilantro', '1 clove garlic'].join('\n')
  );
  setMealType(salsaVerde.id, 'condiment');
  setRecipeYield(salsaVerde.id, '2 cups');
  setEstimatedMinutes(salsaVerde.id, 15);

  // --- Breakfast, lunch, snack, dessert, beverage --------------------------
  const oats = newRecipe('Overnight oats');
  addIngredientsFromText(
    oats.id,
    ['1 cup rolled oats', '1 cup milk', '1 tbsp honey', '1/2 cup blueberries'].join('\n')
  );
  setMealType(oats.id, 'breakfast');
  setTags(oats.id, ['make ahead']);
  setNotes(oats.id, 'Assembles in about five minutes the night before. Keeps three days in a jar.');
  setServings(oats.id, 2);
  setPrepMinutes(oats.id, 10);
  toggleFavorite(oats.id);

  const sandwich = newRecipe('Turkey and avocado sandwich');
  addIngredientsFromText(
    sandwich.id,
    ['2 slices sourdough', '4 slices sliced turkey', '1 avocado', '1 tbsp mayonnaise', '1 cup spinach'].join('\n')
  );
  setMealType(sandwich.id, 'lunch');
  setTags(sandwich.id, ['quick', 'no cook']);
  setServings(sandwich.id, 1);
  setEstimatedMinutes(sandwich.id, 10);

  const snacks = newRecipe('Hummus snack plate');
  addIngredientsFromText(
    snacks.id,
    ['1 cup hummus', '1 cucumber, sliced', '2 carrots, cut into sticks', '1 pita bread'].join('\n')
  );
  setMealType(snacks.id, 'snack');
  setTags(snacks.id, ['no cook']);
  setServings(snacks.id, 2);

  const cake = newRecipe('Carrot cake with cream cheese frosting');
  addIngredientsFromText(
    cake.id,
    // The one recipe written in metric, and it's the one copied out of a
    // British cookbook — which is also how a real library ends up mixed. It's
    // what the Units setting has to convert *from* when it's set to US; every
    // other recipe here covers the other direction.
    [
      '250 g flour',
      '3 carrots, grated',
      '200 g brown sugar',
      '3 eggs',
      '1 tsp cinnamon',
      '225 g cream cheese',
      '115 g butter',
      '400 g sugar',
    ].join('\n')
  );
  setMealType(cake.id, 'dessert');
  setTags(cake.id, ['baking', 'make ahead']);
  // Sections — a label on the flat ingredient list, not a nested type.
  ([
    ['flour', 'For the cake'],
    ['carrots', 'For the cake'],
    ['brown sugar', 'For the cake'],
    ['eggs', 'For the cake'],
    ['cinnamon', 'For the cake'],
    ['cream cheese', 'For the frosting'],
    ['butter', 'For the frosting'],
    ['sugar', 'For the frosting'],
  ] as const).forEach(([name, section]) => {
    const id = ingredientIdNamed(cake.id, name);
    if (id) updateIngredient(cake.id, id, { section });
  });
  setRecipeYield(cake.id, '1 9-inch cake');
  setServings(cake.id, 12);
  setEstimatedMinutes(cake.id, 45);
  setPrepMinutes(cake.id, 30);
  // The cookbook attribution shape — the only one a page number means anything for.
  setAuthor(cake.id, 'Yotam Ottolenghi');
  setSource(cake.id, 'Sweet');
  setSourceType(cake.id, 'cookbook');
  setSourcePage(cake.id, '148');

  const tea = newRecipe('Iced mint tea');
  addIngredientsFromText(tea.id, ['4 tea bags', '1 bunch mint', '2 lemons', '1/4 cup honey'].join('\n'));
  setMealType(tea.id, 'beverage');
  setRecipeYield(tea.id, '2 quarts');
  setEstimatedMinutes(tea.id, 10);

  // --- Dinners -------------------------------------------------------------
  const stirFry = newRecipe('Weeknight chicken stir-fry');
  addIngredientsFromText(
    stirFry.id,
    [
      '2 chicken breasts',
      '1 red bell pepper',
      '2 tbsp soy sauce',
      '2 cloves garlic, peeled and sliced',
      '2 cups rice',
      '1 serrano chile',
      '1 jalapeno',
    ].join('\n')
  );
  setMealType(stirFry.id, 'dinner');
  // Two recipes share "weeknight" so the box's tag filter has something to
  // actually narrow, and one carries a second tag so combining two chips has a
  // visible effect.
  setTags(stirFry.id, ['weeknight', 'quick']);
  // Either/or ingredients — two rows sharing a group, never one line reading
  // "serrano or jalapeño" (see RecipeIngredient.choiceGroup).
  ['serrano chile', 'jalapeno'].forEach(name => {
    const id = ingredientIdNamed(stirFry.id, name);
    if (id) updateIngredient(stirFry.id, id, { choiceGroup: 'Chile' });
  });
  setServings(stirFry.id, 4, 6);
  setEstimatedMinutes(stirFry.id, 20);
  setPrepMinutes(stirFry.id, 15);
  setSourceType(stirFry.id, 'homeRecipe');
  const marinate = addPrepTask(stirFry.id, 'Slice the chicken and marinate');
  if (marinate) updatePrepTask(stirFry.id, marinate.id, { offsetDays: 0, reminderOffsetMinutes: 60 });
  // Cooked often enough to have a history worth reading.
  [0, 1, 2, 3, 4].forEach(() => markCooked(stirFry.id));
  // Tonight's dinner, mid-cook — the one place a live timer shows up.
  startCookTimer(stirFry.id);

  const salmon = newRecipe('Lemon garlic salmon');
  addIngredientsFromText(
    salmon.id,
    ['2 salmon fillets', '1 lemon', '2 cloves garlic', '2 tbsp butter', '1 bunch asparagus'].join('\n')
  );
  setMealType(salmon.id, 'dinner');
  setTags(salmon.id, ['weeknight']);
  setServings(salmon.id, 2);
  setEstimatedMinutes(salmon.id, 25);
  // The website attribution shape: a person and a publication, independently.
  setSourceUrl(salmon.id, 'https://www.example-recipes.com/lemon-garlic-salmon');
  setAuthor(salmon.id, 'Alison Roman');
  setSource(salmon.id, 'NYT Cooking');
  setSourceType(salmon.id, 'website');
  const defrost = addPrepTask(salmon.id, 'Move the salmon to the fridge to defrost');
  if (defrost) updatePrepTask(salmon.id, defrost.id, { offsetDays: -1, reminderOffsetMinutes: 120 });
  [0, 1].forEach(() => markCooked(salmon.id));
  // The shared component — the same mash inside two different dinners, which
  // is the whole point of a reference rather than a copy.
  addComponent(salmon.id, mash.id);

  const steak = newRecipe('Seared steak with potatoes');
  addIngredientsFromText(
    steak.id,
    ['2 lb steak', '2 tbsp butter', '1 bunch thyme', '1 tsp salt'].join('\n')
  );
  setMealType(steak.id, 'dinner');
  setTags(steak.id, ['weekend']);
  setServings(steak.id, 2);
  setEstimatedMinutes(steak.id, 20);
  setNotes(steak.id, 'Cast iron, screaming hot, and let it rest as long as it cooked.');
  // Either/or components: one of the two potatoes gets cooked, never both.
  // The default is the group's first link in list order, so mash is the usual.
  addComponent(steak.id, mash.id, 'Potatoes');
  addComponent(steak.id, roasties.id, 'Potatoes');
  // ...and one unconditional component alongside them.
  addComponent(steak.id, salad.id);
  const rest = addPrepTask(steak.id, 'Take the steak out of the fridge');
  if (rest) updatePrepTask(steak.id, rest.id, { offsetDays: 0, reminderOffsetMinutes: 45 });
  markCooked(steak.id);
  toggleFavorite(steak.id);

  return {
    mash: mash.id,
    roasties: roasties.id,
    salad: salad.id,
    oats: oats.id,
    sandwich: sandwich.id,
    stirFry: stirFry.id,
    salmon: salmon.id,
    steak: steak.id,
    cake: cake.id,
    tea: tea.id,
    snacks: snacks.id,
  };
}

// ---------------------------------------------------------------------------
// Groceries
// ---------------------------------------------------------------------------

/** Same unreachable-fallback shape as newRecipe, for the shops. */
function newShop(name: string): Shop {
  const created = useGroceryStore.getState().addShop(name);
  if (created) return created;
  const key = groceryNameKey(name);
  return useGroceryStore.getState().shops.find(s => s.nameKey === key)!;
}

function itemNamed(name: string): GroceryItem {
  const key = groceryNameKey(name);
  return useGroceryStore.getState().items.find(i => i.nameKey === key)!;
}

function idsNamed(names: readonly string[]): string[] {
  return names.map(n => itemNamed(n).id);
}

/**
 * The catalog, three trips' worth of purchase history, a walk order the user
 * has clearly edited, and a list that's mid-trip.
 *
 * Most names are ones the offline lexicon (groceryAisles.ts) already places, so
 * the sections fill themselves; the hand-filed ones exist precisely to show
 * that a filing by hand outranks the lexicon and is remembered.
 */
function seedGroceries(recipes: DemoRecipes): void {
  const {
    addByName,
    addExistingMany,
    addFromPlan,
    setCheckedMany,
    clearList,
    setQuantity,
    setNote,
    setAisle,
    setAisleOrder,
    setOnHandUntil,
    finishShopping,
    addAisle,
    deleteAisle,
    linkItemShop,
    linkItemShopMany,
    markItemsUnavailable,
    setShopExcludedFromSuggestions,
    itemById,
  } = useGroceryStore.getState();

  const CATALOG = [
    // Dairy & Eggs
    'Milk', 'Eggs', 'Greek yogurt', 'Butter', 'Cheddar',
    // Produce
    'Spinach', 'Bananas', 'Tomatoes', 'Onions', 'Garlic', 'Lemons',
    // Meat & Seafood
    'Chicken breast', 'Ground beef',
    // Pantry / Canned
    'Pasta', 'Rice', 'Olive oil', 'Peanut butter', 'Black beans',
    // Bakery
    'Bread', 'Tortillas',
    // Beverages / Breakfast
    'Coffee', 'Sparkling water', 'Rolled oats',
    // Frozen / Snacks
    'Frozen peas', 'Ice cream', 'Almonds', 'Chips',
    // Household
    'Paper towels', 'Toilet paper', 'Dish soap',
  ];
  CATALOG.forEach(name => addByName(name, undefined, undefined, { registerUndo: false }));

  // Quantities and notes — free text, nothing does arithmetic on either.
  setQuantity(itemNamed('Milk').id, '2 gal');
  setQuantity(itemNamed('Ground beef').id, '2 lb');
  setQuantity(itemNamed('Bananas').id, 'a bunch');
  setNote(itemNamed('Black beans').id, 'The low-sodium ones');
  setNote(itemNamed('Bread').id, 'Seeded, from the back shelf');

  const traderJoes = newShop("Trader Joe's");
  const costco = newShop('Costco');
  // "It has everything, but don't send me there" — kept fully available for
  // linking by hand while being pulled out of every suggestion.
  const amazon = newShop('Amazon');
  setShopExcludedFromSuggestions(amazon.id, true);

  // Three finished trips, so Buy again and the autocomplete ranking have a
  // real spread of purchase counts to sort by rather than a flat list of ones.
  // Finishing a trip promotes what was on it into the catalog, records the
  // purchase against the store, and takes it off the list.
  const WEEKLY_SHOP = ['Milk', 'Eggs', 'Spinach', 'Bananas', 'Bread', 'Chicken breast', 'Tomatoes', 'Coffee'];
  const BULK_RUN = ['Paper towels', 'Toilet paper', 'Olive oil', 'Rice', 'Frozen peas'];

  setCheckedMany(idsNamed(WEEKLY_SHOP), true);
  finishShopping(traderJoes.id);

  addExistingMany(idsNamed(BULK_RUN));
  setCheckedMany(idsNamed(BULK_RUN), true);
  finishShopping(costco.id);

  addExistingMany(idsNamed(WEEKLY_SHOP));
  setCheckedMany(idsNamed(WEEKLY_SHOP), true);
  finishShopping(traderJoes.id);

  // A trip with no store named — a first-class answer, and the reason an
  // item's own purchaseCount runs ahead of the sum of its per-store links.
  const CORNER_SHOP = ['Greek yogurt', 'Butter'];
  addExistingMany(idsNamed(CORNER_SHOP));
  setCheckedMany(idsNamed(CORNER_SHOP), true);
  finishShopping(null);

  // Everything typed above is still sitting on the list, since only what a
  // trip actually bought came off it. Clearing promotes the stragglers into
  // the catalog without counting them as bought, so what's on the list below
  // is the list someone chose rather than the leavings of the seed order.
  clearList();

  // "I can get this here" with no trip behind it — an assertion, not an
  // observation. Almonds are linked to Costco alone, so they read as available
  // at exactly one store.
  linkItemShop(itemNamed('Almonds').id, costco.id);
  linkItemShopMany(idsNamed(['Peanut butter', 'Ground beef']), costco.id);
  linkItemShopMany(idsNamed(['Dish soap', 'Toilet paper']), amazon.id);

  // And the opposite claim, which is the only thing that can tell "never
  // bought here" from "they don't stock it". Tortillas are marked absent at
  // Trader Joe's — a store with plenty else on record, so the trip planner has
  // to route round one item rather than write the shop off — and Almonds at
  // Trader Joe's too, where Costco is the answer.
  markItemsUnavailable(idsNamed(['Tortillas', 'Almonds']), traderJoes.id);

  // The pantry override, both directions. "Got it" parks an item as on hand
  // for a while; "Out of it" is the user overruling the purchase-history guess
  // with their own hands.
  const rice = itemById(itemNamed('Rice').id);
  if (rice) setOnHandUntil(rice.id, defaultOnHandUntil(rice, new Date()));
  setOnHandUntil(itemNamed('Olive oil').id, OUT_OF_IT_UNTIL);

  // A walk order the user has clearly edited: a custom section they file two
  // things into by hand, a built-in they never shop deleted (which leaves the
  // tombstone that stops normalizeAisleOrder re-appending it), and Frozen
  // moved to the end because that's the last thing you want in the trolley.
  const bulkBins = addAisle('Bulk bins');
  if (bulkBins) {
    setAisle(itemNamed('Almonds').id, bulkBins);
    setAisle(itemNamed('Rice').id, bulkBins);
  }
  deleteAisle('Personal Care');
  const order = useGroceryStore.getState().aisleOrder;
  setAisleOrder([...order.filter(a => a !== 'Frozen'), 'Frozen']);

  // What's on the list right now, with two things already in the trolley — the
  // state the finish-shopping sheet is for.
  const ON_LIST = ['Milk', 'Eggs', 'Bananas', 'Bread', 'Cheddar', 'Tortillas', 'Sparkling water', 'Ice cream'];
  addExistingMany(idsNamed(ON_LIST));
  setCheckedMany(idsNamed(['Milk', 'Bananas']), true);

  // ...plus tonight's dinner, added off the recipe, so a few rows carry "from
  // Weeknight chicken stir-fry" rather than looking hand-typed.
  // The aisles come from the ingredient rows the sheet reviewed, not from the
  // lexicon — "red bell pepper" would otherwise land under Baking & Spices on
  // its last token, and "serrano chile" is a name the lexicon has never heard.
  addFromPlan([
    { name: 'Chicken breast', quantity: '2', aisle: 'Meat & Seafood' },
    { name: 'Red bell pepper', quantity: '1', aisle: 'Produce' },
    { name: 'Soy sauce', quantity: '2 tbsp', aisle: 'Pantry' },
    { name: 'Serrano chile', quantity: '1', aisle: 'Produce' },
  ].map(row => ({
    ...row,
    sourceRecipeId: recipes.stirFry,
    sourceRecipeTitle: 'Weeknight chicken stir-fry',
  })));
}

// ---------------------------------------------------------------------------
// The week's meals, and what they left in the fridge
// ---------------------------------------------------------------------------

/**
 * A fortnight of dinners either side of today, and four containers in the
 * fridge at four different points on the clock.
 *
 * `loadRange` first, and it matters: the meal plan store is range-scoped, so a
 * write outside the loaded window goes to SQLite and is deliberately *not*
 * patched into memory — which would leave setCooked/setRecipeScale/
 * setRecipeChoices below with nothing to find. The window also means Today's
 * planned-meals section is populated the moment demo mode starts, rather than
 * staying blank until the meal plan screen has been visited once.
 */
function seedMealPlanAndFridge(recipes: DemoRecipes, today: Date): void {
  const { loadRange, planMeal, setCooked, setRecipeScale, setRecipeChoices, stampAddedToList } =
    useMealPlanStore.getState();
  const { markCooked } = useRecipeStore.getState();
  const { logLeftover, finishLeftover } = useLeftoverStore.getState();
  const weekStartsOn = useSettingsStore.getState().weekStartsOn;

  loadRange(dayKeyOf(subDays(today, 14)), dayKeyOf(addDays(today, 14)));

  const plan = (
    dayOffset: number,
    slot: MealSlot,
    entry: { title: string; recipeId?: string; leftoverId?: string; cookTask?: boolean | null }
  ) =>
    planMeal({
      date: dayKeyOf(addDays(today, dayOffset)),
      slot,
      title: entry.title,
      recipeId: entry.recipeId ?? null,
      leftoverId: entry.leftoverId ?? null,
      cookTask: entry.cookTask ?? null,
    });

  // --- Nights already cooked ----------------------------------------------
  // cookedAt is the one thing an entry tracks about the past; the recipe's own
  // cookCount is bumped separately and never derived back from entries, which
  // is why both calls are here.
  //
  // These opt out of a cook task (#1402): a night eight days ago doesn't want
  // a task spawned and instantly completed, which would date a cooking to
  // right now and put five of them in today's Logbook and Stats.
  const cooked = (
    dayOffset: number,
    slot: MealSlot,
    entry: { title: string; recipeId?: string }
  ) => {
    const planned = plan(dayOffset, slot, { ...entry, cookTask: false });
    if (planned) setCooked(planned.id, true);
    if (entry.recipeId) markCooked(entry.recipeId);
    return planned;
  };

  cooked(-8, 'dinner', { title: 'Lemon garlic salmon', recipeId: recipes.salmon });
  cooked(-6, 'dinner', { title: 'Takeaway curry' });
  cooked(-5, 'lunch', { title: 'Turkey and avocado sandwich', recipeId: recipes.sandwich });
  const steakNight = cooked(-4, 'dinner', {
    title: 'Seared steak with potatoes',
    recipeId: recipes.steak,
  });
  if (steakNight) {
    // Cooked for eight — a fact about that Sunday, never written back onto the
    // recipe, so every other meal using it is untouched.
    setRecipeScale(steakNight.id, 2);
    // ...and that night it was the roast potatoes rather than the default mash.
    const roasted = componentIdFor(recipes.steak, recipes.roasties);
    if (roasted) setRecipeChoices(steakNight.id, [roasted]);
  }
  const stirFryNight = cooked(-1, 'dinner', {
    title: 'Weeknight chicken stir-fry',
    recipeId: recipes.stirFry,
  });

  // --- What those left behind ---------------------------------------------
  // One container at each point on the clock, so the freshness ladder, the
  // hub-pill badge and the "use it up" nudge all have something to show.
  const stirFryLeftover = logLeftover({
    title: 'Chicken stir-fry',
    recipeId: recipes.stirFry,
    sourceEntryId: stirFryNight?.id ?? null,
    storedAt: subDays(today, 1).toISOString(),
    keepDays: 3,
  });
  // A component's leftover points at the component's own recipe, not at the
  // dinner it was part of: this is a tub of mash, not a tub of steak.
  logLeftover({
    title: 'Mashed potatoes',
    recipeId: recipes.mash,
    sourceEntryId: steakNight?.id ?? null,
    storedAt: subDays(today, 4).toISOString(),
    keepDays: 5,
  });
  logLeftover({
    title: 'Carrot cake',
    recipeId: recipes.cake,
    storedAt: subDays(today, 3).toISOString(),
    keepDays: 3,
  });
  // Logged by hand with no recipe behind it — half a takeaway is a leftover.
  logLeftover({
    title: 'Takeaway curry',
    storedAt: subDays(today, 6).toISOString(),
    keepDays: 3,
  });

  // Closed out, so the fridge history has both endings in it. "We ate it" and
  // "it went off" are the two things the feature exists to tell apart.
  const eaten = logLeftover({
    title: 'Roast chicken',
    storedAt: subDays(today, 9).toISOString(),
    keepDays: 3,
  });
  if (eaten) finishLeftover(eaten.id, 'eaten');
  const tossed = logLeftover({
    title: 'Lentil soup',
    storedAt: subDays(today, 12).toISOString(),
    keepDays: 4,
  });
  if (tossed) finishLeftover(tossed.id, 'tossed');

  // --- The week ahead ------------------------------------------------------
  // Cook tasks (#1402) are shown as a mixture on purpose, because both halves
  // of the feature are invisible until something uses them. Today's oats and
  // dinner each put a "Cook …" task on the day — segmented to their slot, so
  // the dinner one stays hidden until evening — while the sandwich and the
  // snack plate opt out, which is what the entry sheet's per-meal toggle
  // writes. A day where every recipe became a chore is exactly the pile-up the
  // toggle exists for.
  plan(0, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });
  plan(0, 'lunch', { title: 'Turkey and avocado sandwich', recipeId: recipes.sandwich, cookTask: false });
  plan(0, 'dinner', { title: 'Weeknight chicken stir-fry', recipeId: recipes.stirFry });
  plan(0, 'snack', { title: 'Hummus snack plate', recipeId: recipes.snacks, cookTask: false });

  plan(1, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });
  plan(1, 'dinner', { title: 'Lemon garlic salmon', recipeId: recipes.salmon });

  // Freeform — planning doesn't require a recipe, and a night that just says
  // "eating out" holds its place and counts like any other.
  plan(2, 'dinner', { title: 'Eating out' });

  // Eating the chilli that's in the fridge. Planning against a leftover
  // deliberately doesn't close it out — a pot feeds two dinners.
  if (stirFryLeftover) {
    plan(3, 'dinner', {
      title: 'Leftover chicken stir-fry',
      leftoverId: stirFryLeftover.id,
    });
  }

  // Two things on one dinner — real, and the reason there's no UNIQUE(date, slot).
  plan(4, 'dinner', { title: 'Lemon garlic salmon', recipeId: recipes.salmon });
  plan(4, 'dinner', { title: 'Simple green salad', recipeId: recipes.salad });

  const sundayRoast = plan(5, 'dinner', {
    title: 'Seared steak with potatoes',
    recipeId: recipes.steak,
  });
  // Roast potatoes again this week, decided in advance.
  if (sundayRoast) {
    const roasted = componentIdFor(recipes.steak, recipes.roasties);
    if (roasted) setRecipeChoices(sundayRoast.id, [roasted]);
  }
  plan(5, 'snack', { title: 'Carrot cake with cream cheese frosting', recipeId: recipes.cake });

  plan(6, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });
  plan(6, 'dinner', { title: "Dinner at Sam's" });

  // This week's ingredients have been through "Add week to list" already —
  // a stamp on the week header, never a lock on adding again.
  stampAddedToList(dayKeyOf(buildWeekDays(today, weekStartsOn)[0]));
}
