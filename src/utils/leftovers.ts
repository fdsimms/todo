import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { isSameWeek } from 'date-fns/isSameWeek';
import { subDays } from 'date-fns/subDays';
import type { Leftover, LeftoverFreshness, Recipe } from '../types';
import {
  LEFTOVER_KEEP_DAYS_DEFAULT,
  LEFTOVER_KEEP_DAYS_MAX,
  LEFTOVER_KEEP_DAYS_MIN,
  LEFTOVER_RETENTION_DAYS,
} from '../types';
import { cleanRecipeName } from './recipeUtils';
import { daysUntilDay, describeFrozenSince, describeUseBy, freshnessFor, isUseUpSoon, liveUseBy } from './freshness';
import { cookedDishes, type ChoiceResolution } from './recipeComponents';
import { dayKeyOf, dayKeyToDate } from './dateUtils';

/**
 * Everything decidable about what's in the fridge, kept store-free and
 * node-testable — the same discipline mealPlan.ts and recipeUtils follow, and
 * for the same reason: jest here runs in the `node` env with no renderer, so
 * anything left inside a component ships untested.
 *
 * Two rules run through the whole module and are worth stating once:
 *
 * - **Age and time-left are counted in calendar days, never in 24-hour blocks.**
 *   "Two days old" is what a person means when they open the fridge on Thursday
 *   having cooked on Tuesday, regardless of whether it went in at 6pm or
 *   midnight. differenceInCalendarDays is the whole reason `keepUntil` is stored
 *   as a day key rather than an instant.
 * - **Nothing here reads the clock by default without saying so.** Every
 *   function that needs "now" takes it as a parameter defaulting to
 *   `new Date()`, so the tests can place a container in a fridge on a Tuesday.
 */

/** Trims a container label for storage. Empty means "not a name" — the caller refuses it. */
export function cleanLeftoverTitle(raw: string): string {
  return cleanRecipeName(raw);
}

/**
 * One thing a cooked meal could have left behind — the whole dish, or one of
 * the components it was made of.
 *
 * A UI-facing shape rather than a stored one, like `ChoiceGroup` and
 * `PrepTaskDraft`: nothing here is written, it's what the log sheet renders and
 * what a tick turns into a `LeftoverDraft`.
 */
export interface LeftoverPart {
  /** Stable selection key. The component's recipe id, or WHOLE_PART_KEY for the meal itself. */
  key: string;
  /** What the container gets called — the leftover's `title`, verbatim. */
  title: string;
  /**
   * What it was made from.
   *
   * **A component's leftover points at the component's own recipe**, not at the
   * dish it was a part of, because that's what it *is*: leftover mash is a
   * container of mash, and pointing it at "steak with mashed potatoes" would
   * make every downstream read (plan a meal from it, open its recipe) offer to
   * re-cook a steak that was eaten. The parent isn't lost either — the
   * cooking it came from is already recorded on `Leftover.sourceEntryId`, whose
   * entry names the parent recipe, so a second `parentRecipeId` column would be
   * one more pointer to keep in step and to resolve-or-shrug, saying nothing
   * the entry doesn't already say.
   */
  recipeId: string | null;
  /** True for the meal as a whole. Exactly one part is ever the whole. */
  whole: boolean;
}

/** The key the whole-dish part carries — never a recipe id, which is what a component's key is. */
export const WHOLE_PART_KEY = 'whole';

/**
 * Where a container is going the moment it's logged.
 *
 * Two places, plus the answer that is genuinely both. Batch cooking is the
 * ordinary case this exists for — one pot becomes some of this week's dinner
 * and some of a night in November — and until this it had to be logged as one
 * container and then split by hand, which nothing in the app could do: a
 * `Leftover` has one `frozenAt` and one clock, so half of it going in the
 * freezer is a *second container*, not a second state on the first.
 *
 * **There is deliberately no pantry option**, though plenty of leftovers live
 * in a cupboard. The kitchen's vocabulary is settled (see kitchenInventory.ts):
 * the pantry is the grocery half, the fridge is the leftovers half, and the
 * freezer cuts across both. A third location here would be a fourth word for
 * the same shelf, and every caption the row already carries ("In the fridge
 * today", "Back in the fridge") would have to grow a case that changes nothing
 * about what the container does.
 */
export type LeftoverDestination = 'fridge' | 'freezer' | 'both';

/**
 * One container the log sheet is about to write: what to call it, what it was
 * made from, and which side of the kitchen it's going in.
 *
 * A UI-facing shape like `LeftoverPart` above, and one step further along —
 * a part is something that *could* be logged, a pick is a row that will be.
 */
export interface LeftoverPick {
  title: string;
  recipeId: string | null;
  /** True for the container going straight in the freezer. */
  frozen: boolean;
}

/**
 * The containers a set of ticked parts turns into, under one destination.
 *
 * `both` doubles each part rather than doubling the list, so a dish and its
 * two components come out as three adjacent pairs instead of three fridge rows
 * followed by three freezer ones. What that buys is the count on the log
 * button reading as the number of tubs actually going in the kitchen, which is
 * the only place the user ever sees how the answer multiplied out.
 *
 * The fridge half comes first in each pair for the same reason "Fridge" is the
 * first segment: it's the answer for most cookings, and the one the sheet
 * opens on.
 */
export function leftoverContainersFor(
  parts: readonly { title: string; recipeId: string | null }[],
  destination: LeftoverDestination,
): LeftoverPick[] {
  const picks: LeftoverPick[] = [];
  for (const part of parts) {
    const base = { title: part.title, recipeId: part.recipeId };
    if (destination !== 'freezer') picks.push({ ...base, frozen: false });
    if (destination !== 'fridge') picks.push({ ...base, frozen: true });
  }
  return picks;
}

/**
 * What a cooking of `recipe` could have left in the fridge: the meal itself,
 * then each component it actually cooked.
 *
 * `title` is the meal's own title (the entry's captured one, which may not be
 * the recipe's name) and is what the whole-dish part is called; the parts are
 * called after their own recipes, because that's the name on the container.
 *
 * **Pass the entry's choices as `resolution`.** A component that lost its
 * either/or was never cooked and cannot be in the fridge — see cookedDishes.
 *
 * A recipe with no components (or a free-text meal with no recipe at all)
 * yields exactly one part, which is what makes the sheet able to skip the
 * whole question for the ordinary case rather than asking it of everyone.
 */
export function leftoverPartsFor(
  title: string,
  recipe: Recipe | null | undefined,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution?: ChoiceResolution,
): LeftoverPart[] {
  const parts: LeftoverPart[] = [];
  // The entry's title wins, falling back to the recipe's for an entry that
  // somehow carries neither. A part with no name can't be logged (the store
  // refuses a blank title), so it's dropped rather than rendered blank.
  const wholeTitle = cleanLeftoverTitle(title) || cleanLeftoverTitle(recipe?.name ?? '');
  if (wholeTitle) {
    parts.push({ key: WHOLE_PART_KEY, title: wholeTitle, recipeId: recipe?.id ?? null, whole: true });
  }
  if (!recipe) return parts;
  for (const dish of cookedDishes(recipe, recipesById, resolution)) {
    if (dish.whole) continue;
    const partTitle = cleanLeftoverTitle(dish.recipe.name);
    if (!partTitle) continue;
    parts.push({ key: dish.recipe.id, title: partTitle, recipeId: dish.recipe.id, whole: false });
  }
  return parts;
}

/**
 * A keep-for count forced into the sayable range.
 *
 * Clamped rather than validated at the call site, matching setServings: the
 * stepper can't overshoot, but a restored backup can carry anything.
 */
export function clampKeepDays(days: number): number {
  if (!Number.isFinite(days)) return LEFTOVER_KEEP_DAYS_DEFAULT;
  return Math.max(LEFTOVER_KEEP_DAYS_MIN, Math.min(LEFTOVER_KEEP_DAYS_MAX, Math.round(days)));
}

/**
 * How long this dish's leftovers keep — the recipe's own answer if it gave one,
 * otherwise the standard window.
 *
 * The one reader of `Recipe.leftoverKeepDays`, so a recipe that carries a
 * nonsense number (a restored backup, a hand-edited row) still opens the stepper
 * on something it can hold — same clamp-on-read `keepDaysBetween` applies to a
 * stored pair of dates.
 *
 * **It seeds; it never overrides.** What it feeds is the log sheet's stepper, so
 * the number about to be written is the number on screen — which is also why
 * `logLeftover` still takes an explicit count rather than resolving the recipe
 * itself, and why editing a recipe leaves every container already in the fridge
 * exactly where it was. A keep-until is a fact about one container, decided the
 * day it went in.
 */
export function leftoverKeepDaysFor(recipe: Recipe | null | undefined): number {
  const days = recipe?.leftoverKeepDays;
  return days === null || days === undefined ? LEFTOVER_KEEP_DAYS_DEFAULT : clampKeepDays(days);
}

/**
 * A keep-for count in words — "Same day", "1 day", "5 days".
 *
 * About a *window*, where describeKeepUntil is about a particular container's
 * day ("Use by tomorrow"), so the two don't share a ladder: a recipe has no
 * today to count from. "Same day" rather than "0 days" for the floor, which is
 * the one value a bare number reads wrong.
 */
export function describeKeepDays(days: number): string {
  const clamped = clampKeepDays(days);
  if (clamped === 0) return 'Same day';
  return `${clamped} ${clamped === 1 ? 'day' : 'days'}`;
}

/** The `keepUntil` day key for "put away at `storedAt`, keep it `days` days". */
export function keepUntilKeyFor(storedAt: string, days: number): string {
  return dayKeyOf(addDays(new Date(storedAt), clampKeepDays(days)));
}

/**
 * The keep-for count a stored row is currently expressing — the inverse of
 * keepUntilKeyFor, for seeding the editor's stepper.
 *
 * Not stored, because the pair (storedAt, keepUntil) already says it and a third
 * column would be a second source of truth to keep in step. Clamped on the way
 * out so a row whose dates were edited into a negative gap still opens the
 * editor on a number the stepper can hold.
 */
export function keepDaysBetween(storedAt: string, keepUntil: string): number {
  return clampKeepDays(differenceInCalendarDays(dayKeyToDate(keepUntil), new Date(storedAt)));
}

/** Still in the fridge — nothing has closed it out. */
export function isLiveLeftover(leftover: Leftover): boolean {
  return !leftover.finishedAt;
}

/** How many calendar days it's been sitting there. Never negative. */
export function daysInFridge(leftover: Leftover, now: Date = new Date()): number {
  return Math.max(0, differenceInCalendarDays(now, new Date(leftover.storedAt)));
}

/**
 * Calendar days until the keep-until day. 0 means "today is the day", negative
 * means it's past.
 */
export function daysLeft(leftover: Leftover, now: Date = new Date()): number {
  return daysUntilDay(leftover.keepUntil, now);
}

/**
 * Where on the clock it sits.
 *
 * A closed-out leftover still answers — the row in the history list wants to
 * show what state it was in, and asking callers to null-check before every
 * colour lookup is how one of them ends up not doing it. Callers that only mean
 * live ones filter with isLiveLeftover first, which reads as the question they
 * were actually asking.
 */
export function freshnessOf(leftover: Leftover, now: Date = new Date()): LeftoverFreshness {
  return freshnessFor(leftover.keepUntil, now);
}

/**
 * This container's keep-until day if it's actually counting down, else null
 * because it's in the freezer — `freshness.liveUseBy` bound to the fridge's own
 * pair of fields, and the peer of `groceryExpiry.liveExpiresAt`.
 *
 * `keepUntil` itself stays non-null and untouched while frozen. What the
 * freezer suspends is the countdown, not the fact that this container was given
 * four days: thawing hands those four days back (see
 * `useLeftoverStore.setFrozen`), and there'd be nothing to hand back if freezing
 * had cleared the field.
 */
export function liveKeepUntil(leftover: Leftover): string | null {
  return liveUseBy(leftover.keepUntil, leftover.frozenAt);
}

/**
 * Where a container sits on the ladder *for display*, or null because it's
 * frozen and sitting nowhere on it.
 *
 * The nullable companion to `freshnessOf`, and the one every row colour should
 * use. `freshnessOf` deliberately still answers for a frozen container — a
 * history row wants to know what state it was in, and making the colour lookup
 * null-check everywhere is how one of them ends up not doing it — but a *live*
 * row tinted from a suspended date is the false alarm this whole feature
 * exists to stop: a chilli frozen three weeks ago would glow red on the fridge
 * card, which is the app shouting about food that is fine.
 *
 * Null renders as `textTertiary`, the same "nothing is counting down" grey a
 * dateless catalog row already gets in the kitchen list.
 */
export function liveFreshnessOf(
  leftover: Leftover,
  now: Date = new Date()
): LeftoverFreshness | null {
  const keepUntil = liveKeepUntil(leftover);
  return keepUntil ? freshnessFor(keepUntil, now) : null;
}

/**
 * Whether this is what the nudge is for: still in the fridge, and down to its
 * last day or already past it.
 *
 * The threshold includes 'soon' deliberately — the point is to catch it *before*
 * it's wasted, and a nudge that only fires on the day itself has already given
 * up the evening someone could have planned around it.
 *
 * **The one choke point for the freezer on this side.** `attentionLeftovers`,
 * `leftoverTasks.wantsUseUpTask`, `describeFridge`'s urgent count and the hub
 * pill's dot all ask their question through here, so a frozen container goes
 * quiet everywhere at once rather than in four places that have to agree.
 * `freshnessOf` deliberately stays as it was — it answers "where does this
 * container's day sit", which a history row still wants, and every colour
 * lookup in the app is keyed on its non-null return.
 */
export function needsAttention(leftover: Leftover, now: Date = new Date()): boolean {
  if (!isLiveLeftover(leftover) || leftover.frozenAt) return false;
  return isUseUpSoon(freshnessOf(leftover, now));
}

/** Still in the fridge, most urgent first. */
export function liveLeftovers(leftovers: readonly Leftover[]): Leftover[] {
  return sortLeftovers(leftovers.filter(isLiveLeftover));
}

/** Closed out, most recently closed first. */
export function finishedLeftovers(leftovers: readonly Leftover[]): Leftover[] {
  return leftovers
    .filter(l => !isLiveLeftover(l))
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
}

/** The live ones the nudge counts. */
export function attentionLeftovers(
  leftovers: readonly Leftover[],
  now: Date = new Date()
): Leftover[] {
  return liveLeftovers(leftovers).filter(l => needsAttention(l, now));
}

/**
 * The containers `SuggestMealsSheet` may offer for a night with no dinner on
 * it — live ones, most urgent first, minus any the week already points at.
 *
 * The sheet used to answer "what could I make this week" purely out of the
 * recipe box and the grocery catalog, so a fridge holding two containers and a
 * week holding four empty nights got four proposals to *cook* and no mention
 * of the two dinners that already existed. A container is the cheapest meal in
 * the house and the only one with a clock on it, which is why it leads the
 * sheet rather than sitting among the ranked recipes.
 *
 * **Not the same question `attentionLeftovers` asks.** That one drives a nudge,
 * so it fires only for what's nearly out of time. This one is filling a night,
 * and a stew with three days left is a perfectly good Tuesday — the urgency
 * decides the *order* here (`sortLeftovers`, which also files the frozen ones
 * last), never whether a container is offered at all.
 *
 * **`plannedLeftoverIds` is what the week already spoke for.** Pointing a meal
 * at a container isn't eating all of it (see `Leftover.finishedAt`), so a big
 * pot genuinely can cover two nights — but that's a decision to make in front
 * of the fridge card, which is where planning a container onto a specific night
 * lives. A list of proposals offering the same chilli for Tuesday *and*
 * Thursday, in a sheet that assigns days by itself, is just a double-booking
 * with extra steps.
 *
 * Capped for the reason `suggestRecipesForEmptyNight` is: this is a shelf to
 * read, not the fridge in full, and the whole fridge is one tap away on the
 * card behind the sheet.
 */
export function suggestableLeftovers(
  leftovers: readonly Leftover[],
  plannedLeftoverIds: readonly string[] = [],
  limit: number = 5
): Leftover[] {
  const planned = new Set(plannedLeftoverIds);
  return liveLeftovers(leftovers)
    .filter(l => !planned.has(l.id))
    .slice(0, limit);
}

/**
 * Reading order for the fridge: soonest keep-until first, then the one that has
 * been in there longest, then by title.
 *
 * Sorting by *urgency* rather than by when it was put away is the point of the
 * list — the thing about to go off has to be at the top even if it was cooked
 * this morning (a fish pie kept two days beats a stew kept a week). `storedAt`
 * breaks the tie because between two containers due the same day, the older one
 * is the one to eat. Title last so the order is stable rather than depending on
 * insertion.
 */
export function sortLeftovers(leftovers: readonly Leftover[]): Leftover[] {
  return [...leftovers].sort(
    (a, b) =>
      // Frozen last, whatever day is sitting on it — the same rule
      // compareKitchenEntries applies to a catalog row with no date, and for
      // the same reason: a container frozen in July carries a `keepUntil` from
      // July, so sorting it by that day would put the one thing in no danger at
      // all right at the top of a list ordered by danger.
      (a.frozenAt ? 1 : 0) - (b.frozenAt ? 1 : 0) ||
      a.keepUntil.localeCompare(b.keepUntil) ||
      a.storedAt.localeCompare(b.storedAt) ||
      a.title.localeCompare(b.title)
  );
}

/** "In the fridge today", "1 day in the fridge", "6 days in the fridge". */
export function describeAge(leftover: Leftover, now: Date = new Date()): string {
  const days = daysInFridge(leftover, now);
  if (days === 0) return 'In the fridge today';
  return `${days} ${days === 1 ? 'day' : 'days'} in the fridge`;
}

/**
 * The keep-until half of a row's caption: "Use by today", "Use by tomorrow",
 * "3 days left", "2 days past".
 *
 * The wording (and the reason it doesn't reuse dateUtils' deadline family) now
 * lives in `freshness.describeUseBy`, which a perishable in the catalog reads
 * through too — this is the fridge's name for the same question. See #1670.
 */
export function describeKeepUntil(leftover: Leftover, now: Date = new Date()): string {
  return describeUseBy(leftover.keepUntil, now);
}

/**
 * The full caption under a leftover's title — "2 days in the fridge · Use by
 * today", or "Frozen 12 Jul" for a frozen one.
 *
 * A frozen container drops the age half rather than reading "9 days in the
 * fridge · Frozen 12 Jul", which names two places for one container and counts
 * the days in the wrong one: `describeAge` measures from `storedAt`, and a
 * portion frozen on day two spent one of those nine days in the fridge. The
 * freeze date is the fact worth the line.
 *
 * It also drops the "in the freezer" half a kitchen row carries
 * (`FROZEN_REASON`), because this caption's readers are the fridge card and the
 * meal-plan picker, where the surrounding context has already said which
 * container this is. The kitchen list, which mixes frozen rows in among aisles,
 * needs both halves and pairs them itself.
 */
export function describeLeftover(leftover: Leftover, now: Date = new Date()): string {
  if (leftover.frozenAt) return describeFrozenSince(leftover.frozenAt, now);
  return `${describeAge(leftover, now)} · ${describeKeepUntil(leftover, now)}`;
}

/**
 * What a closed-out row says instead: "Eaten" / "Thrown out".
 *
 * "Thrown out" rather than "Wasted" on purpose. The app is not in a position to
 * grade the user's week, and a history list that editorialises is one people
 * stop opening.
 */
export function describeOutcome(leftover: Leftover): string {
  if (!leftover.finishedAt) return '';
  return leftover.outcome === 'tossed' ? 'Thrown out' : 'Eaten';
}

/**
 * How the closed-out rows split, for the history's summary line.
 *
 * Counted rather than derived at the call site so the two numbers can't drift
 * apart — a row is exactly one of these, and a `finishedAt` with no `outcome`
 * (a restored backup from before outcomes existed) counts as eaten, matching
 * describeOutcome's own fallback rather than inventing a third bucket.
 */
export function outcomeCounts(
  leftovers: readonly Leftover[]
): { eaten: number; tossed: number } {
  let eaten = 0;
  let tossed = 0;
  for (const leftover of leftovers) {
    if (!leftover.finishedAt) continue;
    if (leftover.outcome === 'tossed') tossed += 1;
    else eaten += 1;
  }
  return { eaten, tossed };
}

/**
 * The history's summary — "8 eaten · 1 thrown out", or just "8 eaten" when
 * nothing was binned.
 *
 * **Counts, never a score.** No percentage, no "you wasted 11%", no
 * encouragement — the same call describeOutcome makes in choosing "Thrown out"
 * over "Wasted", and for the same reason: a list that grades the user's week is
 * one they stop opening, and this one is trying to be worth opening. A number
 * they can read either way is the most this should say.
 *
 * Empty for a fridge with no history at all, so the caller renders no line
 * rather than "0 eaten".
 */
export function describeFridgeHistory(leftovers: readonly Leftover[]): string {
  const { eaten, tossed } = outcomeCounts(leftovers);
  if (eaten === 0 && tossed === 0) return '';
  const parts: string[] = [];
  if (eaten > 0) parts.push(`${eaten} eaten`);
  if (tossed > 0) parts.push(`${tossed} thrown out`);
  return parts.join(' · ');
}

/**
 * When a container was closed out — "today", "yesterday", "on Tuesday",
 * "on 3 Aug".
 *
 * Same ladder describeAddedToList uses, and forked from dateUtils for the same
 * reason it is: `finishedAt` is a stamp about something that already happened,
 * so a weekday name stays right all the way back through the week, where the
 * task-facing formatters switch to "Nd ago" after one day. Beyond a week it
 * falls to a date, and the year appears only when it isn't this one — a
 * 60-day retention window can straddle a new year.
 */
export function describeFinishedWhen(
  leftover: Leftover,
  now: Date = new Date(),
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0
): string {
  if (!leftover.finishedAt) return '';
  const at = new Date(leftover.finishedAt);
  if (isSameDay(at, now)) return 'today';
  if (isSameDay(at, subDays(now, 1))) return 'yesterday';
  if (isSameWeek(at, now, { weekStartsOn })) return `on ${format(at, 'EEEE')}`;
  return `on ${format(at, at.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy')}`;
}

/**
 * The one-line summary for the fridge card's header — "3 in the fridge · 1 to
 * use up", or just "3 in the fridge" when nothing is close.
 */
export function describeFridge(
  leftovers: readonly Leftover[],
  now: Date = new Date()
): string {
  const live = leftovers.filter(isLiveLeftover);
  if (live.length === 0) return 'Nothing in the fridge';
  const urgent = live.filter(l => needsAttention(l, now)).length;
  const base = `${live.length} in the fridge`;
  return urgent > 0 ? `${base} · ${urgent} to use up` : base;
}

/**
 * What a leftover reads as when it's the plan for a meal — just its own title,
 * verbatim.
 *
 * Used to read "Leftover chilli (2 days old)" — dropped (#1731): a meal you're
 * looking forward to eating doesn't need to be told how old it is on the plan
 * itself, and the fridge card (describeLeftover) is already where that's
 * answered. Kept as its own named function rather than inlined at each call
 * site: a leftover entry's title is a snapshot captured at plan time, not
 * resolved live off the leftover row the way a recipe-based entry's name is
 * (see titleForEntry) — this is the one place that snapshot is taken.
 */
export function mealTitleForLeftover(leftover: Leftover): string {
  return leftover.title;
}

/**
 * Whether putting this container on `dayKey` lands it after the day it should
 * have been eaten by.
 *
 * A plain day-key comparison, which is all it can be: both sides are
 * `YYYY-MM-DD` local day keys (see MealPlanEntry.date and Leftover.keepUntil),
 * so they sort lexically, and no clock is read at all — the question is about
 * two dates the user picked, not about now.
 *
 * **It informs, it never refuses.** Planning the chilli for Saturday when it's
 * marked for Wednesday is a fair thing to want — it may be going in the
 * freezer, or the keep-for was a guess — so this only ever changes what a drop
 * *says* it will do (see LeftoverDragCard). Refusing it, or raising a confirm,
 * would put a dialog between the fridge and the week for the one gesture that
 * exists to remove the steps between them.
 */
export function isPlannedPastKeepUntil(leftover: Leftover, dayKey: string): boolean {
  // A frozen container is never "past" anything: its day is suspended, and the
  // freezer is the very thing this function's note used to hand-wave at as the
  // reason not to refuse the drop. Now that the app can be told, a frozen
  // portion planned for Saturday is simply planned for Saturday.
  const keepUntil = liveKeepUntil(leftover);
  return keepUntil !== null && dayKey > keepUntil;
}

/**
 * The instant before which a *closed-out* leftover is old enough to purge.
 *
 * An instant rather than a day key because `finishedAt` is one — the closing
 * action is a moment, unlike `keepUntil`, which is a day someone plans around.
 */
export function leftoverPurgeCutoff(
  now: Date = new Date(),
  days: number = LEFTOVER_RETENTION_DAYS
): string {
  return subDays(now, days).toISOString();
}
