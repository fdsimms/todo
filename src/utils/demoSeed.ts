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
import { useSettingsStore, type WeekStart } from '../store/useSettingsStore';
import { useTemplateStore } from '../store/useTemplateStore';
import type { DeliverableKind, GroceryItem, MealSlot, Recipe, Shop, TemplateItem } from '../types';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { buildWeekDays } from './calendarGrid';
import { getCurrentDayStart, dayKeyOf, dayKeyToDate } from './dateUtils';
import { generatedBy } from './generatedTasks';
import { dueMealPlanNudge, mealPlanNudgeLinkUrl } from './mealPlanNudge';
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
    pinGroup,
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
    notes: 'Draft is in the shared folder, just needs the headcount slide.',
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
    notes: 'Streaks survive a vacation. This one is paused while Vacation mode is on.',
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
  // driftingSince is stamped alongside for the same reason the count is: a
  // demo database has no history for the real rule to have derived one from.
  // Six weeks back, so the Drift screen's "first put off" line has something to
  // say rather than falling back to the bare count.
  updateTask(dentist.id, {
    postponeCount: 5,
    driftingSince: subDays(today, 42).toISOString(),
  });

  // A second drifter, so Drift reads as the list it is rather than a single
  // row — and so the ranking is visible: fewer moves, and a more recent start.
  const gutters = addTask({
    title: 'Clear the gutters',
    notes: 'Before the fall rain, ideally.',
    category: 'Home',
    dueDate: today.toISOString(),
    priority: 1,
    effort: 3,
    tags: ['home'],
  });
  updateTask(gutters.id, {
    postponeCount: 3,
    driftingSince: subDays(today, 11).toISOString(),
  });

  addTask({
    title: 'Swing by the farmers market',
    notes: 'Only worth doing between 8 and 1, after that the good stalls are gone.',
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
  const piano = addTask({
    title: 'Practice the piano',
    notes: 'A timed task: the row counts down once you start it.',
    category: 'Health',
    dueDate: today.toISOString(),
    timedMinutes: 25,
    estimatedMinutes: 25,
    effort: 2,
  });
  // The countdown split across its subtasks — the 25 minutes above is the sum
  // of these, and the row names whichever stretch the clock is in. Without a
  // task carrying one, apportioning reads as a feature the app hasn't got.
  ([['Scales', 5], ['Pieces I know', 10], ['The new one', 10]] as const).forEach(([title, minutes]) => {
    const step = addSubtask(piano.id, title);
    updateTask(step.id, { timedMinutes: minutes });
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

  // An extra-task rule. Invisible until it fires, so the seed carries a tally
  // partway through the cycle: the editor's caption then reads as a rule in
  // progress rather than one nobody has started.
  const violin = addTask({
    title: 'Practice the violin',
    notes: 'Every fourth session adds a one-off task to rosin the bow.',
    category: 'Health',
    dueDate: today.toISOString(),
    recurrenceType: 'daily',
    recurrenceInterval: 1,
    extraTaskEveryN: 4,
    extraTaskTitle: 'Rosin the bow',
    effort: 2,
  });
  updateTask(violin.id, { extraTaskTally: 2 });

  // A decision task — one that completes by recording an answer rather than
  // just being ticked. Seeded live so its checkbox shows the "?" that says it
  // will ask; the answered half is in the history below, since an answer only
  // exists on a completed row.
  addTask({
    title: 'Pick a date for the trip',
    notes: 'Checking this off asks for the date and keeps it with the task.',
    category: 'Errands',
    dueDate: today.toISOString(),
    deliverableKind: 'date',
    effort: 1,
  });

  // --- A stack (three independently-scheduled tasks under one label) --------
  const supplements = createGroup('Supplements', 'Health');
  addNewGroupedTask(supplements.id, 'Vitamin D');
  addNewGroupedTask(supplements.id, 'Omega-3');
  const iron = addNewGroupedTask(supplements.id, 'Iron');
  updateTask(iron.id, { timeSegments: ['evening'] });
  // Pinned as a whole via the stack editor's pin button, so the Pinned Tasks
  // block shows a copy of all three alongside the lone pinned task above.
  pinGroup(supplements.id);

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
    title: 'Dentist at 2:40pm',
    category: 'Health',
    dueDate: addDays(today, 5).toISOString(),
    reminderTime: setHours(addDays(today, 5), 13).toISOString(),
    effort: 1,
  });

  // The reminder kind that keeps ringing until the task is ticked off. Seeded
  // because a reminder kind is invisible until something uses it — the editor
  // shows 'Until done' as one pill of three, and nothing else says the app can
  // do this. It rings as a real alarm only on iOS 26+; elsewhere the row still
  // reads correctly, it just falls back to one notification.
  addTask({
    title: 'Take antibiotics',
    notes: 'Set to keep ringing until it is checked off.',
    category: 'Health',
    dueDate: addDays(today, 1).toISOString(),
    reminderTime: setHours(addDays(today, 1), 8).toISOString(),
    reminderKind: 'persistent',
    effort: 1,
  });

  // --- Unscheduled (organized, but no date) --------------------------------
  addTask({
    title: 'Deep clean the garage',
    notes: 'Effort is a size, not a time estimate. This one is an XL.',
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
  // Two of these are decisions — they completed by recording an answer, and
  // the project's Decisions block reads those answers back above the tasks.
  // Without a project holding one, that block never appears in demo mode and
  // the feature reads as one the app doesn't have.
  const projectTasks: Array<{
    title: string;
    effort: 1 | 2 | 3;
    done: boolean;
    deliverableKind?: DeliverableKind;
    answer?: string;
  }> = [
    { title: 'Measure the counters', effort: 1, done: true },
    { title: 'Pick a tile', effort: 2, done: true, deliverableKind: 'text', answer: 'Matte white 4x12' },
    { title: 'Set the budget', effort: 1, done: true, deliverableKind: 'number', answer: '6500' },
    { title: 'Get three quotes', effort: 3, done: false },
    { title: 'Book the installer', effort: 2, done: false },
  ];
  projectTasks.forEach(({ title, effort, done, deliverableKind, answer }) => {
    const t = addTask({ title, category: 'Home', effort, deliverableKind: deliverableKind ?? null });
    addExistingToProject(t.id, kitchen.id);
    if (done) completeTask(t.id, answer !== undefined ? { deliverableValue: answer } : undefined);
  });

  // A reference list, not a to-do list: nothing here ever gets a date, and
  // nudgeOptIn defaults to false, so it never trips the gone-quiet nudge or
  // shows up in "Pull from projects" the way an ordinary undated project
  // would. See Project.nudgeOptIn.
  const giftIdeas = createProject('Gift ideas', null, null);
  ['Something for Mom\'s birthday', 'Housewarming idea for the Chens', 'Stocking stuffers'].forEach(title => {
    const t = addTask({ title });
    addExistingToProject(t.id, giftIdeas.id);
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
    ['Call Mom', 'Home', 2],
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

  // The other half of the decision task above: one already answered, so the
  // Logbook shows what an answer actually looks like on the row. Completed
  // through the real action with the value, exactly as the prompt does it.
  const budget = addTask({
    title: 'Decide on the trip budget',
    category: 'Errands',
    effort: 1,
    deliverableKind: 'number',
  });
  completeTask(budget.id, { deliverableValue: '2400' });
  updateTask(budget.id, { completedAt: setHours(subDays(today, 1), 9).toISOString() });

  // --- A template, and the blanks it fills in at apply time ----------------
  seedTemplates();

  // --- Groceries, recipes, the week's meals and the fridge -----------------
  // Ordered by what points at what: recipes first (grocery rows can be
  // attributed to the recipe that put them on the list), then the catalog,
  // then the plan that references both, then the leftovers a cooked meal left.
  //
  // Skipped wholesale when the area is off. Demo mode is what someone handed
  // the phone actually sees, and seeding a shop, a week of dinners and a
  // fridge that none of them can reach is worse than seeding nothing: the
  // hub isn't in the menu, so it would only surface as cook tasks on Today
  // for meals there's no way to open.
  if (useSettingsStore.getState().kitchenEnabled) {
    const recipes = seedRecipes();
    seedGroceries(recipes);
    seedMealPlanAndFridge(recipes, today);
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * One template, with two blanks in it.
 *
 * The blanks are the reason this exists: `{destination}` is asked for once in
 * the apply sheet and lands in three item titles, and `{run}` inlines the name
 * given to the run itself. Both are invisible until a template declares one,
 * so without a seeded example the demo says the app can't do it.
 */
function seedTemplates(): void {
  const { addTemplate, addItem } = useTemplateStore.getState();
  const template = addTemplate('Trip prep');
  const ITEMS: Partial<TemplateItem>[] = [
    // The decision item: applying the template produces a task that asks for
    // the dates when it's ticked, rather than one someone has to convert to a
    // decision by hand every trip.
    { title: 'Pick dates for {destination}', dueOffsetDays: -28, deliverableKind: 'date' },
    { title: 'Put in for PTO for {run}', category: 'Work', dueOffsetDays: -21, priority: 3 },
    { title: 'Book flights to {destination}', dueOffsetDays: -14, priority: 4, effort: 2 },
    { title: 'Somewhere to stay in {destination}', dueOffsetDays: -14, effort: 2 },
    {
      title: 'Pack for {destination}',
      dueOffsetDays: -1,
      category: 'Home',
      subtasks: [
        { id: generateId(), title: 'Passport' },
        { id: generateId(), title: 'Chargers' },
        { id: generateId(), title: 'Meds' },
      ],
    },
    // Anchored to the end date instead, and optional — the two item settings
    // that are otherwise only described in the editor's own hints.
    { title: 'Unpack and put a wash on', anchor: 'end', dueOffsetDays: 1, optional: true },
  ];
  ITEMS.forEach(item => addItem(template.id, item));
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
    addEmptySection,
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
    setLeftoverKeepDays,
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
  // Keeps longer than the standard three days, so the tub of mash in the fridge
  // below is on the window its own recipe asked for. The salmon takes the other
  // end of the dial — a dish can say either.
  setLeftoverKeepDays(mash.id, 5);

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
  // Nobody's decided on a garnish yet — a heading declared ahead of anything
  // filed under it (Recipe.emptySections), so it shows up on the recipe with
  // nothing under it until something is.
  addEmptySection(cake.id, 'For serving');
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
  // Fish, so the log sheet opens on one day rather than three.
  setLeftoverKeepDays(salmon.id, 1);
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
    setBrand,
    setVariant,
    setBrandStrict,
    setBrandUnavailable,
    setAisle,
    setAisleOrder,
    setOnHandUntil,
    addToPantry,
    setStaple,
    setExpiresAt,
    setUseUpTask,
    finishShopping,
    addAisle,
    deleteAisle,
    linkItemShop,
    linkItemShopMany,
    markItemsUnavailable,
    ensureCatalogItem,
    linkItemSub,
    setShopExcludedFromSuggestions,
    startTrip,
    itemById,
  } = useGroceryStore.getState();

  const CATALOG = [
    // Dairy & Eggs
    'Milk', 'Eggs', 'Greek yogurt', 'Butter', 'Cheddar', 'Cottage cheese',
    // Produce
    'Spinach', 'Bananas', 'Tomatoes', 'Onions', 'Garlic', 'Lemons',
    // Meat & Seafood
    'Chicken breast', 'Ground beef',
    // Pantry / Canned
    'Pasta', 'Rice', 'Olive oil', 'Peanut butter', 'Black beans', 'Salt', 'Black pepper',
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

  // Quantities and notes — free text. The only thing that reads a quantity as a
  // number is the per-unit price comparison, and only when every price in a set
  // names one it can measure: "a bunch" below is the demo's example of the
  // refusal, "5 lb" of Rice further down the example of the comparison.
  setQuantity(itemNamed('Milk').id, '2 gal');
  setQuantity(itemNamed('Ground beef').id, '2 lb');
  setQuantity(itemNamed('Bananas').id, 'a bunch');
  setQuantity(itemNamed('Rice').id, '5 lb');
  setNote(itemNamed('Black beans').id, 'The low-sodium ones');
  setNote(itemNamed('Bread').id, 'Seeded, from the back shelf');
  // The brand is a clause beside the name, so this row is still plain "cottage
  // cheese" to a recipe that calls for it and to its own purchase history —
  // the caption only says which one to pick up. Seeded on a row that also
  // carries no note, so the list shows the brand caption on its own rather
  // than stacked under one.
  setBrand(itemNamed('Cottage cheese').id, 'Good Culture');
  // The same row carries the variant, which is the pairing worth showing: a
  // brand alone doesn't finish the job, since one dairy makes several tubs.
  // Both clauses compose into the single caption "Good Culture low fat" —
  // seeded together so the demo shows the composition rather than a variant
  // sitting on its own, which is the rarer of the two states.
  setVariant(itemNamed('Cottage cheese').id, 'low fat');

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

  // Prices, in minor units, keyed by the name the seed already uses. Recorded
  // through a finished trip rather than written onto rows, like everything else
  // here — which is also the only way they *can* be recorded, since a price is
  // paired with the quantity the trip bought (see GroceryItem.lastPriceQuantity).
  const priced = (byName: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(byName).map(([name, minor]) => [itemNamed(name).id, minor]));

  setCheckedMany(idsNamed(WEEKLY_SHOP), true);
  finishShopping(traderJoes.id);

  addExistingMany(idsNamed(BULK_RUN));
  setCheckedMany(idsNamed(BULK_RUN), true);
  finishShopping(costco.id, priced({ 'Olive oil': 1299, 'Paper towels': 1849, Rice: 799 }));

  addExistingMany(idsNamed(WEEKLY_SHOP));
  setCheckedMany(idsNamed(WEEKLY_SHOP), true);
  finishShopping(
    traderJoes.id,
    priced({ Milk: 429, Eggs: 599, Spinach: 349, Bread: 449, Coffee: 1099 })
  );

  // The same item bought at a second store for more — the whole point of
  // keeping a price per (item, store), and the only shape "cheapest at Costco"
  // can be said about. One item rather than several: a comparison needs two
  // prices, not a priced catalog.
  addExistingMany(idsNamed(['Olive oil']));
  setCheckedMany(idsNamed(['Olive oil']), true);
  finishShopping(traderJoes.id, priced({ 'Olive oil': 1599 }));

  // …and the same again for an item bought in *different sizes*, which is the
  // only shape a per-unit comparison can be shown in: 5 lb of rice for $7.99 at
  // Costco against 1 lb for $2.49 here. The bigger number is the better deal,
  // which is exactly the reading the rate exists to correct. The quantity has
  // to be set before the trip that prices it, since a price is paired with what
  // the trip bought.
  setQuantity(itemNamed('Rice').id, '1 lb');
  addExistingMany(idsNamed(['Rice']));
  setCheckedMany(idsNamed(['Rice']), true);
  finishShopping(traderJoes.id, priced({ Rice: 249 }));

  // A trip with no store named — a first-class answer, and the reason an
  // item's own purchaseCount runs ahead of the sum of its per-store links. Its
  // prices land on the items and on no link at all, which is that same split
  // one field over.
  const CORNER_SHOP = ['Greek yogurt', 'Butter'];
  addExistingMany(idsNamed(CORNER_SHOP));
  setCheckedMany(idsNamed(CORNER_SHOP), true);
  finishShopping(null, priced({ 'Greek yogurt': 549, Butter: 479 }));

  // Salt and pepper need a trip too — like every catalog row here, isStaple
  // is a corrected-by-hand flag on an item, not something a provisional row
  // can carry, so they have to earn their catalog place the same way Greek
  // yogurt and Butter just did before setStaple below has anything to mark.
  const STAPLES = ['Salt', 'Black pepper'];
  addExistingMany(idsNamed(STAPLES));
  setCheckedMany(idsNamed(STAPLES), true);
  finishShopping(null);

  // "I can get this here" with no trip behind it — an assertion, not an
  // observation. Almonds are linked to Costco alone, so they read as available
  // at exactly one store. Linking (like finishing a trip) promotes a
  // provisional row into the catalog, so this runs before the clear below —
  // otherwise these names, never bought, would have nothing left to promote.
  linkItemShop(itemNamed('Almonds').id, costco.id);
  linkItemShopMany(idsNamed(['Peanut butter', 'Ground beef']), costco.id);
  linkItemShopMany(idsNamed(['Dish soap', 'Toilet paper']), amazon.id);

  // And the opposite claim, which is the only thing that can tell "never
  // bought here" from "they don't stock it". Tortillas are marked absent at
  // Trader Joe's — a store with plenty else on record, so the trip planner has
  // to route round one item rather than write the shop off — and Almonds at
  // Trader Joe's too, where Costco is the answer. Same promotion as above.
  markItemsUnavailable(idsNamed(['Tortillas', 'Almonds']), traderJoes.id);

  // ...and the store that closes that gap, which is what makes the trip card's
  // second line exist at all. With Peanut butter and Cottage cheese below,
  // Costco ends up carrying three things Trader Joe's can't — over
  // `extraStopThreshold` for a list this length, so the card offers it by name
  // rather than staying quiet. One link short of that and the demo only ever
  // shows the one-store case, which is the common one but reads as the app
  // having nothing to say about a second stop.
  linkItemShop(itemNamed('Tortillas').id, costco.id);

  // The third claim a store can carry: it stocks the thing, just not the one
  // you want. Cottage cheese already names a brand above; switching the rule on
  // is what makes that brand filter store coverage rather than merely caption
  // the row.
  //
  // Trader Joe's is the store the seeded trip below runs at, so this is also
  // the only way the shelf caption for it ("No Good Culture here") appears in
  // the demo at all — the same reason the trip is at Trader Joe's and the other
  // two stores supply the `only`/`usually` markers.
  //
  // Costco is deliberately left unmarked rather than confirmed: an unmarked
  // store counts, and the seed has to show that reading as "still counts" or
  // the rule looks like it needs a verdict on every shop before it works.
  setBrandStrict(itemNamed('Cottage cheese').id, true);
  setBrandUnavailable(itemNamed('Cottage cheese').id, traderJoes.id, true);
  // Costco is linked but deliberately *not* ruled out, which is the half that
  // shows the rule is narrow: only what you've marked drops out, so a store you
  // haven't checked still counts as somewhere you can get this.
  linkItemShop(itemNamed('Cottage cheese').id, costco.id);

  // Substitutes, both shapes. Nothing infers one of these, so a demo with none
  // reads as an app that hasn't got the feature — and they're invisible until
  // something is linked, since a substitute is never captioned speculatively.
  //
  // Butter → margarine is the asymmetric case *and* the reason the note field
  // exists: the swap is right in a pan and wrong in laminated pastry, and
  // that's a caveat rather than a per-recipe scope. Milk ↔ oat milk is the
  // symmetric one, which is two rows and not a flag.
  //
  // Both stand-ins are minted off-list rather than added to the CATALOG list
  // above: nothing is provisional about a name typed to record a standing
  // fact, and the clear below would drop a row that had never been bought.
  const margarine = ensureCatalogItem('Margarine');
  const oatMilk = ensureCatalogItem('Oat milk');
  if (margarine) {
    linkItemSub(itemNamed('Butter').id, margarine.id, {
      note: 'Fine for frying, not for baking',
    });
    // ...and the state that makes the link *say* something. The caption on an
    // add-to-list row needs both halves known — the original wanted, the
    // substitute on hand — and the seeded trips leave Butter bought, so
    // without these two lines four recipes call for butter and nothing ever
    // reads "you have margarine". Marked out of it rather than left to the
    // cadence guess, which needs a row older than its purchases and so can't
    // be seeded at all (same reason the pantry's own seed is all assertions).
    setOnHandUntil(itemNamed('Butter').id, OUT_OF_IT_UNTIL);
    setOnHandUntil(margarine.id, defaultOnHandUntil(margarine, new Date()));
  }
  if (oatMilk) {
    linkItemSub(itemNamed('Milk').id, oatMilk.id, { bothWays: true });
  }

  // A ratio (#1573) — the issue's own motivating example, and a natural fit:
  // several seeded recipes already call for garlic in cloves ("2 cloves
  // garlic"), so this is a link whose ratio a demo user can actually see work
  // by adding one of those recipes to the list.
  const garlicPowder = ensureCatalogItem('Garlic powder');
  if (garlicPowder) {
    linkItemSub(itemNamed('Garlic').id, garlicPowder.id, {
      ratioFrom: '1 clove',
      ratioTo: '1/4 tsp',
    });
  }

  // Everything else typed above is still sitting on the list, since only what
  // a trip actually bought — or a link/unavailable claim above — came off it
  // or promoted it. Clearing parks what's already catalog and drops the rest,
  // same as removing an untouched name from the list by hand, so what's on
  // the list below is the list someone chose rather than the leavings of the
  // seed order.
  clearList();

  // The pantry override, both directions. "Got it" parks an item as on hand
  // for a while; "Out of it" is the user overruling the purchase-history guess
  // with their own hands.
  const rice = itemById(itemNamed('Rice').id);
  if (rice) setOnHandUntil(rice.id, defaultOnHandUntil(rice, new Date()));
  setOnHandUntil(itemNamed('Olive oil').id, OUT_OF_IT_UNTIL);

  // And the pantry's own way in: a thing you have that the app has never seen
  // you buy. It's the one row shape nothing else here produces — off the list,
  // in the catalog, no purchases behind it — and it's the whole reason the
  // pantry has an add field, since an item with no row has no sheet to open.
  addToPantry('Baking soda');

  // The staples — always on hand, so they sort into their own group rather
  // than "Need to buy" when a recipe's ingredients get added to the list.
  setStaple(itemNamed('Salt').id, true);
  setStaple(itemNamed('Black pepper').id, true);

  // The use-by half. The three finished trips above already stamped a date on
  // everything the shelf-life lexicon recognises, so most of that is here for
  // free — this is the pair the seed has to say out loud: a date corrected by
  // hand (the bag was already a few days old), and the per-item opt-in that
  // turns one item's date into a real task with the setting still off. Without
  // it the demo has use-by dates nothing ever acts on, which reads as the
  // reminders not existing.
  setExpiresAt(itemNamed('Spinach').id, dayKeyOf(addDays(new Date(), 1)));
  setUseUpTask(itemNamed('Spinach').id, true);

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
  // state the finish-shopping sheet is for. Milk, Eggs, Bananas, Bread and
  // Tortillas are already catalog rows (bought or linked above) and go back
  // on the list as themselves; Cheddar, Sparkling water and Ice cream were
  // never bought or linked, so clearList dropped them — they're typed fresh,
  // same as a name nobody has shopped for yet.
  // Cottage cheese is here for the brand rule: it's on the list, Trader Joe's
  // is recorded with the wrong brand, and the trip below is at Trader Joe's —
  // which is what puts the wrong-brand caption on a row you can actually see.
  const ON_LIST_EXISTING = [
    'Milk', 'Eggs', 'Bananas', 'Bread', 'Tortillas', 'Peanut butter', 'Cottage cheese',
  ];
  addExistingMany(idsNamed(ON_LIST_EXISTING));
  ['Cheddar', 'Sparkling water', 'Ice cream'].forEach(name =>
    addByName(name, undefined, undefined, { registerUndo: false })
  );
  setCheckedMany(idsNamed(['Milk', 'Bananas']), true);

  // ...plus tonight's dinner, added off the recipe, so a few rows carry "from
  // Weeknight chicken stir-fry" rather than looking hand-typed.
  // The aisles come from the ingredient rows the sheet reviewed, not from the
  // lexicon — "red bell pepper" would otherwise land under Baking & Spices on
  // its last token, and "serrano chile" is a name the lexicon has never heard.
  // The chile is the recipe's either/or, and it's on the list as one: this is
  // the shop where "Decide at the shop" was picked instead of answering
  // serrano-or-jalapeño at the kitchen table, so both rows are here under one
  // choiceGroup and ticking either at the shelf takes the other off. It's the
  // only place the grocery half of either/or shows up in the demo (#1572), and
  // the reason it's seeded through addFromPlan rather than addByName is that
  // this is exactly the path a recipe takes to get there.
  addFromPlan([
    { name: 'Chicken breast', quantity: '2', aisle: 'Meat & Seafood', choiceGroup: null },
    { name: 'Red bell pepper', quantity: '1', aisle: 'Produce', choiceGroup: null },
    { name: 'Soy sauce', quantity: '2 tbsp', aisle: 'Pantry', choiceGroup: null },
    { name: 'Serrano chile', quantity: '1', aisle: 'Produce', choiceGroup: `${recipes.stirFry}:Chile` },
    { name: 'Jalapeno', quantity: '1', aisle: 'Produce', choiceGroup: `${recipes.stirFry}:Chile` },
  ].map(row => ({
    ...row,
    sourceRecipeId: recipes.stirFry,
    sourceRecipeTitle: 'Weeknight chicken stir-fry',
  })));

  // ...and you're at Trader Joe's right now, which is the only state in which
  // the list says anything about stores. Two of the three things a row can say
  // are on screen because of it: Tortillas are marked as not stocked here, and
  // Peanut butter is on record at Costco alone. The third ("Usually X") can't
  // be seeded honestly — it needs an item bought at two stores while you stand
  // in a third, and this demo has two stores anyone would shop at.
  startTrip(traderJoes.id);
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
/**
 * The weekly "plan next week" nudge, as the stack of seven it fires as (#1585).
 *
 * Seeded rather than left to `checkMealPlanNudge`, which is off by default and
 * fires once a week at a configured hour — a demo can't wait for Sunday. The
 * days and the titles come from `dueMealPlanNudge` itself rather than being
 * written out here, so the demo can't drift from what the generator actually
 * produces; only the trigger is faked, by asking it about today.
 *
 * Three of next week's days get meals so the row counters have something to
 * show, and one of them gets all three so the "ready to complete" state is on
 * screen: it's the half of the feature that never appears on a fresh install
 * until somebody has planned a full day, which is exactly the kind of thing
 * CLAUDE.md's seed rule exists for. The remaining four sit at 0/3, which is
 * what the nudge is for.
 */
function seedMealPlanNudgeStack(
  today: Date,
  weekStartsOn: WeekStart,
  plan: (dayOffset: number, slot: MealSlot, entry: { title: string; recipeId?: string; cookTask?: boolean | null }) => unknown
): void {
  const { addTask, updateTask } = useTaskStore.getState();
  const { createGroup, setGroupCollapsed } = useTaskGroupStore.getState();

  // Fire it as though the trigger were now — midnight today, on today's own
  // weekday, never fired before.
  const due = dueMealPlanNudge(today, weekStartsOn, today.getDay(), '00:00', null);
  if (!due) return;

  // Where next week's first day falls relative to today, so the meals below can
  // go through the same `plan` helper the rest of the week uses.
  const firstOffset = differenceInCalendarDays(dayKeyToDate(due.days[0].dayKey), today);
  // A day already planned end to end — the row that reads "3/3 planned" with a
  // green checkbox. Cook tasks off: seven days out, they'd crowd Today with
  // meals nobody is cooking yet.
  plan(firstOffset, 'breakfast', { title: 'Overnight oats', recipeId: undefined, cookTask: false });
  plan(firstOffset, 'lunch', { title: 'Leftover salmon salad', cookTask: false });
  plan(firstOffset, 'dinner', { title: 'Sheet-pan chicken', cookTask: false });
  // And two part-planned days, so the counter is visibly a range rather than a
  // pair of states.
  plan(firstOffset + 1, 'dinner', { title: 'Pasta night', cookTask: false });
  plan(firstOffset + 3, 'breakfast', { title: 'Overnight oats', cookTask: false });
  plan(firstOffset + 3, 'dinner', { title: 'Eating out', cookTask: false });

  const group = createGroup(due.title, 'Meal Plan');
  setGroupCollapsed(group.id, false);
  due.days.forEach((day, index) => {
    const task = addTask({
      title: day.title,
      dueDate: due.dueDate.toISOString(),
      linkUrl: mealPlanNudgeLinkUrl(day.dayKey),
      category: 'Meal Plan',
      groupId: group.id,
      ...generatedBy('mealPlanNudge', day.dayKey),
    });
    updateTask(task.id, { sortOrder: index + 1 }, { skipPostponeCount: true });
  });
}

function seedMealPlanAndFridge(recipes: DemoRecipes, today: Date): void {
  const { loadRange, planMeal, setCooked, setRecipeScale, setRecipeChoices, stampAddedToList } =
    useMealPlanStore.getState();
  const { markCooked } = useRecipeStore.getState();
  const { logLeftover, finishLeftover } = useLeftoverStore.getState();
  const weekStartsOn = useSettingsStore.getState().weekStartsOn;
  // The two categories the kitchen's generated tasks file under, named and
  // pointed at explicitly rather than left to ensureGeneratedTaskCategories:
  // that pass reads the *real* install's settings (demo mode swaps the
  // database, not the in-memory preferences), so a demo that relied on it
  // would look different depending on what the person's own settings happened
  // to say. These are the names a fresh install gets.
  const { addCategory, setCategoryEmoji } = useCategoryStore.getState();
  ([['Meal Plan', '🍽️'], ['Leftovers', '🥡']] as Array<[string, string]>).forEach(([name, emoji]) => {
    addCategory(name);
    setCategoryEmoji(name, emoji);
  });
  useSettingsStore.getState().setMealCookTaskCategory('Meal Plan');
  useSettingsStore.getState().setLeftoverUseUpTaskCategory('Leftovers');

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
  cooked(-6, 'dinner', { title: 'Takeout curry' });
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
  // dinner it was part of: this is a tub of mash, not a tub of steak. Five days
  // because that's what the mash recipe says its leftovers keep — the number the
  // log sheet would have opened on.
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
    title: 'Takeout curry',
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
  //
  // That mixture is now also what shows both halves of the *fold* (#1571): the
  // two with a cook task appear as ordinary task rows, and the two without
  // appear as context rows in the same section — which is the whole point of
  // meals going inline rather than into a strip of their own. The demo files
  // them under Meal Plan (see the categories seeded above) so they land in a
  // section rather than loose above every one.
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

  seedMealPlanNudgeStack(today, weekStartsOn, plan);

  plan(6, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });
  plan(6, 'dinner', { title: "Dinner at Sam's" });

  // This week's ingredients have been through "Add week to list" already —
  // a stamp on the week header, never a lock on adding again.
  stampAddedToList(dayKeyOf(buildWeekDays(today, weekStartsOn)[0]));

  // The nights above went through setCooked, which raises the "out of anything
  // after X?" offer — so the last of them would leave demo mode opening on a
  // banner about a dinner eight days ago.
  //
  // It's cleared rather than left standing, and this is the one capability
  // here that genuinely can't be seeded: the offer isn't a row, it's the app's
  // answer to a tap you just made. Seeding one would be asserting a tap that
  // never happened, and its only lasting output is an item marked out of —
  // which is a *negative*, so it shows up as nothing at all. The honest way to
  // see this feature is to mark a meal cooked, which the demo is fully set up
  // for: tonight's stir-fry and its ingredients are all here.
  useMealPlanStore.getState().clearCookedOffer();
}
