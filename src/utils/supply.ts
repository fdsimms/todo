import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import type { GroceryItem, Task } from '../types';
import { nthOccurrence } from './calendarMonth';
import { dayKeyOf, getLogicalToday } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { normalizeTargetUnit } from './quotaUnit';

/**
 * Supply — "I have six filters, and every time I do this task one of them is
 * gone."
 *
 * The gap this fills is narrow and worth stating precisely, because two
 * existing models look like they already cover it and neither does. Recurrence
 * knows *when* a task happens and nothing about what it spends. The kitchen
 * knows what you probably have, but derives it from how long ago you bought the
 * thing (`probablyHaveReason`, `onHandUntil`, the shelf-life lexicon) — a decay
 * guess, and a food-shaped one, so it can say nothing at all about a CPAP
 * filter, a contact lens, a printer cartridge or the dog's flea treatment.
 *
 * **Here the app is the meter.** A completion *is* a unit spent, and the app is
 * what records completions, so the count is exact rather than inferred. That
 * asymmetry is the whole reason this is its own feature and not a wing of the
 * pantry: nothing else in the app gets to know an inventory rather than guess
 * at one.
 *
 * ## The two triggers, and why there are two
 *
 * Running out is not the moment to find out. The question is always "will what
 * I have left outlast the time it takes to get more", and there are two ways to
 * answer it:
 *
 * - **A count.** "Tell me when I'm down to my last one." Crude — two left is
 *   two months of runway on a monthly filter change and two days on a daily
 *   pill — but it is the *only* trigger available to a task whose future dates
 *   can't be projected at all (`recurrenceFromCompletion`, a live chain; see
 *   `canProject`), so it can't be the one that's optional.
 * - **A lead time.** "It takes a week to arrive." With a projectable schedule
 *   the app walks the recurrence forward to the day the last unit gets spent
 *   (`supplyRunOutDate`) and works backwards from it, which is the answer the
 *   count is a proxy for.
 *
 * Both are live at once and whichever fires first wins, so filling in the lead
 * time can only ever make the app speak up *earlier* than the count alone
 * would have. That direction matters: a user who sets a lead time and then
 * finds the app went quieter has been punished for giving it better
 * information.
 *
 * ## What it does when it fires
 *
 * Two different things, decided by whether the supply names a grocery catalog
 * row (`Task.supplyGroceryItemId`):
 *
 * - **Unlinked** — the ordinary case, and everything the grocery side can't
 *   model. A generated "Order more filters" task (`GeneratedKind`
 *   `'supplyReorder'`), carrying the source task's own `linkUrl`, because a
 *   consumable bought online is a task whose entire content is that link.
 * - **Linked** — the item goes on the shopping list (`runningLowAt`), and *no
 *   task is written at all*. A row on Today saying "buy X" next to a line on
 *   the shopping list saying "buy X" is one thing to do and two things nagging
 *   about it; the list is where buying belongs, so the list gets it.
 *
 * ## Restocking is the hard half
 *
 * Counting down is easy and every consumable tracker manages it. They die on
 * the way back up: the user buys more, never says so, the count is wrong for
 * ever, and the feature becomes noise. Two things keep that from happening
 * here, and neither is a screen anybody has to visit:
 *
 * - The reorder task **asks on completion** (`deliverableKind: 'number'`,
 *   defaulted to `supplyRefillCount`), so topping up is the tap you were making
 *   anyway. See the second-reader note in `src/utils/deliverables.ts`.
 * - A linked supply tops itself up **when the item is bought**, since the
 *   grocery side already records that.
 */

/**
 * A ceiling on a supply, so a mistyped keypad can't produce a run-out date
 * ten thousand occurrences out and a walk that spends the whole projection
 * backstop reaching it.
 *
 * 999 rather than something tighter because the honest large case is real: a
 * daily pill dispensed ninety at a time, a box of two hundred lens wipes.
 */
export const MAX_SUPPLY_COUNT = 999;

/** Where the reorder threshold sits until the user moves it: on the last one. */
export const DEFAULT_SUPPLY_REORDER_AT = 1;

/**
 * How many reorder offers may sit on Today at once.
 *
 * Higher than `MAX_PANTRY_CHECK_TASKS` (3) on purpose, and the reason is what
 * each cap is defending against. A pantry check is projected from a catalog of
 * hundreds of rows whose purchase windows lapse whenever they lapse, so its cap
 * is holding back a flood nobody asked for. A supply exists only because
 * somebody sat in the editor and typed a number into it, so the set is small by
 * construction and every member of it is a thing the user said they wanted
 * warning about. This is a backstop against a bulk import, not a filter.
 */
export const MAX_SUPPLY_REORDER_TASKS = 5;

/** A supply count as it's stored: a whole number in range, or null for "not a supply". */
export function clampSupplyCount(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return Math.min(MAX_SUPPLY_COUNT, Math.max(0, Math.floor(raw)));
}

/**
 * The reorder threshold, floored at 1.
 *
 * Never 0, and this is the one clamp with an opinion rather than a range: a
 * threshold of zero means "ask once I have run out", which is precisely the
 * state the feature exists to get ahead of. The editor's stepper stops at 1 for
 * the same reason, and this is what holds the floor for a value arriving from a
 * draft, a restored backup or another device.
 */
export function clampSupplyReorderAt(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return DEFAULT_SUPPLY_REORDER_AT;
  return Math.min(MAX_SUPPLY_COUNT, Math.max(1, Math.floor(raw)));
}

/** Days a delivery takes, or null for "the user hasn't said". Non-negative. */
export function clampSupplyLeadDays(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return Math.min(365, Math.max(0, Math.floor(raw)));
}

/** How many arrive per restock, or null for "no idea". At least 1 when set. */
export function clampSupplyRefillCount(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return Math.min(MAX_SUPPLY_COUNT, Math.max(1, Math.floor(raw)));
}

/** The fields a supply read needs — every helper here takes this, not a whole Task. */
export type SupplySource = Pick<
  Task,
  | 'supplyCount'
  | 'supplyUnit'
  | 'supplyRefillCount'
  | 'supplyReorderAt'
  | 'supplyLeadDays'
  | 'supplyDeclinedAtCount'
  | 'supplyGroceryItemId'
>;

/**
 * Whether this task tracks a supply at all.
 *
 * `supplyCount !== null`, and 0 is emphatically a supply — being out of filters
 * is the state the whole feature is pointed at, so a `!count` test here would
 * switch the feature off at exactly the moment it matters. Same trap
 * `isQuotaTask` avoids by testing the target rather than the progress.
 */
export function isSupplyTask(task: Pick<Task, 'supplyCount'>): boolean {
  return task.supplyCount !== null;
}

/**
 * Whether a supply on this task would ever count down.
 *
 * A supply rides onto the successor `completeTask` spawns, exactly as
 * `recurrenceCount` and the streak do, so a task that spawns no successor has
 * nowhere to put the decrement — the count would sit at its starting value for
 * ever while the user spent the actual filters. Rather than let that happen
 * quietly, the editor only offers the card on a repeating task, the same
 * constraint a daily target lives under.
 */
export function canHoldSupply(task: Pick<Task, 'recurrenceType' | 'parentId'>): boolean {
  return task.recurrenceType !== 'none' && !task.parentId;
}

/**
 * The day the last unit gets spent, or null when the schedule can't say.
 *
 * The current occupant of `dueDate` spends one, so a count of 1 runs out on the
 * task's own due date and a count of N on the (N-1)th occurrence after it.
 *
 * Null for a supply that has already run out (there is no future occurrence
 * that spends a unit it hasn't got) and for every task `canProject` refuses.
 * Callers must treat null as "no date-based answer available" rather than as
 * "not urgent" — `supplyReorderReason` does, by settling the count threshold
 * first.
 */
export function supplyRunOutDate(task: Task, dayResetTime?: string): Date | null {
  const count = task.supplyCount;
  if (count === null || count <= 0) return null;
  return nthOccurrence(task, count - 1, dayResetTime);
}

/**
 * The last day an order can be placed and still arrive in time, or null when
 * either half of that sum is unknown.
 *
 * Deliberately not clamped to today. A supply already past its order-by day is
 * *late*, and saying so ("needed 3 days ago") is more use than pretending the
 * deadline is this morning.
 */
export function supplyOrderByDate(task: Task, dayResetTime?: string): Date | null {
  const lead = clampSupplyLeadDays(task.supplyLeadDays);
  if (lead === null) return null;
  const runOut = supplyRunOutDate(task, dayResetTime);
  if (runOut === null) return null;
  return addDays(runOut, -lead);
}

/** Why a supply is asking to be restocked, or null when it isn't. */
export type SupplyReorderReason = 'count' | 'leadTime';

/**
 * Whether this supply wants more ordered right now, and on which of the two
 * triggers.
 *
 * The count is settled first, and not only because it's cheaper: it's the
 * trigger that still answers when the schedule can't be projected, and it's the
 * one that catches a supply already at zero. Once it has fired, the lead-time
 * walk would be answering a question that has already been answered.
 *
 * **The decline is checked here rather than by the caller** so that every
 * reader — the sweep that writes tasks, the grocery bridge, and anything that
 * later wants to show "asking for more" on a row — agrees about what a swipe
 * meant. See `Task.supplyDeclinedAtCount`.
 */
export function supplyReorderReason(task: Task, dayResetTime?: string): SupplyReorderReason | null {
  const count = task.supplyCount;
  if (count === null) return null;
  if (!canHoldSupply(task)) return null;
  if (task.completed || task.archived) return null;
  // A generated task never carries a supply of its own, and a reorder task
  // generating a reorder task is the one loop this feature could produce.
  if (task.generatedKind !== null) return null;

  // Turned down at this count or lower, and nothing has been bought since —
  // the count only ever falls on its own, so this stays true until a restock
  // lifts it above the stamp. No second field to clear, and no day-based lapse
  // that would ask again tomorrow about an order already placed.
  const declined = task.supplyDeclinedAtCount;
  if (declined !== null && count <= declined) return null;

  if (count <= clampSupplyReorderAt(task.supplyReorderAt)) return 'count';

  const orderBy = supplyOrderByDate(task, dayResetTime);
  if (orderBy === null) return null;
  return dayKeyOf(orderBy) <= dayKeyOf(getLogicalToday(dayResetTime)) ? 'leadTime' : null;
}

/** "3 filters left", or "3 left" when no unit has been named. */
export function formatSupplyLeft(count: number, unit: string | null | undefined): string {
  const u = normalizeTargetUnit(unit);
  return u ? `${count} ${u} left` : `${count} left`;
}

/**
 * The supply, as the task row and the editor say it.
 *
 * Zero is called out in words rather than shown as "0 filters left", which
 * reads as a number to be scanned past rather than as the thing that has
 * happened. Same instinct behind `CollapsibleField`'s `summaryEmpty`: the state
 * that most needs noticing shouldn't be rendered in the shape of a value.
 */
export function describeSupply(task: SupplySource): string | null {
  const count = task.supplyCount;
  if (count === null) return null;
  const u = normalizeTargetUnit(task.supplyUnit);
  if (count === 0) return u ? `Out of ${u}` : 'Out';
  return formatSupplyLeft(count, u);
}

/**
 * "Runs out Nov 12" — the derived half of the chip, shown beside the count.
 *
 * Absolute, never through `formatScheduledDate`, for the same reason a recorded
 * deliverable date is: "Runs out Today" is true for one day and quietly wrong
 * every day after, and this string is read on a row the user may not open again
 * for a fortnight.
 */
export function describeSupplyRunOut(runOut: Date): string {
  const sameYear = runOut.getFullYear() === new Date().getFullYear();
  return `Runs out ${format(runOut, sameYear ? 'MMM d' : 'MMM d, yyyy')}`;
}

/**
 * The task a reorder task speaks for, or null for any other task.
 *
 * Thin, and deliberately `generatedSourceOf` under a name that says what the
 * string means here — one column holds seven generators' source ids, and this
 * is the first whose id is a *task* id. A grocery item's id read as a task id
 * would restock a task that doesn't exist.
 */
export function supplyReorderSourceId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'supplyReorder');
}

/**
 * The reorder task's title.
 *
 * Names the unit when there is one, because "Order more filters" is a complete
 * instruction and the unit is already the noun for the thing being counted.
 * Without one it falls back to naming the task, which is long but never
 * ambiguous — a bare "Order more" on Today, in Search or on the widget is a row
 * whose entire content is missing, the failure `projectReviewTitle` avoids by
 * refusing to render a project's name on its own.
 *
 * The editor's hint on the unit field says it names this task, which is the
 * nudge towards the good case; there's no rule that can invent a noun from
 * "Replace CPAP filter" on the user's behalf.
 */
export function supplyReorderTitle(task: Pick<Task, 'title'> & Pick<Task, 'supplyUnit'>): string {
  const u = normalizeTargetUnit(task.supplyUnit);
  return u ? `Order more ${u}` : `Order more for ${task.title}`;
}

/** One supply that should have a reorder task sitting on today's list. */
export interface SupplyReorderWant {
  taskId: string;
  title: string;
  reason: SupplyReorderReason;
  /** The day the supply runs out, when the schedule can say — the task's deadline. */
  runOut: Date | null;
  /** Defaults the "how many did you get?" answer, when the user has said. */
  refillCount: number | null;
  /** Where to buy it: the source task's own link, when it has one. */
  linkUrl: string | null;
  /** Where to file it: the source task's own category, when it has one. */
  category: string | null;
}

/**
 * Which supplies should have a reorder task right now, most urgent first.
 *
 * **Linked supplies are excluded here rather than by the caller**, because
 * their absence is the design rather than an omission: a supply that names a
 * grocery item is answered by putting that item on the shopping list, and a
 * task saying "buy X" beside a list entry saying "buy X" is two nags for one
 * errand. See `suppliesWantingList`.
 *
 * Urgency is the run-out day, soonest first, with the supplies that can't
 * project a day at all sorted last among the wanted — they're wanted on the
 * count alone, so their absolute urgency genuinely isn't known, and putting a
 * knowable "runs out Tuesday" ahead of an unknowable one is the ordering that
 * loses least when the cap bites.
 */
export function wantedSupplyReorders(
  tasks: readonly Task[],
  dayResetTime?: string,
  cap: number = MAX_SUPPLY_REORDER_TASKS,
): SupplyReorderWant[] {
  const wants: (SupplyReorderWant & { sortKey: string })[] = [];
  for (const task of tasks) {
    if (task.supplyGroceryItemId) continue;
    const reason = supplyReorderReason(task, dayResetTime);
    if (reason === null) continue;
    const runOut = supplyRunOutDate(task, dayResetTime);
    wants.push({
      taskId: task.id,
      title: supplyReorderTitle(task),
      reason,
      runOut,
      refillCount: clampSupplyRefillCount(task.supplyRefillCount),
      linkUrl: task.linkUrl ?? null,
      category: task.category ?? null,
      // '~' sorts after every digit, so an unprojectable supply lands at the
      // back of the wanted set without a second comparator.
      sortKey: runOut ? dayKeyOf(runOut) : '~',
    });
  }
  wants.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return wants.slice(0, Math.max(0, cap)).map(({ sortKey: _sortKey, ...want }) => want);
}

/**
 * The reorder tasks sitting there whose reason has gone.
 *
 * **This is why the check runs on a sweep** rather than only when a supply
 * changes. A supply stops wanting more the moment it's topped up — including by
 * the user answering this very task — and it also stops when the source task is
 * completed for the last time, archived, has its recurrence removed, or is
 * linked to a grocery item after the fact. None of those mutations knows a row
 * is sitting on Today describing the old state, and "Order more filters" left
 * over after you ordered more filters is a chore about nothing.
 *
 * Judged against every wanting supply, not against the capped set: losing the
 * cap contest is not a reason to delete a row the user has already deferred to
 * Saturday, the same call `staleProjectReviewTasks` makes.
 *
 * A source task that has vanished entirely takes its reorder task with it —
 * `!sourceId` covers a row written without one, and a source id matching
 * nothing live is the deleted case.
 */
export function staleSupplyReorderTasks<T extends Task>(
  tasks: readonly T[],
  dayResetTime?: string,
): T[] {
  const stillWanting = new Set(
    tasks
      .filter(t => !t.supplyGroceryItemId && supplyReorderReason(t, dayResetTime) !== null)
      .map(t => t.id)
  );
  return liveGeneratedTasksOfKind(tasks, 'supplyReorder').filter(task => {
    const sourceId = supplyReorderSourceId(task);
    return !sourceId || !stillWanting.has(sourceId);
  });
}

/**
 * The grocery items a linked supply wants on the shopping list right now.
 *
 * The other half of `wantedSupplyReorders`: same trigger, different answer. An
 * item already flagged low is left alone rather than re-stamped, so the flag
 * keeps saying when the app first noticed rather than when it last looked.
 */
export function suppliesWantingList(
  tasks: readonly Task[],
  items: readonly Pick<GroceryItem, 'id' | 'runningLowAt'>[],
  dayResetTime?: string,
): string[] {
  const alreadyLow = new Set(items.filter(i => i.runningLowAt).map(i => i.id));
  const live = new Set(items.map(i => i.id));
  const out: string[] = [];
  for (const task of tasks) {
    const itemId = task.supplyGroceryItemId;
    if (!itemId || !live.has(itemId) || alreadyLow.has(itemId)) continue;
    if (supplyReorderReason(task, dayResetTime) === null) continue;
    if (!out.includes(itemId)) out.push(itemId);
  }
  return out;
}

/**
 * The live supplies stocked from a grocery item, in the order the tasks come.
 *
 * The read `suppliesWantingList` doesn't do: that one answers "which items
 * should go on the list right now", pointing task to item, and this points back
 * the other way so the grocery side can say *why* a row appeared and what is
 * counting on it.
 *
 * Without it the link is one-directional and invisible from the half that acts
 * on it. A recipe-sourced row explains itself (`sourceRecipeTitle`, rendered
 * both on the row and in the item sheet); a row put there by a supply had no
 * account of itself at all, and it's the one whose cause lives on a completely
 * different screen. `runningLowAt` is no help either — it has no row caption of
 * its own, and its copy reads throughout as something the user said by hand,
 * which for a supply-driven flag is not what happened.
 *
 * Completed and archived tasks are excluded on the same terms
 * `liveGeneratedTask` uses: a filed-away task is not still counting on the
 * cupboard, and naming it would be the sheet reporting a dependency that has
 * stopped existing.
 *
 * Returns every match rather than the first, because two tasks genuinely can
 * stock from one item (a filter changed at home and one at the office) and a
 * sheet that named only one of them would be quietly wrong about the other.
 */
export function suppliesStockedFrom<T extends Pick<Task, 'supplyGroceryItemId' | 'supplyCount' | 'completed' | 'archived'>>(
  itemId: string,
  tasks: readonly T[],
): T[] {
  return tasks.filter(
    t => t.supplyGroceryItemId === itemId
      && t.supplyCount !== null
      && !t.completed
      && !t.archived
  );
}

/**
 * How many task titles a provenance line names before it gives up and counts.
 *
 * Two, because "for A and B" is still a sentence and "for A, B and C" on a
 * grocery row is a caption nobody finishes reading. Past it the count is the
 * more useful thing anyway: the point of the line is that *something* depends
 * on this row, and the sheet is one tap away for the detail.
 */
const MAX_NAMED_SUPPLY_TASKS = 2;

/** `"A"`, `"A" and "B"`, or `3 tasks`. */
function joinSupplyTitles(tasks: readonly Pick<Task, 'title'>[]): string | null {
  if (tasks.length === 0) return null;
  if (tasks.length > MAX_NAMED_SUPPLY_TASKS) return `${tasks.length} tasks`;
  return tasks.map(t => `“${t.title}”`).join(' and ');
}

/**
 * The item sheet's line: what this catalog row is being kept stocked for.
 *
 * Sits with `sourceRecipeTitle` in the sheet's provenance strip, and is written
 * to read as its sibling ("For the recipe …" / "Stocked for …"). Null when
 * nothing stocks from it, which is every row in an ordinary catalog.
 *
 * **It names the task rather than linking to it.** The recipe line next to it is
 * a link because a recipe is a screen the app can open; there is no "open this
 * task" route anywhere in the app, and inventing one to serve a caption would
 * be a navigation surface added for a sentence. Naming is also all the line has
 * to do: it exists so a row that appeared on the list unasked has an account of
 * itself, and so someone about to delete this row can see something depends on
 * it — the sheet being where that delete lives is what makes it a warning
 * rather than a note.
 */
export function describeSupplyStock(tasks: readonly Pick<Task, 'title'>[]): string | null {
  const named = joinSupplyTitles(tasks);
  return named === null ? null : `Stocked for ${named}`;
}

/**
 * The shopping-list row's caption, deliberately shorter than the sheet's.
 *
 * Mirrors the recipe caption on the same row ("For “Chili”"), because they
 * answer the same question and a row that phrased one provenance differently
 * from the other would read as two unrelated features.
 */
export function describeSupplyStockCaption(tasks: readonly Pick<Task, 'title'>[]): string | null {
  const named = joinSupplyTitles(tasks);
  return named === null ? null : `For ${named}`;
}

/**
 * What the reorder task's "How many did you get?" field should arrive holding,
 * as a string, or null when the app has nothing to offer.
 *
 * The pack size off the task this reorder is for. It's the difference between
 * restocking being one tap and being a trip to the number pad, which is most of
 * what keeps a supply's count true — see the note at the top of this file about
 * where consumable trackers actually die.
 *
 * A seed and never an answer: the field is editable, so a delivery that came up
 * short is typed over, and the caller only offers it where there is no stored
 * answer already.
 */
export function supplyReorderPackSeed(
  reorder: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  tasks: readonly Pick<Task, 'id' | 'supplyRefillCount'>[],
): string | null {
  const sourceId = supplyReorderSourceId(reorder);
  if (!sourceId) return null;
  const pack = clampSupplyRefillCount(tasks.find(t => t.id === sourceId)?.supplyRefillCount);
  return pack === null ? null : String(pack);
}

/**
 * The supply after a restock of `bought` units.
 *
 * Adds rather than replaces, and the question the user answered says so ("How
 * many did you get?"). Replacing would quietly throw away whatever was still in
 * the cupboard when the delivery landed — the common case, since the whole
 * point of a lead time is to order while you still have some.
 *
 * A non-positive or unparseable answer leaves the count alone: null is a real
 * answer to every deliverable prompt (a completion may never be blocked on
 * giving one), so "completed the order task without saying how many" has to
 * mean "the app doesn't know", not "zero arrived".
 */
export function restockedSupplyCount(current: number | null, bought: number | null): number | null {
  if (current === null) return null;
  if (bought === null || Number.isNaN(bought) || bought <= 0) return current;
  return clampSupplyCount(current + Math.floor(bought));
}
