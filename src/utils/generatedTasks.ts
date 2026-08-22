import type { GeneratedKind, Task } from '../types';

export type { GeneratedKind };

/**
 * The one mechanism behind every task this app writes without being asked.
 *
 * Six features generate tasks unattended — a planned meal becomes "Cook X", a
 * perishable grocery becomes "Use up X", a leftover about to go bad becomes
 * "Use up X", an opt-in weekly trigger becomes "Plan meals for…", a project
 * that has gone quiet becomes "Review X", and a pantry guess that has run out
 * becomes "Check if you still have X". The first four were each built by
 * copying the last, which is fine twice and had reached four: four nullable
 * back-pointer columns on `Task`, four hand-written "don't pile up" rules, and
 * three near-identical copies of the same three-input opt-out, two of which
 * said so in their own headers (#1524).
 *
 * The fifth is what that refactor was for. `projectReview` needed no
 * column and no reconcile of its own: a registry entry, a rules module
 * (`projectReviewTasks.ts`) and a firing beside the meal-plan nudge's, which is
 * the shape the note below promised. `pantryCheck` is the sixth and cost the
 * same: `pantryCheckTasks.ts`, an entry here, and a firing beside
 * `projectReview`'s — the one column it *did* add is on its source row
 * (`GroceryItem.pantryCheckDeclinedAt`), which is where the opt-out belongs and
 * not part of the mechanism at all.
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
  'leftoverUseUp',
  'mealPlanNudge',
  'projectReview',
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
  /** Whether tasks of this kind point back at a source row. */
  sourced: boolean;
  /** Whether the user can choose a category to file this kind under. */
  categorized: boolean;
  /**
   * The category this kind files under until the user says otherwise, created
   * on the generator's first switch-on (see ensureGeneratedTaskCategory).
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
  mealSlot: {
    kind: 'mealSlot',
    label: 'Meal tasks',
    onHint: 'Each meal you eat gets a task: what to cook, or what to decide',
    offHint: 'Meals add no tasks',
    icon: 'restaurant-outline',
    // Its source id is a day and a slot, which names a square on the calendar
    // rather than a row anything could be written back to — the same position
    // mealPlanNudge is in, and the reason writeGeneratedOptOut has nothing to
    // write for either. What stops a swiped-away meal task coming straight back
    // is mealSlotTasksWrittenThroughDayKey, a high-water mark the pass only
    // ever writes past — so a day it has covered is never revisited.
    sourced: false,
    categorized: true,
    defaultCategory: 'Meal Plan',
  },
  // Retired — see GENERATED_KINDS above. Kept in the specs because the record
  // is keyed by GeneratedKind and legacy rows still carry the kind; nothing
  // lists it, since GENERATED_KIND_LIST is built from GENERATED_KINDS.
  mealCook: {
    kind: 'mealCook',
    label: 'Cook tasks',
    onHint: 'Planning a recipe adds a task to cook it',
    offHint: 'Planning a recipe adds no task',
    icon: 'restaurant-outline',
    sourced: true,
    categorized: true,
    defaultCategory: 'Meal Plan',
  },
  groceryUseUp: {
    kind: 'groceryUseUp',
    label: 'Use-up tasks for groceries',
    onHint: 'Buying something with a use-by date adds a task to use it up',
    offHint: 'Buying something with a use-by date adds no task',
    icon: 'alarm-outline',
    sourced: true,
    categorized: true,
    defaultCategory: 'Groceries',
  },
  pantryCheck: {
    kind: 'pantryCheck',
    label: 'Pantry checks',
    onHint: 'Adds a task when the app stops being sure you still have something',
    offHint: 'No task when the app stops being sure you still have something',
    icon: 'help-circle-outline',
    sourced: true,
    categorized: true,
    defaultCategory: 'Groceries',
  },
  leftoverUseUp: {
    kind: 'leftoverUseUp',
    label: 'Use-up tasks for leftovers',
    onHint: 'A leftover about to go bad adds a task to use it up',
    offHint: 'A leftover about to go bad adds no task',
    icon: 'file-tray-outline',
    sourced: true,
    categorized: true,
    defaultCategory: 'Leftovers',
  },
  projectReview: {
    kind: 'projectReview',
    label: 'Review tasks for quiet projects',
    onHint: 'A project with nothing scheduled adds a task to pick its next one',
    offHint: 'A project with nothing scheduled adds no task',
    icon: 'folder-outline',
    sourced: true,
    categorized: true,
    defaultCategory: 'Projects',
  },
  mealPlanNudge: {
    kind: 'mealPlanNudge',
    label: 'Plan meals for the week',
    onHint: 'Adds a task once a week to plan that week\'s meals',
    offHint: 'No weekly task to plan the week\'s meals',
    icon: 'calendar-outline',
    sourced: false,
    // Categorized like the other three now: it was the one generator with
    // nowhere to file its task, so the weekly nudge landed loose at the top of
    // Today however the rest were set up.
    categorized: true,
    defaultCategory: 'Meal Plan',
  },
};

/** The registry in the order Settings lists it. */
export const GENERATED_KIND_LIST: readonly GeneratedKindSpec[] =
  GENERATED_KINDS.map(k => GENERATED_KIND_SPECS[k]);

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
