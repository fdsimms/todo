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
  return differenceInCalendarDays(dayKeyToDate(leftover.keepUntil), now);
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
  const left = daysLeft(leftover, now);
  if (left < 0) return 'over';
  if (left === 0) return 'due';
  if (left === 1) return 'soon';
  return 'fresh';
}

/**
 * Whether this is what the nudge is for: still in the fridge, and down to its
 * last day or already past it.
 *
 * The threshold includes 'soon' deliberately — the point is to catch it *before*
 * it's wasted, and a nudge that only fires on the day itself has already given
 * up the evening someone could have planned around it.
 */
export function needsAttention(leftover: Leftover, now: Date = new Date()): boolean {
  return isLiveLeftover(leftover) && daysLeft(leftover, now) <= 1;
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
 * Deliberately its own small ladder rather than a reuse of dateUtils'
 * formatDeadlineDate family, for the reason describeAddedToList gives for
 * forking too: those are written for a task's due date and phrase a past one as
 * overdue work. A leftover past its day isn't late, it's questionable — and the
 * wording has to leave room for the user to decide it's still fine.
 */
export function describeKeepUntil(leftover: Leftover, now: Date = new Date()): string {
  const left = daysLeft(leftover, now);
  if (left === 0) return 'Use by today';
  if (left === 1) return 'Use by tomorrow';
  if (left > 1) return `${left} days left`;
  const past = -left;
  return `${past} ${past === 1 ? 'day' : 'days'} past`;
}

/** The full caption under a leftover's title — "2 days in the fridge · Use by today". */
export function describeLeftover(leftover: Leftover, now: Date = new Date()): string {
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
 * What a leftover reads as when it's the plan for a meal — "Leftover chilli
 * (2 days old)".
 *
 * The age is baked into the captured title rather than resolved at render time,
 * which is the opposite of titleForEntry's live-recipe-name rule and deliberate:
 * a recipe's name is a fact about a document that should follow a rename, but
 * "2 days old" is a fact about *the night you planned it for*. Resolved live it
 * would keep counting up, so Tuesday's dinner would eventually claim it ate a
 * three-week-old curry.
 */
export function mealTitleForLeftover(leftover: Leftover, now: Date = new Date()): string {
  const days = daysInFridge(leftover, now);
  if (days === 0) return leftover.title;
  return `${leftover.title} (${days} ${days === 1 ? 'day' : 'days'} old)`;
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
