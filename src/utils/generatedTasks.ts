import type { GeneratedKind, Task } from '../types';

export type { GeneratedKind };

/**
 * The one mechanism behind every task this app writes without being asked.
 *
 * Four features generate tasks unattended — a planned meal becomes "Cook X", a
 * perishable grocery becomes "Use up X", a leftover about to go bad becomes
 * "Use up X", and an opt-in weekly trigger becomes "Plan meals for…". Each was
 * built by copying the last, which is fine twice and had reached four: four
 * nullable back-pointer columns on `Task`, four hand-written "don't pile up"
 * rules, and three near-identical copies of the same three-input opt-out, two
 * of which said so in their own headers (#1524).
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

export const GENERATED_KINDS: readonly GeneratedKind[] = [
  'mealCook',
  'groceryUseUp',
  'leftoverUseUp',
  'mealPlanNudge',
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
 * meal-plan nudge is projected from the calendar, not from a row, so its tasks
 * carry a kind and a null `generatedSourceId`. It's the reason the source id is
 * nullable, and the reason `hasAnyGeneratedTask` takes an optional one.
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
}

export const GENERATED_KIND_SPECS: Record<GeneratedKind, GeneratedKindSpec> = {
  mealCook: {
    kind: 'mealCook',
    label: 'Cook tasks',
    onHint: 'Planning a recipe adds a task to cook it',
    offHint: 'Planning a recipe adds no task',
    icon: 'restaurant-outline',
    sourced: true,
    categorized: true,
  },
  groceryUseUp: {
    kind: 'groceryUseUp',
    label: 'Use-up tasks for groceries',
    onHint: 'Buying something with a use-by date adds a task to use it up',
    offHint: 'Buying something with a use-by date adds no task',
    icon: 'alarm-outline',
    sourced: true,
    categorized: true,
  },
  leftoverUseUp: {
    kind: 'leftoverUseUp',
    label: 'Use-up tasks for leftovers',
    onHint: 'A leftover about to go bad adds a task to use it up',
    offHint: 'A leftover about to go bad adds no task',
    icon: 'file-tray-outline',
    sourced: true,
    categorized: true,
  },
  mealPlanNudge: {
    kind: 'mealPlanNudge',
    label: 'Plan meals for the week',
    onHint: 'Adds a task once a week to plan the week ahead',
    offHint: 'No weekly task to plan the week ahead',
    icon: 'calendar-outline',
    sourced: false,
    categorized: false,
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
