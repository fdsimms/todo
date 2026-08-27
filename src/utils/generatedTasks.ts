import type { GeneratedKind, Task } from '../types';

export type { GeneratedKind };

/**
 * The one mechanism behind every task this app writes without being asked.
 *
 * Eleven features generate tasks unattended — each meal of the day becomes a
 * task, a perishable grocery becomes "Use up X", a leftover about to go bad
 * becomes "Use up X", an opt-in weekly trigger becomes "Plan meals for…", a
 * project that has gone quiet becomes "Review X", a pantry guess that has run
 * out becomes "Check if you still have X", a task's supply running low
 * becomes "Order more X", (once a day, when tomorrow has anything on it) the
 * calendar becomes "Review tomorrow's calendar", somebody's birthday becomes a
 * task a few days out (optionally with a second, earlier one to get them a
 * gift), and a planned meal the kitchen can't make becomes "Shop for Tue
 * ragu". The first four were each
 * built by copying the last, which is fine twice and had reached four: four
 * nullable back-pointer columns on `Task`, four hand-written "don't pile up"
 * rules, and three near-identical copies of the same three-input opt-out, two
 * of which said so in their own headers (#1524).
 *
 * The fifth is what that refactor was for. `projectReview` needed no
 * column and no reconcile of its own: a registry entry, a rules module
 * (`projectReviewTasks.ts`) and a firing beside the meal-plan nudge's, which is
 * the shape the note below promised. `pantryCheck` is the sixth and cost the
 * same: `pantryCheckTasks.ts`, an entry here, and a firing beside
 * `projectReview`'s — the one column it *did* add is on its source row
 * (`GroceryItem.pantryCheckDeclinedAt`), which is where the opt-out belongs and
 * not part of the mechanism at all. `supplyReorder` is the seventh, sourced
 * from a task rather than a row in another store (see `src/utils/supply.ts`).
 * `birthday` is the ninth. `mealShortfall` is the tenth, and is the first whose
 * source row is one the user edits freely and often, which is why its whole
 * staleness rule is the creation predicate re-run (see
 * `src/utils/mealShortfallTasks.ts`). `birthdayGift` is the eleventh, and costs
 * no new rules module at all — it lives beside `birthday` in
 * `src/utils/birthdayTasks.ts` and reuses everything but the lead setting and
 * the title (see that file's own header).
 * `calendarReview` is the eighth, and it costs the same shape again:
 * `calendarReviewTasks.ts`, an entry here, and a firing beside the other
 * time-based passes. It adds no column at all — its source is tomorrow's day
 * key rather than a row, the position `mealPlanNudge` is already in, so its
 * "don't hand it back" is a settings-level mark (`calendarReviewLastDayKey`)
 * rather than a stamp on anything.
 *
 * What's shared is the *plumbing*, and only the plumbing:
 *
 * - **`Task.generatedKind` + `Task.generatedSourceId`** in place of
 *   `mealEntryId` / `groceryItemId` / `leftoverId`. Two columns instead of one
 *   per generator, and the fifth generator needs neither.
 * - **`wantsGeneratedTask`** — the tri-state opt-out precedence, written once.
 * - **`liveGeneratedTask` / `hasAnyGeneratedTask`** — "is there already a task
 *   for this source", the question all four had their own answer to.
 *
 * What is deliberately **not** shared is every rule that makes a generator the
 * generator it is: which sources qualify, what the task is called, which fields
 * the source owns, and when a reconcile runs. Those live in `mealTasks.ts`,
 * `groceryExpiry.ts`, `leftoverTasks.ts` and `mealPlanNudge.ts` exactly as
 * before, and each still has its own tests. A registry that tried to hold them
 * too would be the settings-as-config mistake `settingsIndex.ts` warns about,
 * one layer down: an abstraction able to express a time-of-day segment, a lead
 * time in days, a relative deadline and a week-range title is harder to read
 * than the four modules it replaced.
 *
 * **The per-source opt-out stays on the source row** (`MealPlanEntry.cookTask`,
 * `GroceryItem.useUpTask`, `Leftover.useUpTask`), and that's the one thing here
 * that looks poolable and isn't. Hoisting it into a generic suppression record
 * keyed by `(kind, sourceId)` makes a settings row that grows without bound —
 * the same disease `remindersImportHandled` has, which it survives only by
 * pruning to what the Reminders list still holds on every drain. A generic
 * record has no equivalent pruning pass unless each generator supplies one, at
 * which point it isn't generic. On the source row it's bounded for free: the
 * row carrying the "no" is deleted by whatever deletes the source.
 */

/**
 * The generators a *listing* enumerates — Settings' section, and anything else
 * asking "what writes tasks into my list".
 *
 * **`mealCook` is deliberately absent**, and is the first kind to leave this
 * list without leaving `GeneratedKind`. It folded into `mealSlot`, which asks
 * the same question of a wider set of days (see `mealSlotTasks.ts`): a slot
 * with a recipe in it produces the cook step a cook task used to be, and a slot
 * with nothing in it produces the choosing this app had no row for at all. One
 * settings row covers both because to the person reading Today they are one
 * feature, and two rows would offer a way to turn on the half that can't
 * happen.
 *
 * Rows already written as `mealCook` keep working exactly as they did — the
 * kind is still in the union, `liveGeneratedTask` still matches it, and
 * `writeGeneratedOptOut` still has its case, so a legacy cook task swiped away
 * still tells its meal not to ask again. They just aren't created any more, and
 * they drain within a day or two of ordinary use.
 */
export const GENERATED_KINDS: readonly GeneratedKind[] = [
  'mealSlot',
  'groceryUseUp',
  // Beside the other generator that reads the grocery catalog, rather than
  // appended after the project one — the two are a pair from the list's side
  // (they file under one category for the same reason), and slotting it here
  // leaves every existing row's order relative to the others untouched, which
  // appending after `projectReview` would not: it would leave the four kitchen
  // generators split around a project one.
  'pantryCheck',
  // Directly after the drip it supersedes, for the reason pantryCheck itself
  // sits beside groceryUseUp: the two are one subject from the list's side.
  // They ask the same question at two different sizes, they file under one
  // category by default, and reading them apart would leave a person turning
  // one on without ever meeting the other.
  'pantryReview',
  'leftoverUseUp',
  'mealPlanNudge',
  // Beside the nudge rather than appended at the end, for the reason
  // pantryCheck sits beside groceryUseUp: the two are a pair from the list's
  // side. One asks you to plan the week and the other tells you the plan can't
  // be cooked, they file under one category, and reading them together is how a
  // person meets the meal plan in Settings.
  'mealShortfall',
  'projectReview',
  'supplyReorder',
  'calendarReview',
  'birthday',
  // Beside its pair, the same way pantryCheck sits beside groceryUseUp: to the
  // person reading Settings, marking a birthday and shopping for it are one
  // subject, not two unrelated rows to read past each other.
  'birthdayGift',
  'reachOut',
  // The fourteenth, appended rather than paired: nothing else here reads the
  // weather, so there's no existing generator it belongs beside.
  'weather',
];

/**
 * What a generator is called where the user is asked about it, and what its
 * on/off answer is called in Settings.
 *
 * This is the registry the issue asked for, and it holds the two things a
 * *listing* needs — a name and a settings key — rather than trying to describe
 * the generator itself. Settings renders one row per entry from it, so a fifth
 * generator appears in the list by being added here instead of by someone
 * remembering to hand-write a fourth near-identical section.
 *
 * `sourced: false` marks the one generator with nothing to point back at: the
 * meal-plan nudge is projected from the calendar, not from a row. It's the
 * reason the source id is nullable, and the reason `hasAnyGeneratedTask` takes
 * an optional one.
 *
 * Its tasks do now carry a `generatedSourceId` — the **day key** each one is
 * asking about (`2026-08-17`), since the nudge lays down a task per day of the
 * week rather than one for the week. That doesn't make it sourced: a day key
 * names a square on the calendar, not a row anything could be written back to,
 * which is exactly why `writeGeneratedOptOut` still has nothing to write for
 * this kind and why its "don't hand it back" is `mealPlanNudgeLastFiredWeekKey`
 * rather than a flag on a source. Read it with `generatedSourceOf`, like every
 * other kind's.
 */
/**
 * The settings keys holding the generators' on/off answers.
 *
 * Each generator kept its own key rather than being migrated to a generic pair
 * when the registry arrived, because renaming them would be a migration over
 * preferences people have already set, for no gain a person can see. What was
 * missing was a way to *read* one without knowing which — which is what
 * `GeneratedKindSpec.enabledKey` is for.
 */
export type GeneratedEnabledKey =
  | 'mealCookTasks'
  | 'groceryUseUpTasks'
  | 'pantryCheckTasks'
  | 'leftoverUseUpTasks'
  | 'mealPlanNudgeEnabled'
  | 'mealShortfallTasks'
  | 'projectReviewTasks'
  | 'supplyReorderTasks'
  | 'calendarReviewTasks'
  | 'birthdayTasks'
  | 'birthdayGiftTasks'
  | 'reachOutTasks'
  | 'pantryReviewTasks'
  | 'weatherTasks';

export interface GeneratedKindSpec {
  kind: GeneratedKind;
  /** The Settings row's label — plain, literal, matching the rows around it. */
  label: string;
  /** One line saying what turns on, in the present tense. */
  onHint: string;
  /** The same line for the off state, so the row reads as an answer either way. */
  offHint: string;
  /** Ionicons glyph for the Settings row. */
  icon: string;
  /**
   * The settings key holding this generator's on/off answer.
   *
   * `mealSlot` and `mealCook` deliberately share one: the second folded into
   * the first and kept its key rather than migrating a preference people had
   * already set (see `GENERATED_KINDS`).
   */
  enabledKey: GeneratedEnabledKey;
  /** Whether tasks of this kind point back at a source row. */
  sourced: boolean;
  /**
   * Whether this generator belongs to the groceries/recipes/meal-plan area, and
   * so goes away with it when `kitchenEnabled` is off.
   *
   * Required rather than optional, for the reason `enabledOf` is a switch with
   * no default arm: a generator added to the registry has to answer this, and
   * a wrong answer in either direction is a bug that has already shipped twice.
   * `false` here means the generator keeps running with the area hidden — so
   * its Settings row has to keep rendering, or it writes tasks nobody can turn
   * off (that was `birthday`, `reachOut`, `supplyReorder`, `projectReview` and
   * `calendarReview`, all five stranded behind Settings' own kitchen gate).
   * `true` means the pass itself must refuse to run without the area, or it is
   * the mirror failure: a hidden feature still writing rows onto Today, which
   * `checkMealSlotTasks` did with three meal tasks a day.
   *
   * Settings reads this flag directly (both the group gate and the row filter),
   * and `settingsIndex.test.ts` checks the search index against it — so the
   * registry is the single answer rather than a third copy of it.
   */
  kitchen: boolean;
  /**
   * Whether the user can choose a category to file this kind under.
   *
   * `false` for two kinds. `calendarReview` reuses `calendarEventCategory`,
   * the setting calendar-event context rows already file under, rather than
   * owning a second "File them under" pair — the task this generator writes
   * and the events it's asking about are the same category by construction,
   * and a picker offering to disagree with that would be a setting with no
   * honest answer. `supplyReorder` has no category setting for a different
   * reason: its task always inherits the category of the task the supply
   * belongs to (see `checkSupplyReorderTasks`), so there is no single global
   * answer a picker could offer — a filter tracked on a bathroom task and one
   * tracked on a car task each want their own reorder task filed where the
   * task itself is, not both funnelled into one "Supplies" category.
   */
  categorized: boolean;
  /**
   * The category this kind files under until the user says otherwise, created
   * on the generator's first switch-on (see ensureGeneratedTaskCategory).
   *
   * Unused when `categorized` is false — there's no category of its own to
   * default. For `supplyReorder` that's because each task's category comes
   * from its own source task rather than from one setting shared by every
   * reorder task.
   *
   * Not a cosmetic default. These settings shipped defaulting to *no* category,
   * and an uncategorized task renders in the header-less loose block at the
   * very top of Today, above every section — so a generator left at its default
   * put its output exactly where the calendar and meal strips used to sit, and
   * exactly where this whole change is trying not to put things. Naming a
   * category is what a person does once they've seen that; shipping the answer
   * saves them the trip.
   *
   * Two pairs share a category on purpose. "Meal Plan": the weekly nudge to
   * plan the week and the cook tasks that come out of having planned it are the
   * same job to the person reading the list, and two sections for it would be a
   * distinction only the code makes. "Groceries": using up a bag of spinach and
   * checking whether there's still flour are both questions about the kitchen,
   * and filing them apart would split one trip to the cupboard across two
   * sections of Today.
   */
  defaultCategory: string;
}

export const GENERATED_KIND_SPECS: Record<GeneratedKind, GeneratedKindSpec> = {
  // The only generator whose trigger is known years ahead rather than derived
  // from something that just changed, which is why it is the one that can fire
  // a task *before* the thing it is about — see src/utils/birthdayTasks.ts.
  // Silent on everybody until a person is explicitly opted in, which is the
  // real gate — the setting below only decides whether the pass runs at all.
  reachOut: {
    kind: 'reachOut',
    enabledKey: 'reachOutTasks',
    label: 'Reminders to keep in touch',
    onHint: 'A person you asked to be reminded about gets a task when it has been a while',
    offHint: 'People add no catch-up tasks',
    icon: 'people-outline',
    sourced: true,
    kitchen: false,
    categorized: true,
    defaultCategory: 'People',
  },
  birthday: {
    kind: 'birthday',
    enabledKey: 'birthdayTasks',
    label: 'Birthday reminders',
    onHint: 'A person with a birthday on file gets a task a few days before it',
    offHint: 'Birthdays add no tasks',
    icon: 'gift-outline',
    sourced: true,
    kitchen: false,
    categorized: true,
    defaultCategory: 'People',
  },
  // Ships off, unlike birthday just above it. Birthday's gate is a fact
  // entered before this feature existed — the birthday itself — and every
  // install with a birthday on file would get a second task the moment this
  // shipped, for a want nobody had actually stated. Turning it on is one
  // settings tap once somebody wants it, the same "ask first" call pantryCheck
  // and mealShortfall make for the identical reason: no recorded intent of its
  // own to point to.
  birthdayGift: {
    kind: 'birthdayGift',
    enabledKey: 'birthdayGiftTasks',
    label: 'Birthday gift reminders',
    onHint: 'A person with a birthday on file gets a task to get them a gift',
    offHint: 'Birthdays add no task to get a gift',
    icon: 'gift-outline',
    sourced: true,
    kitchen: false,
    categorized: true,
    defaultCategory: 'People',
  },
  mealSlot: {
    kind: 'mealSlot',
    enabledKey: 'mealCookTasks',
    label: 'Meal tasks',
    onHint: 'Each meal you eat gets a task: what to make, or what to decide',
    offHint: 'Meals add no tasks',
    icon: 'restaurant-outline',
    // Its source id is a day and a slot, which names a square on the calendar
    // rather than a row anything could be written back to — the same position
    // mealPlanNudge is in, and the reason writeGeneratedOptOut has nothing to
    // write for either. What stops a swiped-away meal task coming straight back
    // is mealSlotTasksWrittenThroughDayKey, a high-water mark the pass only
    // ever writes past — so a day it has covered is never revisited.
    sourced: false,
    kitchen: true,
    categorized: true,
    defaultCategory: 'Meal Plan',
  },
  // Retired — see GENERATED_KINDS above. Kept in the specs because the record
  // is keyed by GeneratedKind and legacy rows still carry the kind; nothing
  // lists it, since GENERATED_KIND_LIST is built from GENERATED_KINDS.
  mealCook: {
    kind: 'mealCook',
    enabledKey: 'mealCookTasks',
    label: 'Cook tasks',
    onHint: 'Planning a recipe adds a task to cook it',
    offHint: 'Planning a recipe adds no task',
    icon: 'restaurant-outline',
    sourced: true,
    kitchen: true,
    categorized: true,
    defaultCategory: 'Meal Plan',
  },
  groceryUseUp: {
    kind: 'groceryUseUp',
    enabledKey: 'groceryUseUpTasks',
    label: 'Use-up tasks for groceries',
    onHint: 'Buying something with a use-by date adds a task to use it up',
    offHint: 'Buying something with a use-by date adds no task',
    icon: 'alarm-outline',
    sourced: true,
    kitchen: true,
    categorized: true,
    defaultCategory: 'Groceries',
  },
  pantryCheck: {
    kind: 'pantryCheck',
    enabledKey: 'pantryCheckTasks',
    label: 'Pantry checks',
    onHint: 'Adds a task to check whether you still have something once its usual shelf life has passed',
    offHint: 'No task to check whether you still have something',
    icon: 'help-circle-outline',
    sourced: true,
    kitchen: true,
    categorized: true,
    defaultCategory: 'Groceries',
  },
  // Ships off, like pantryCheck above it and for the same reason: it adds a
  // surface rather than replacing one that was already on screen. Its own gate
  // is larger than the drip's, too — MIN_PANTRY_REVIEW_CARDS means a cupboard
  // the app is mostly sure about never raises it at all.
  pantryReview: {
    kind: 'pantryReview',
    enabledKey: 'pantryReviewTasks',
    label: 'Pantry reviews',
    onHint: 'Adds a task to go through the pantry when several things are in doubt at once',
    offHint: 'No task to go through the pantry',
    icon: 'albums-outline',
    // Its source id is the day key the offer was raised on, which names a
    // square on the calendar rather than a row anything could be written back
    // to — the position calendarReview and mealPlanNudge are already in, and
    // the reason writeGeneratedOptOut has nothing to write for this kind. What
    // stops a swiped-away row coming straight back is pantryReviewLastDayKey.
    sourced: false,
    // The deck reads the grocery catalog and checkPantryReviewTasks refuses to
    // run with the area off, so the row has to go with it — the `true` half of
    // this flag's contract.
    kitchen: true,
    // A category of its own, unlike calendarReview, even though it defaults to
    // the same place pantryCheck files under. calendarReview shares a key
    // because the events it describes are already filed by that setting, so a
    // second one could only agree or contradict; here there is no such prior
    // owner, and sharing pantryCheck's key would mean turning this generator on
    // while the drip is off leaves it with nowhere to file — an uncategorized
    // task renders loose at the very top of Today, which is exactly where these
    // must not go.
    categorized: true,
    defaultCategory: 'Groceries',
  },
  leftoverUseUp: {
    kind: 'leftoverUseUp',
    enabledKey: 'leftoverUseUpTasks',
    label: 'Use-up tasks for leftovers',
    onHint: 'A leftover about to go bad adds a task to use it up',
    offHint: 'A leftover about to go bad adds no task',
    icon: 'file-tray-outline',
    sourced: true,
    kitchen: true,
    categorized: true,
    defaultCategory: 'Leftovers',
  },
  projectReview: {
    kind: 'projectReview',
    enabledKey: 'projectReviewTasks',
    label: 'Review tasks for quiet projects',
    onHint: 'A project with nothing scheduled adds a task to pick its next one',
    offHint: 'A project with nothing scheduled adds no task',
    icon: 'folder-outline',
    sourced: true,
    kitchen: false,
    categorized: true,
    defaultCategory: 'Projects',
  },
  supplyReorder: {
    kind: 'supplyReorder',
    enabledKey: 'supplyReorderTasks',
    label: 'Reorder tasks for supplies',
    onHint: 'A task running low on supplies adds a task to order more',
    offHint: 'A task running low on supplies adds no task',
    icon: 'cube-outline',
    // The first generator whose source is a *task*. Nothing about the
    // mechanism minds — generatedSourceId is a string and never asked what
    // kind of row it names — but it is the reason writeGeneratedOptOut's case
    // here writes to useTaskStore rather than to one of the other stores.
    sourced: true,
    kitchen: false,
    // No "File them under" of its own — see GeneratedKindSpec.categorized.
    // Each reorder task takes the category of the task its supply is on.
    categorized: false,
    defaultCategory: '',
  },
  mealShortfall: {
    kind: 'mealShortfall',
    enabledKey: 'mealShortfallTasks',
    label: 'Shopping tasks for planned meals',
    onHint: 'A meal coming up that you lack ingredients for adds a task to shop',
    offHint: 'A meal coming up that you lack ingredients for adds no task',
    icon: 'cart-outline',
    // Its source is a MealPlanEntry, and the opt-out it writes there
    // (MealPlanEntry.shopTask) is what stops a swiped-away row coming straight
    // back — this is the one generator whose source the user re-plans freely,
    // so the tombstone does more work here than anywhere else.
    sourced: true,
    kitchen: true,
    categorized: true,
    // With the nudge and the meal tasks, for the reason those two share one:
    // planning the week, cooking what you planned and shopping for it are one
    // job to the person reading Today, and a third section would be a
    // distinction only the code makes.
    defaultCategory: 'Meal Plan',
  },
  mealPlanNudge: {
    kind: 'mealPlanNudge',
    enabledKey: 'mealPlanNudgeEnabled',
    label: 'Plan meals for the week',
    onHint: 'Adds a task once a week to plan that week\'s meals',
    offHint: 'No weekly task to plan the week\'s meals',
    icon: 'calendar-outline',
    sourced: false,
    kitchen: true,
    // Categorized like the other three now: it was the one generator with
    // nowhere to file its task, so the weekly nudge landed loose at the top of
    // Today however the rest were set up.
    categorized: true,
    defaultCategory: 'Meal Plan',
  },
  calendarReview: {
    kind: 'calendarReview',
    enabledKey: 'calendarReviewTasks',
    label: 'Review tomorrow\'s calendar',
    onHint: 'Adds a task each day to review tomorrow\'s events',
    offHint: 'No daily task to review tomorrow\'s events',
    icon: 'calendar-clear-outline',
    // Its source id is tomorrow's day key, the same "square on the calendar,
    // not a row" position mealPlanNudge is in — see the type's own note.
    sourced: false,
    kitchen: false,
    // Reuses calendarEventCategory rather than owning a category of its own —
    // see the field's doc comment above.
    categorized: false,
    defaultCategory: '',
  },
  // The fourteenth, and the first whose "source" is a rule the user wrote
  // rather than something else in the app — see src/utils/weatherTasks.ts.
  // Its source id is a day key and a rule id, the same "square on the
  // calendar, not a row" position calendarReview is in.
  weather: {
    kind: 'weather',
    enabledKey: 'weatherTasks',
    label: 'Weather-based tasks',
    onHint: "A rule that matches today's weather adds its task, like sunscreen on a sunny day",
    offHint: 'Weather adds no tasks',
    icon: 'partly-sunny-outline',
    sourced: false,
    kitchen: false,
    categorized: true,
    defaultCategory: 'Weather',
  },
};

/** The registry in the order Settings lists it. */
export const GENERATED_KIND_LIST: readonly GeneratedKindSpec[] =
  GENERATED_KINDS.map(k => GENERATED_KIND_SPECS[k]);

/**
 * The generators Settings would list right now — the whole registry, less the
 * kitchen's when the area is switched off.
 *
 * The one place that answer is written. Settings' section renders from it and
 * the index row's summary counts it, so the group's "4 of 12 on" can't disagree
 * with the rows behind it.
 */
export function listedGeneratedKinds(kitchenEnabled: boolean): readonly GeneratedKindSpec[] {
  return GENERATED_KIND_LIST.filter(spec => kitchenEnabled || !spec.kitchen);
}

/**
 * How many of the generators on offer are switched on, and how many there are.
 *
 * Takes the flags rather than reaching for the settings store, so this module
 * stays pure — it is imported by `settingsIndex.ts`, which Jest loads without
 * `expo-sqlite`.
 */
export function generatedTaskCounts(
  flags: Record<GeneratedEnabledKey, boolean>,
  kitchenEnabled: boolean,
): { on: number; total: number } {
  const listed = listedGeneratedKinds(kitchenEnabled);
  return {
    on: listed.filter(spec => flags[spec.enabledKey]).length,
    total: listed.length,
  };
}

/**
 * The three-input opt-out, written once instead of three times.
 *
 * Every sourced generator answers "should this source have a task" the same
 * way, and each used to say so in its own header:
 *
 * 1. **An explicit per-source answer always wins**, in both directions. `true`
 *    spawns a task with the setting off ("I do want reminding about this one"),
 *    `false` suppresses it with the setting on — and `false` is what *deleting
 *    the task* records, which is why an explicit no has to outrank the setting
 *    rather than be re-decided on the next reconcile. A staple bought every
 *    week can be told once and stays told.
 * 2. **Otherwise the global setting decides**, and
 * 3. **only for a source that qualifies** — recipe-backed, carrying a use-by
 *    date, close enough to going off. That predicate is the part that genuinely
 *    differs per generator, so it arrives as a boolean the caller computed.
 *
 * `explicit` is a tri-state and `undefined` counts as `null`: rows that predate
 * a generator's column read back as undefined rather than null, and "the
 * setting decides" is the right answer for both.
 */
export function wantsGeneratedTask(
  explicit: boolean | null | undefined,
  enabled: boolean,
  qualifies: boolean
): boolean {
  if (explicit !== null && explicit !== undefined) return explicit;
  return enabled && qualifies;
}

/** A task generated by `kind` from `sourceId`, live or not. */
function isFrom(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>, kind: GeneratedKind, sourceId: string | null): boolean {
  return task.generatedKind === kind && task.generatedSourceId === sourceId;
}

/**
 * This source's live generated task, if it has one — the lookup all four
 * generators had their own copy of.
 *
 * "Live" is incomplete and unarchived, and both exclusions matter: a completed
 * task records something that was done, and turning a generator off is not a
 * claim it wasn't; archiving is this app's other explicit "I've dealt with
 * this" (see `archiveTask`). So a reconcile that no longer wants a task deletes
 * only what's still sitting there.
 */
export function liveGeneratedTask<T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>>(
  tasks: readonly T[],
  kind: GeneratedKind,
  sourceId: string | null = null
): T | undefined {
  return tasks.find(t => isFrom(t, kind, sourceId) && !t.completed && !t.archived);
}

/**
 * Every live task of a kind, whatever source each came from.
 *
 * The peer of `liveGeneratedTask` for a generator that writes a *set* at once
 * rather than one task per source decided one at a time. The meal-plan nudge
 * is the only one: it lays down a task per day of the week it's asking about,
 * so "is last week's nudge still sitting there" can't be asked about any one
 * source id, and asking `liveGeneratedTask` would quietly match on
 * `sourceId === null` — true of no nudge task since the day keys arrived, and
 * so an answer of "no" every single week.
 *
 * Order follows `tasks`, which is the store's own order, so a caller that
 * renders or reconciles the set gets it the way the list already reads.
 */
export function liveGeneratedTasksOfKind<T extends Pick<Task, 'generatedKind' | 'completed' | 'archived'>>(
  tasks: readonly T[],
  kind: GeneratedKind
): T[] {
  return tasks.filter(t => t.generatedKind === kind && !t.completed && !t.archived);
}

/**
 * Whether this source has *any* task on record, live or finished.
 *
 * The wider question, and only cook tasks ask it — deliberately. A meal is one
 * event, so a completed "Cook Tuesday's chilli" means the thing happened and a
 * second task for the same entry would be an invention. A grocery item and a
 * leftover are the opposite: a catalog row is bought again and again, and last
 * month's ticked-off "Use up spinach" says nothing about the bag bought this
 * afternoon. Reading the wide set there would mean a staple got exactly one
 * use-up task, ever.
 *
 * Which question a generator asks is therefore part of what the generator
 * *means*, not a detail to unify — see `blocksOnFinished` in
 * `reconcileGeneratedTask`.
 */
export function hasAnyGeneratedTask(
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId'>[],
  kind: GeneratedKind,
  sourceId: string | null = null
): boolean {
  return tasks.some(t => isFrom(t, kind, sourceId));
}

/**
 * How many tasks — live or finished — this exact (kind, source) pair has
 * ever produced. The disambiguator `spawnSeed.generated` needs: two devices
 * independently creating "the same" generated task before they've synced
 * must compute the same id, but a source that's earned a task before and
 * earns another later (a staple bought again) must not collide with the
 * finished row already sitting in the Logbook. Counting what already exists
 * gives both devices the same next index without either having to have seen
 * the other's copy.
 */
export function generatedTaskCountOf(
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId'>[],
  kind: GeneratedKind,
  sourceId: string | null = null
): number {
  return tasks.filter(t => isFrom(t, kind, sourceId)).length;
}

/**
 * The source row this task was generated from, but only if it came from the
 * generator asked about — null for every other task.
 *
 * The narrow read a caller wants when it's about to *act* on the source: the
 * cook-task/meal-plan loop reaches for the entry a completion should mark
 * cooked, and handing it a leftover's id because both live in the same column
 * now would be the failure the separate columns made impossible. Every read of
 * `generatedSourceId` that means one particular kind goes through this.
 */
export function generatedSourceOf(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  kind: GeneratedKind
): string | null {
  return task.generatedKind === kind ? task.generatedSourceId : null;
}

/**
 * The two fields that mark a task as generated, for a draft.
 *
 * Spread into a draft rather than set field by field so a generator can't
 * accidentally stamp a kind without a source, or the reverse.
 */
export function generatedBy(
  kind: GeneratedKind,
  sourceId: string | null = null
): { generatedKind: GeneratedKind; generatedSourceId: string | null } {
  return { generatedKind: kind, generatedSourceId: sourceId };
}

/**
 * Whether `kind` draws from the shared "use up" daily cap (#1675).
 *
 * Grocery and leftover use-up tasks are two independent producers of what a
 * person reads as one kind of nag, so a cap on the pile has to count them
 * together — cook tasks and the meal-plan nudge are exempt: a cook task is
 * one per planned dinner, which the user already chose by planning the meal,
 * and the nudge is a single weekly stack. Neither floods the way two
 * unrelated expiry clocks can.
 */
export function isUseUpKind(kind: GeneratedKind): boolean {
  return kind === 'groceryUseUp' || kind === 'leftoverUseUp';
}

/**
 * How many "Use up X" tasks — grocery and leftover together — are already
 * live: not completed, not archived. The number `reconcileGeneratedTask`'s
 * `useUpCap` is spent against.
 *
 * Deliberately not scoped to tasks due today: a use-up task's due date can sit
 * days out (a grocery item's lead time), and one bypassing the cap now only
 * to land on Today unopposed later would defeat the point. Counting every
 * live one bounds the whole backlog, not just what's visible this instant.
 */
export function liveUseUpTaskCount(
  tasks: readonly Pick<Task, 'generatedKind' | 'completed' | 'archived'>[]
): number {
  return tasks.filter(
    t => t.generatedKind !== null && isUseUpKind(t.generatedKind) && !t.completed && !t.archived
  ).length;
}
