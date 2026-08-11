import { addDays } from 'date-fns/addDays';
import type { MealPlanEntry } from '../types';
import type { WeekStart } from '../store/useSettingsStore';
import { buildWeekDays } from './calendarGrid';
import { dayKeyOf } from './dateUtils';
import { describeWeekRange, isKeyInRange } from './mealPlan';

/**
 * The opt-in "plan meals for the week" nudge (#1121) — a real Task, created
 * unattended once a week, the same shape as the project auto-schedule drip
 * (`dripCandidate`/`dripStalledProjects`, `src/utils/projectPull.ts`): a pure
 * decision lives here, the store performs the write. Off by default — an
 * existing install sees no new task until the user opts in from Settings,
 * same reasoning as `completedRetentionDays`.
 *
 * Deliberately a Task, not a banner. `ProjectNudgeBanner` works because it
 * rides `findProjectStalls`, which already runs on every Today render for the
 * accent-tint surfaces — there's no equivalent standing computation for "is
 * the coming week planned", and Today doesn't otherwise know or care about
 * the meal plan. A Task costs nothing extra to surface: it shows up wherever
 * a task already would (Today, widget, reminder), it's dismissible the same
 * way any task is, and CLAUDE.md's own caution about this — a task nobody
 * asked for is a stronger intrusion than a banner — is exactly why the
 * setting defaults off and the whole feature is opt-in rather than a banner
 * substituting for consent.
 *
 * Fires **at most once per week** (`lastFiredWeekKey`, persisted in Settings)
 * and only when the week it's about to nudge for has nothing planned yet
 * (`mealPlanNudgeSuppressed`) — a reminder to plan a week you already planned
 * from the Meal Plan screen directly is noise, not help.
 */

/** date-fns `Date.getDay()` convention: 0 = Sunday .. 6 = Saturday. */
export const DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY = 0;
export const DEFAULT_MEAL_PLAN_NUDGE_TIME = '09:00';

/** What a recurring "Plan meals" task carries in `linkUrl` — opens the Meal Plan screen. */
export const MEAL_PLAN_NUDGE_LINK_URL = 'dundundun://mealplan';

export interface MealPlanNudgeDue {
  /**
   * Idempotency key: the day-key of the first day of the week the trigger
   * armed in. Stored back as `mealPlanNudgeLastFiredWeekKey` the moment this
   * is returned — whether or not the caller goes on to create a task (see
   * `mealPlanNudgeSuppressed`) — so a week already planned doesn't get
   * re-checked (and re-decided the same way) on every later launch.
   */
  weekKey: string;
  /** Day-key of the first day of the week the nudge is asking about. */
  targetWeekStartKey: string;
  /** Day-key of the last day of that week, inclusive. */
  targetWeekEndKey: string;
  /** "Plan meals for 17 – 23 Aug" — reuses mealPlan.ts's own week-range wording. */
  title: string;
  /** Noon on the day the nudge fires — where the created task's `dueDate` lands. */
  dueDate: Date;
}

/**
 * Whether the nudge should fire right now, and for which week — or null when
 * either this week's trigger (`weekday`/`time`) hasn't arrived yet, or it
 * already has (`lastFiredWeekKey` matches).
 *
 * The week the nudge asks about is always the one *after* the week the
 * trigger fires in, regardless of which day of that week `weekday` names —
 * "remind me Friday evening" and "remind me Sunday morning" both mean "get
 * next week planned", not "get the last two days of this week planned".
 *
 * Doesn't know about "already planned" — see `mealPlanNudgeSuppressed`, which
 * needs a real database read this module can't make and stays free of, the
 * same split `dripCandidate` draws from `findProjectStalls`.
 */
export function dueMealPlanNudge(
  now: Date,
  weekStartsOn: WeekStart,
  weekday: number,
  time: string,
  lastFiredWeekKey: string | null
): MealPlanNudgeDue | null {
  const days = buildWeekDays(now, weekStartsOn);
  const weekKey = dayKeyOf(days[0]);
  if (weekKey === lastFiredWeekKey) return null;

  const triggerDay = days.find(d => d.getDay() === weekday) ?? days[0];
  const [hh, mm] = time.split(':').map(Number);
  const triggerInstant = new Date(triggerDay);
  triggerInstant.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (now.getTime() < triggerInstant.getTime()) return null;

  const targetDays = buildWeekDays(addDays(days[0], 7), weekStartsOn);
  const dueDate = new Date(now);
  dueDate.setHours(12, 0, 0, 0);

  return {
    weekKey,
    targetWeekStartKey: dayKeyOf(targetDays[0]),
    targetWeekEndKey: dayKeyOf(targetDays[targetDays.length - 1]),
    title: `Plan meals for ${describeWeekRange(targetDays)}`,
    dueDate,
  };
}

/**
 * True when the week the nudge is about to ask for already has at least one
 * meal planned — planned directly on the Meal Plan screen, with the nudge
 * never touched. Any entry counts, the same binary "has a date signal at
 * all" the project drip uses (`hasNoDateSignal`) rather than judging how
 * *much* of the week is filled in: this is a reminder to start, not a
 * completeness check.
 */
export function mealPlanNudgeSuppressed(
  due: Pick<MealPlanNudgeDue, 'targetWeekStartKey' | 'targetWeekEndKey'>,
  entriesInTargetWeek: readonly Pick<MealPlanEntry, 'date'>[]
): boolean {
  return entriesInTargetWeek.some(e => isKeyInRange(e.date, due.targetWeekStartKey, due.targetWeekEndKey));
}
