import type { MealPlanEntry, MealSlot, Task, TaskDraft, TimeOfDay } from '../types';
import { MEAL_SLOT_LABELS } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedBy, generatedSourceOf } from './generatedTasks';
import { isChainFinish } from './chain';
import { mealPlanNudgeLinkUrl } from './mealPlanNudge';
import { resolveOffsetDate } from './templateUtils';
import type { ChainItem } from '../types';

/**
 * A meal of the day as one task, whose steps are what's left to decide.
 *
 * This is the generator `mealCook` grew into, and the fold is the point. A cook
 * task only ever existed for a meal that had already been chosen — plan a
 * recipe on Thursday, get "Cook X" on Thursday — so the day the plan was blank
 * was the day the task list said nothing at all. Which is the day you actually
 * need it: at noon with no answer, the app knew it had a meal planner, a recipe
 * box, a fridge and a ranked list of things to cook, and offered none of it
 * from the list you were looking at.
 *
 * So the unit stops being the *meal* and becomes the *slot*: lunch on the 22nd,
 * whether or not anything is in it. What's in it decides the steps.
 *
 * | The slot holds | The chain |
 * |---|---|
 * | nothing | Choose → Prepare → Eat |
 * | a recipe | Cook X → Eat X |
 * | a leftover, takeout, a typed answer | Eat X (no chain — one step) |
 *
 * **"Already chosen" is the same task with its first step gone**, not a
 * different task. That's why the table above is read on every reconcile and not
 * just at creation: planning dinner at four o'clock rewrites the row you're
 * looking at from "Choose dinner" to "Cook Chili", rather than deleting one
 * task and writing another underneath it.
 *
 * **A chain is only rewritten while it hasn't been started** (`chainIndex ===
 * 0`, see `mealSlotChainDrift`). Once you've ticked a step the remaining ones
 * are yours — a plan change mid-cook updates the title and the link and leaves
 * the steps alone. Rewriting them would have to remap the index onto a
 * different-length list, and there is no honest answer for what step 1 of
 * [Choose, Prepare, Eat] becomes in [Cook X, Eat X].
 *
 * Pure, like the four generator rule modules beside it: which slots qualify,
 * what the task says, and which fields the slot owns. The firing lives in
 * `useTaskStore.checkMealSlotTasks`, the reconcile in `useMealPlanStore`.
 */

/**
 * `2026-08-22#lunch` — the (day, slot) a task is for, as its
 * `generatedSourceId`.
 *
 * Not an entry id, and that's the whole change. A cook task pointed at the
 * `MealPlanEntry` it was projected from, which meant it could not exist before
 * there was one; a slot exists on every day whether or not it has been
 * answered. It puts this generator in `mealPlanNudge`'s position rather than
 * the other three's — a source id naming a square on the calendar, with no row
 * behind it to write an opt-out onto. See `writeGeneratedOptOut`, which has
 * nothing to write for either.
 *
 * `#` rather than `:` because a day key already contains `-` and a slot never
 * contains either; the pair has to split back apart unambiguously for
 * `parseMealSlotSource`, which is how a completion finds the meal to mark
 * cooked.
 */
/**
 * Which time-of-day segment the slot's *last* chain step — the one that
 * actually eats the meal — hides behind. See `mealSlotStepTimeSegments`,
 * which is what every caller actually wants: an earlier step (Choose,
 * Prepare, Cook X) is never gated by this, only the step that finishes the
 * chain is.
 *
 * **This is the mechanism that makes the feature quiet**, not a decoration. A
 * task segmented `evening` is invisible on Today until evening (see
 * isTaskVisible), so "Eat dinner" doesn't sit on the list competing with
 * work at nine in the morning — which is precisely the complaint the old meals
 * block drew (#1402). The visibility model already knew how to do this; nothing
 * new hides anything. It is also what makes "decide in the moment" work rather
 * than being a slogan: the row surfaces roughly when the meal does.
 *
 * It used to gate every step of the chain, "Choose dinner" included — which
 * meant the one step you'd actually want to do ahead of time (decide, or get
 * a head start on prep) was hidden until it was already dinner time to ask
 * about it. Only the last step needs to wait for the meal; deciding what's
 * for dinner is not itself a thing that happens at mealtime.
 *
 * Snack maps to no segment on purpose. The other three name a real part of the
 * day, and a snack doesn't — it's whenever — so segmenting it would be
 * inventing a time the user never said. It's also why snack is off by default
 * (see DEFAULT_MEAL_SLOTS_ENABLED): with no segment its row would sit there
 * from the start of the day.
 *
 * Inherited unchanged from the cook tasks this generator folded in, and the
 * one part of them that needed no rethinking.
 */
export const MEAL_SLOT_SEGMENTS: Record<MealSlot, TimeOfDay[]> = {
  breakfast: ['morning'],
  lunch: ['afternoon'],
  dinner: ['evening'],
  snack: [],
};

/**
 * The time segment (if any) a specific step of a meal-slot chain should hide
 * behind. Only the step that finishes the chain — Eat, Eat X, or the
 * single-step Eat X for a slot with no chain at all — hides behind
 * `MEAL_SLOT_SEGMENTS`. Every earlier step (Choose, Prepare, Cook X) is
 * visible from the start of the day: deciding or prepping a meal isn't a
 * thing that happens at mealtime, so hiding it there only cost the morning
 * you'd have wanted to decide in.
 *
 * Used both at creation (`mealSlotTaskFields`, always index 0 of the chain
 * just computed) and when `completeTask` spawns a chain's next step
 * (`useTaskStore.ts`, wherever `chainIndex` lands next) — the same question,
 * asked at two different points the chain passes through.
 */
export function mealSlotStepTimeSegments(slot: MealSlot, chainIndex: number, chainLength: number): TimeOfDay[] {
  return chainIndex >= chainLength - 1 ? (MEAL_SLOT_SEGMENTS[slot] ?? []) : [];
}

const SOURCE_SEP = '#';

/**
 * How many days of meal tasks exist at a time, counting today.
 *
 * A week, matching the meal plan's own `upcomingDays` and the horizon the
 * weekly nudge asks about — plan Friday's dinner on Tuesday and its task is
 * there on Later straight away, dated forward and hidden by `isTaskVisible`
 * until Friday, exactly as a cook task used to be.
 *
 * This shipped as today-only, on the grounds that a week of rows saying "Choose
 * lunch" would be noise. It isn't: those meals genuinely are undecided, and a
 * Later screen that says so is being accurate rather than loud. What the
 * narrower version actually cost was the honest half — a meal you *had* planned
 * had something to say ahead of time and no row to say it on.
 */
export const MEAL_SLOT_TASK_DAYS = 7;

/**
 * The meals a day gets a task for until the user says otherwise.
 *
 * Breakfast, lunch and dinner — the same three `MEAL_PLAN_NUDGE_SLOTS` counts a
 * day out of, and for the same reason. Snack is left off: it has no time-of-day
 * segment (see `MEAL_SLOT_SEGMENTS`), so its row would sit on Today from the
 * start of the day rather than surfacing when the meal does, and a day isn't
 * incomplete for want of one.
 */
export const DEFAULT_MEAL_SLOTS_ENABLED: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export function mealSlotSourceId(dayKey: string, slot: MealSlot): string {
  return `${dayKey}${SOURCE_SEP}${slot}`;
}

/** The (day, slot) back out of a source id, or null if it isn't one. */
export function parseMealSlotSource(sourceId: string | null): { dayKey: string; slot: MealSlot } | null {
  if (!sourceId) return null;
  const at = sourceId.indexOf(SOURCE_SEP);
  if (at <= 0) return null;
  const dayKey = sourceId.slice(0, at);
  const slot = sourceId.slice(at + 1) as MealSlot;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  if (!(slot in MEAL_SLOT_SEGMENTS)) return null;
  return { dayKey, slot };
}

/**
 * Which meal a task is for, or null when it isn't one of this generator's.
 *
 * The same shape as `mealPlanNudgeDayKey`/`projectReviewProjectId`: the source
 * id already holds the answer, so a row can say which meal it belongs to
 * without a store read. A legacy `mealCook` row parses to null — its source id
 * is an entry id rather than a (day, slot) — which is the right answer for a
 * kind nothing creates any more.
 *
 * What reads it is the meal chip on a task row. An unanswered slot names its
 * meal in every step it has ("Choose lunch", "Prepare lunch", "Eat lunch"), but
 * the moment something is planned the title becomes the food — "Cook Peanut
 * Butter Tofu with Sriracha" — and a day's three of these sit together under
 * one category with nothing saying which is which.
 */
export function mealSlotOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): MealSlot | null {
  return parseMealSlotSource(generatedSourceOf(task, 'mealSlot'))?.slot ?? null;
}

/**
 * Where the row's link button goes.
 *
 * Two destinations, and which one applies is a fact about the slot rather than
 * about the step: an answered slot opens its day on the meal plan (exactly
 * where a cook task's link already went, #1625), and an unanswered one opens
 * the same day with the picker already up on the right slot.
 *
 * **The picker is reached by link rather than hosted on Today**, which is the
 * same call `projectReview` made — its task's link opens `ProjectPullSheet`
 * rather than Today growing a second sheet of its own. `RecipePickerSheet` is
 * already mounted on the Meal Plan screen with the day's context around it, and
 * a second copy over Today would be a second place for "what am I eating"
 * to be answered, which is how two of these drift apart.
 */
export function mealSlotLinkUrl(dayKey: string, slot: MealSlot, answered: boolean): string {
  const base = mealPlanNudgeLinkUrl(dayKey);
  return answered ? base : `${base}&pick=${slot}`;
}

/** Whether this entry counts as an answer to its slot. */
function isAnswered(entry: MealPlanEntry | null): entry is MealPlanEntry {
  return !!entry;
}

/**
 * The steps, given what's in the slot.
 *
 * Ids are derived from the slot rather than minted, so a reconcile that
 * recomputes an unchanged chain compares equal and writes nothing — the same
 * reason `cookTaskNeedsUpdate` existed.
 *
 * The one-step case returns a single item and the caller turns the chain
 * *off* for it (see `mealSlotTaskFields`): a single-item chain already reads
 * as a plain task everywhere in the UI (`activeChainStep` refuses to count
 * one), so leaving it on would store a chain nothing ever displays.
 *
 * `recipeMinutes` — the recipe's own `totalMinutes()` (prep + cook) — lands on
 * the Cook step alone. There is no separate Prepare step once a recipe is
 * chosen (that only exists in the unanswered [Choose, Prepare, Eat] chain, and
 * a generic "Prepare lunch" has no recipe to read a time from), so Cook X is
 * the one step standing in for the whole act of making the dish and gets the
 * whole number.
 *
 * `stepEstimates` is the fallback for every step *without* a recipe to read a
 * time from — Choose/Prepare/Eat, keyed by the same `${slot}-${key}` id the
 * step carries (see `useSettingsStore.mealSlotStepEstimates`). These never
 * vary meal to meal the way a recipe's cook time does, so once the user has
 * sized one "Choose breakfast" there is no new evidence a second one could
 * offer — every later step with that id is created already carrying the
 * remembered value instead of asking again.
 */
export function mealSlotChain(
  slot: MealSlot,
  entry: MealPlanEntry | null,
  recipeMinutes: number | null = null,
  stepEstimates: Readonly<Record<string, number>> = {}
): ChainItem[] {
  const lower = MEAL_SLOT_LABELS[slot].toLowerCase();
  const step = (key: string, title: string, estimatedMinutes: number | null = null): ChainItem => {
    const id = `${slot}-${key}`;
    return { id, title, estimatedMinutes: estimatedMinutes ?? stepEstimates[id] ?? null };
  };
  if (!isAnswered(entry)) {
    return [
      step('choose', `Choose ${lower}`),
      step('prepare', `Prepare ${lower}`),
      step('eat', `Eat ${lower}`),
    ];
  }
  // A recipe is the app's own evidence that a meal is something you *make* —
  // the same test wantsCookTask used to decide whether a meal was work at all,
  // kept here to decide whether there is a step for making it. A leftover
  // points at the fridge, which is the opposite of a thing to cook.
  if (entry.recipeId && !entry.leftoverId) {
    return [step('cook', `Cook ${entry.title}`, recipeMinutes), step('eat', `Eat ${entry.title}`)];
  }
  return [step('eat', `Eat ${entry.title}`)];
}

/**
 * What the row is called when it isn't showing a step.
 *
 * `displayTitleFor` shows the active chain step for a real chain, so this is
 * read in the editor, in Search and on the one-step rows — which is why an
 * answered slot is titled after the food and an unanswered one after the meal.
 * "Lunch" with nothing under it is the honest name for a slot with no answer
 * yet; naming it "Eat lunch" would state as fact the step you haven't reached.
 */
export function mealSlotTaskTitle(slot: MealSlot, entry: MealPlanEntry | null): string {
  if (!isAnswered(entry)) return MEAL_SLOT_LABELS[slot];
  const chain = mealSlotChain(slot, entry);
  return chain.length > 1 ? entry.title : chain[0].title;
}

/**
 * The fields the slot owns — everything the app is allowed to rewrite under
 * the user.
 *
 * `cookTaskFields`' list was four and called itself deliberately complete; this
 * is six, and the two additions are the chain itself. That is the same promise
 * one step wider rather than a weakening of it: the category the task is filed
 * under, its notes, its priority, its subtasks and its reminder are still
 * untouched for ever, because a reconcile that reset any of those would make
 * the row worthless as a task.
 *
 * `chainEnabled`/`chainItems` are in the list but are **not** written at every
 * index — see `mealSlotDrift`, which withholds them once the chain is under
 * way.
 */
export function mealSlotTaskFields(
  dayKey: string,
  slot: MealSlot,
  entry: MealPlanEntry | null,
  recipeMinutes: number | null = null,
  stepEstimates: Readonly<Record<string, number>> = {}
): {
  title: string;
  dueDate: string;
  timeSegments: TimeOfDay[];
  linkUrl: string;
  chainEnabled: boolean;
  chainItems: ChainItem[];
} {
  const chain = mealSlotChain(slot, entry, recipeMinutes, stepEstimates);
  return {
    title: mealSlotTaskTitle(slot, entry),
    // Never null: dayKeyToDate always yields a real Date, and the offset is 0.
    // The same noon-normalized anchor a meal's prep tasks use, so the day a
    // slot task lands on can't drift from the day its meal is on.
    dueDate: resolveOffsetDate(dayKeyToDate(dayKey), 0)!,
    // See mealSlotStepTimeSegments: only the step that finishes the chain
    // hides behind the meal's time-of-day segment. At creation the task is
    // always on step 0 of the chain just computed above.
    timeSegments: mealSlotStepTimeSegments(slot, 0, chain.length),
    linkUrl: mealSlotLinkUrl(dayKey, slot, isAnswered(entry)),
    chainEnabled: chain.length > 1,
    chainItems: chain,
  };
}

/** Two chains are equal when their steps are, in order — ids and estimates included. */
function sameChain(a: readonly ChainItem[], b: readonly ChainItem[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (item, i) =>
        item.id === b[i].id && item.title === b[i].title && item.estimatedMinutes === b[i].estimatedMinutes
    )
  );
}

/**
 * What has drifted on a live slot task, or null when nothing has.
 *
 * The date is not in it — see the note inline. Everything else the slot owns
 * is, because it's derived from what the slot holds rather than from anything
 * the user could have set.
 *
 * Returning null rather than writing unconditionally matters more here than it
 * did for cook tasks: this reconcile runs on every meal-plan mutation, and most
 * of them (a scale change, a re-sort within a slot, an edit to *another* slot's
 * meal) change nothing this row shows.
 *
 * **The chain is withheld once the chain has started.** `chainIndex > 0` means
 * a step has been ticked and a fresh row spawned for the next one, and the
 * index is only meaningful against the list it was computed from — see the
 * module header. `timeSegments` is withheld the same way and for the same
 * reason: which step is time-gated depends on this row's own fixed position
 * in *its* chain (`mealSlotStepTimeSegments`, applied once at spawn — see
 * `completeTask`), not on a chain a plan change just recomputed from scratch.
 */
export function mealSlotDrift(
  task: Pick<Task, 'title' | 'dueDate' | 'timeSegments' | 'linkUrl' | 'chainEnabled' | 'chainItems' | 'chainIndex'>,
  dayKey: string,
  slot: MealSlot,
  entry: MealPlanEntry | null,
  recipeMinutes: number | null = null,
  stepEstimates: Readonly<Record<string, number>> = {}
): Partial<Task> | null {
  const next = mealSlotTaskFields(dayKey, slot, entry, recipeMinutes, stepEstimates);
  const started = (task.chainIndex ?? 0) > 0;
  const updates: Partial<Task> = {};
  if (task.title !== next.title) updates.title = next.title;
  // Deliberately not the date. It's set once, at creation, from the day in the
  // source id — which never changes, so the only thing that can move it is the
  // user, and chasing it would mean rewriting a row they deferred to tomorrow
  // straight back onto today. `projectReview` draws the same line for the same
  // reason. (A meal moved to another day isn't this task moving: it's two
  // slots reconciling, the one it left and the one it landed in.)
  if (task.linkUrl !== next.linkUrl) updates.linkUrl = next.linkUrl;
  if (
    !started &&
    (task.timeSegments.length !== next.timeSegments.length ||
      next.timeSegments.some((seg, i) => task.timeSegments[i] !== seg))
  ) {
    updates.timeSegments = next.timeSegments;
  }
  if (!started) {
    if (task.chainEnabled !== next.chainEnabled) updates.chainEnabled = next.chainEnabled;
    if (!sameChain(task.chainItems, next.chainItems)) updates.chainItems = next.chainItems;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

/**
 * The full draft for a slot that doesn't have a task yet.
 *
 * `category` is applied here and nowhere else — on creation only, never on a
 * reconcile — because it isn't one of the fields the slot owns. It shares
 * `mealCookTaskCategory` with the cook tasks it replaces and with the meal rows
 * on Today, which is the setting that already means "where food goes on Today".
 */
export function mealSlotTaskDraft(
  dayKey: string,
  slot: MealSlot,
  entry: MealPlanEntry | null,
  category: string | null = null,
  recipeMinutes: number | null = null,
  stepEstimates: Readonly<Record<string, number>> = {}
): Partial<TaskDraft> {
  return {
    ...mealSlotTaskFields(dayKey, slot, entry, recipeMinutes, stepEstimates),
    ...generatedBy('mealSlot', mealSlotSourceId(dayKey, slot)),
    chainIndex: 0,
    category,
  };
}

/**
 * Whether completing this task means the meal happened.
 *
 * The question a cook task answered by existing at all — one task, one tick,
 * one cooking — and now has to be asked, because ticking "Choose lunch" is
 * three quarters of the way from deciding anything. Only the last step counts:
 * `isChainFinish` is the store's own `atChainEnd && !recurs` test, and a
 * one-step slot (a leftover, takeout) is its own last step.
 */
export function completesMealSlot(
  task: Pick<Task, 'chainEnabled' | 'chainIndex' | 'chainItems' | 'recurrenceType'>
): boolean {
  if (!task.chainEnabled || task.chainItems.length <= 1) return true;
  return isChainFinish(task);
}

/**
 * The id of the chain step a mealSlot-generated task is currently showing —
 * the key `mealSlotStepEstimates` (`useSettingsStore`) remembers a per-
 * step-type time estimate under, so sizing "Choose breakfast" once carries
 * forward to every later "Choose breakfast" without asking again.
 *
 * Deliberately reads `chainItems[chainIndex]` directly rather than going
 * through `activeChainStep` — that helper's "a single-item chain doesn't
 * count as one" rule exists to keep a lone step from showing a chain badge
 * in the UI, which has nothing to do with whether this step already has a
 * duration worth remembering. A leftover/takeout answer's one-step "Eat X"
 * needs a step id here just as much as a multi-step chain does.
 *
 * Null for a task this generator didn't write.
 */
export function activeMealSlotStepId(
  task: Pick<Task, 'generatedKind' | 'chainIndex' | 'chainItems'>
): string | null {
  if (task.generatedKind !== 'mealSlot') return null;
  return task.chainItems[task.chainIndex]?.id ?? null;
}
