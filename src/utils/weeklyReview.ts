import type { Task } from '../types';
import { startOfWeek } from 'date-fns/startOfWeek';
import { dayKeyOf, getDayStart, getTaskDayStart } from './dateUtils';

/**
 * The weekly review — the pure half of walking a week's loose ends in order.
 *
 * Every input to this already existed and every one of them nudged on its own
 * schedule. Inbox and Unscheduled are sub-views of Today, `StuckScreen` holds
 * what is blocked or drifting, Later holds what slipped, `buildDayLoads` says
 * how full the week ahead is, and `weekNights` says which dinners nobody has
 * decided. What nothing did was walk them *once, in an order*, which is the
 * only moment the answers are related to each other.
 *
 * **The order is the feature, not a layout.** What is stuck decides what is
 * worth re-dating; what you re-date decides whether next week fits; whether it
 * fits decides how many nights there is room to cook. Reversed, each stage
 * would be answered against a picture the next one invalidates.
 *
 * **Which is why a caller recomputes between stages rather than snapshotting.**
 * Every input here is derived from the task store, so advancing a stage after
 * acting on it re-derives the next one for free — that is what makes the
 * ordering pay off rather than merely read well. `weeklyReviewStages` is
 * therefore cheap and meant to be called again on every change.
 *
 * Pure on purpose: it takes rows and counts and returns stages, so the
 * sequencing can be tested without a store. The store reads belong to the
 * sheet, exactly as `pantryReview.ts` leaves them to `PantryReviewSheet`.
 */

/**
 * The link a review task carries, so the row that offers to walk the week
 * opens the thing that walks it.
 *
 * Here rather than in `deepLinks.ts`, which is where its *matcher* lives:
 * that module imports `haptics` and so cannot be reached from `useTaskStore`'s
 * test environment, and the generator that writes this row is in that store.
 * The two are held together by `deepLinks.test.ts`, which asserts the matcher
 * accepts this exact string — so a drift between them fails the build rather
 * than shipping a row whose link does nothing.
 */
export const WEEKLY_REVIEW_URL = 'dundundun://review';

export type WeeklyReviewStageId = 'inbox' | 'stuck' | 'slipped' | 'week' | 'nights';

/**
 * What a stage is for, which decides whether an empty one is worth showing.
 *
 * - `clear` — a pile to get through. Nothing in it means nothing to do, so an
 *   empty one is skipped rather than shown as a card saying "none": a review
 *   that deals five empty hands is a review nobody finishes twice.
 * - `look` — a picture to take in. Zero is a real answer here and the one you
 *   most want ("the week ahead has no overloaded days"), so these always show.
 *   Skipping them would mean a review that goes quiet exactly when it has good
 *   news, and quietly stop being a *planning* pass at all.
 */
export type WeeklyReviewStageKind = 'clear' | 'look';

export interface WeeklyReviewStage {
  id: WeeklyReviewStageId;
  kind: WeeklyReviewStageKind;
  /** The card's heading. */
  title: string;
  /** One line saying what this stage is asking, in the present tense. */
  hint: string;
  /** Ionicons glyph. */
  icon: string;
  /** How many things this stage is about. Zero is meaningful for a `look`. */
  count: number;
}

/**
 * What the caller has already worked out, from the stores.
 *
 * Rows for the stages that act on rows, counts for the two that only report.
 * Handing over whole tasks for the first three is what lets a card list them;
 * handing over counts for the last two is because "three heavy days" is the
 * whole of what that stage says, and passing `DayLoad`s would drag the
 * calendar and settings stores into a module that has no need of them.
 */
export interface WeeklyReviewInput {
  /** Captured with no date and no category — the pile to file. */
  inbox: readonly Task[];
  /** Waiting on something or somebody, or drifting. */
  stuck: readonly Task[];
  /** Dated before today and still not done. */
  slipped: readonly Task[];
  /** Days in the week ahead already over their comfortable load. */
  heavyDays: number;
  /** Dinners in the week ahead nobody has decided. */
  openNights: number;
}

const STAGE_ORDER: readonly Omit<WeeklyReviewStage, 'count'>[] = [
  {
    id: 'inbox',
    kind: 'clear',
    title: 'Empty the inbox',
    icon: 'file-tray-outline',
    hint: 'Give each one a date or a category, so the rest of the review can see it.',
  },
  {
    id: 'stuck',
    kind: 'clear',
    title: 'What is stuck',
    icon: 'hourglass-outline',
    hint: 'Waiting on something or somebody. Knowing which is what decides the next step.',
  },
  {
    id: 'slipped',
    kind: 'clear',
    title: 'What slipped',
    icon: 'calendar-outline',
    hint: "Dated before today and still open. Move them to a day you'll actually do them.",
  },
  {
    id: 'week',
    kind: 'look',
    title: 'The week ahead',
    icon: 'bar-chart-outline',
    hint: 'How full the next seven days are, counting everything you just re-dated.',
  },
  {
    id: 'nights',
    kind: 'look',
    title: 'Nights to plan',
    icon: 'restaurant-outline',
    hint: 'Dinners nobody has decided yet, against the week you just looked at.',
  },
];

/**
 * The stages worth showing, in the order that makes each answer narrow the
 * next.
 *
 * `kitchenEnabled: false` drops the nights stage outright rather than showing
 * it empty — the meal plan is not a thing that happens to have nothing in it
 * for somebody who has switched the whole area off, it is a thing that does not
 * exist for them. Same rule `listedGeneratedKinds` applies to the kitchen
 * generators.
 */
export function weeklyReviewStages(
  input: WeeklyReviewInput,
  options: { kitchenEnabled?: boolean } = {},
): WeeklyReviewStage[] {
  const { kitchenEnabled = true } = options;
  const counts: Record<WeeklyReviewStageId, number> = {
    inbox: input.inbox.length,
    stuck: input.stuck.length,
    slipped: input.slipped.length,
    week: input.heavyDays,
    nights: input.openNights,
  };
  return STAGE_ORDER
    .filter(stage => (stage.id === 'nights' ? kitchenEnabled : true))
    .map(stage => ({ ...stage, count: counts[stage.id] }))
    .filter(stage => stage.kind === 'look' || stage.count > 0);
}

/** The rows a stage is about. Empty for the two that only report a count. */
export function weeklyReviewRows(
  stage: Pick<WeeklyReviewStage, 'id'>,
  input: WeeklyReviewInput,
): readonly Task[] {
  switch (stage.id) {
    case 'inbox': return input.inbox;
    case 'stuck': return input.stuck;
    case 'slipped': return input.slipped;
    case 'week': return [];
    case 'nights': return [];
  }
}

/**
 * Tasks dated before today and still open — the "slipped" pile.
 *
 * `dayResetTime`-aware throughout, because every one of these is about to be
 * re-dated and a re-dating decision taken in the early-morning grace window is
 * the off-by-one this app has a whole section of CLAUDE.md about. Anchored with
 * `getTaskDayStart` on the stored date and `getDayStart` on now, the same pair
 * `agendaCounts` uses and for the same reason: a stored date is a calendar day,
 * and the clock is not.
 *
 * Subtasks are excluded the way every top-level list excludes them, and a task
 * held back on something else is left to the `stuck` stage — it has not slipped,
 * it is waiting, and re-dating it would be answering the wrong question.
 */
export function slippedTasks(
  tasks: readonly Task[],
  heldBack: (task: Task) => boolean,
  now: Date = new Date(),
  dayResetTime?: string,
): Task[] {
  const today = getDayStart(now, dayResetTime);
  return tasks.filter(task => {
    if (task.completed || task.archived || task.parentId) return false;
    if (!task.dueDate) return false;
    if (heldBack(task)) return false;
    return getTaskDayStart(new Date(task.dueDate), dayResetTime) < today;
  });
}

/**
 * "4 filed, 2 moved" — what the pass actually changed, for the finished card.
 *
 * Counts what the person did rather than what they were shown, which is the
 * distinction `describePantryReviewDone` draws by reporting skipped and omitted
 * alongside answered. A review that reports its own length would congratulate
 * somebody for scrolling.
 */
export function describeWeeklyReviewDone(filed: number, moved: number): string {
  const parts: string[] = [];
  if (filed > 0) parts.push(`${filed} filed`);
  if (moved > 0) parts.push(`${moved} moved`);
  if (parts.length === 0) return 'Nothing changed';
  return parts.join(', ');
}

/**
 * The day key of the week `now` falls in, under the user's own week start.
 *
 * The generator's period key. `weekStartsOn` is a real setting and this is a
 * *weekly* pass, so anchoring to a hard-coded Monday would put the review
 * mid-week for anybody whose week starts on Sunday — the same mistake the
 * multi-week recurrence interval made before it learned to count from the
 * user's own week start.
 *
 * `dayResetTime`-aware through `getDayStart`, because a pass running at 01:30
 * for somebody whose day starts at 02:00 is still working yesterday's week,
 * and on the one night a year where that crosses a week boundary it would
 * otherwise offer the same review twice.
 */
export function reviewWeekKey(
  now: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
  dayResetTime?: string,
): string {
  const today = getDayStart(now, dayResetTime);
  const start = startOfWeek(today, { weekStartsOn });
  return dayKeyOf(start);
}

/**
 * Whether this week's review should be offered now.
 *
 * Two conditions and nothing else. The week key has to have moved, which is
 * what stops a review swiped away on Tuesday being dealt straight back on
 * Wednesday — the high-water mark every day-keyed generator spends before its
 * qualifying check, for the reason `weekendNudgeLastWeekendKey` exists. And
 * one of the piles has to have something in it, per
 * `weeklyReviewWorthOffering`.
 *
 * Deliberately no weekday of its own, unlike the meal plan nudge. A weekly
 * review is worth doing whenever you get to it, and a setting for which day it
 * lands on would be a knob over a question the week key already answers: once
 * per week, from the first launch of that week where there is anything to
 * review.
 */
export function wantsWeeklyReview(
  weekKey: string,
  lastWeekKey: string | null,
  input: WeeklyReviewInput,
): boolean {
  if (lastWeekKey === weekKey) return false;
  return weeklyReviewWorthOffering(input);
}

/**
 * Whether a review is worth offering at all.
 *
 * The generator's own rule, here rather than in the pass so it can be tested
 * without a store. A review that opens on nothing but two `look` stages is a
 * screen telling somebody their week is fine, which is true and is not a task
 * worth writing — so at least one pile has to have something in it.
 */
export function weeklyReviewWorthOffering(input: WeeklyReviewInput): boolean {
  return input.inbox.length > 0 || input.stuck.length > 0 || input.slipped.length > 0;
}
