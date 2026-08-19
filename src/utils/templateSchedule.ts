import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { getDaysInMonth } from 'date-fns/getDaysInMonth';
import { startOfDay } from 'date-fns/startOfDay';
import type { TaskTemplate, TemplateSchedule } from '../types';
import type { WeekStart } from '../store/useSettingsStore';
import { buildWeekDays } from './calendarGrid';
import { dayKeyOf, getDayStart } from './dateUtils';
import type { TemplateAnchors } from './templateUtils';

/**
 * When a template applies itself, with nobody present (#1781).
 *
 * A pure decision lives here and the store performs the write — the same split
 * `dueMealPlanNudge`/`checkMealPlanNudge` and `dripCandidate`/
 * `dripStalledProjects` already use, and for the same reason: everything worth
 * arguing about is a date comparison, and a date comparison is only testable
 * if `now` is a parameter.
 *
 * **This writes straight to Today rather than proposing.** That's the opposite
 * call to `deloadPlan`/`projectPull`, and the difference is who chose. Those
 * two propose because the *app* is picking which task to surface, so there is a
 * guess for the user to confirm. Here there is no guess: the user authored the
 * template, authored the schedule, and every question already has a defined
 * answer (`resolveAnswers` with nothing typed). Confirming eight tasks every
 * Sunday is just applying the template by hand with extra steps, which is the
 * thing this exists to stop doing. Same shape as the standing-swap exception to
 * "a substitute never buys": the mandate is the user having said so outright.
 *
 * **A schedule is a threshold, not an alarm.** There is no backend and nothing
 * runs while the app is closed, so a run fires on the first launch at or after
 * its trigger instant — Tuesday, if Sunday's schedule went unopened until then.
 * The copy on the schedule row says so; a UI implying 09:00 sharp would be
 * describing a capability the platform doesn't give this app.
 *
 * **A missed period is never backfilled.** Three weeks away with a weekly
 * template fires once, for the current week, not three times — the rule
 * `mealPlanNudgeLastFiredWeekKey` already establishes. The key is a calendar
 * *period* rather than a timestamp precisely so that "have we done this week"
 * is a string comparison, and stays right across a schedule edited mid-period.
 *
 * **What it deliberately does not do is block on an untouched previous run.**
 * The nudge does (`partitionMealPlanNudgeTasks`), because a nudge nobody acted
 * on is evidence the nudge wasn't wanted. A schedule isn't: last Sunday's
 * laundry going undone doesn't make this Sunday's laundry not due, and a
 * template that silently stopped firing because one run was ignored is the
 * worse failure of the two. The cost is real — ignore a weekly run for a month
 * and there are four runs' worth of tasks — and what pays it is the container:
 * every run is named with its own date (see `scheduledRunName`), so the piles
 * are told apart and thrown away a stack at a time rather than a row at a time.
 */
export interface TemplateRunDue {
  /** The calendar period this run is for — what gets written to `scheduleLastFiredKey`. */
  periodKey: string;
  /** What the run's date offsets and `fromDates` questions hang off. */
  anchors: TemplateAnchors;
  /** Names the run, and so the stack or project it lands in. */
  runName: string;
}

export const DEFAULT_TEMPLATE_SCHEDULE_TIME = '09:00';

/** A schedule as it starts out when the user first switches one on: weekly, Sunday morning. */
export function defaultTemplateSchedule(): TemplateSchedule {
  return {
    frequency: 'weekly',
    weekday: 0,
    monthDay: 1,
    month: 1,
    time: DEFAULT_TEMPLATE_SCHEDULE_TIME,
    anchorSpanDays: null,
  };
}

/**
 * The calendar period a logical day falls in, under a given frequency.
 *
 * A week is keyed by its own first day rather than by an ISO week number, so it
 * follows the user's `weekStartsOn` — a Monday-start user and a Sunday-start
 * user disagree about which week Sunday the 23rd is in, and the key has to
 * agree with the trigger day it's paired with or a schedule fires twice at the
 * weekend boundary.
 */
export function periodKeyFor(
  frequency: TemplateSchedule['frequency'],
  day: Date,
  weekStartsOn: WeekStart,
): string {
  if (frequency === 'weekly') return dayKeyOf(buildWeekDays(day, weekStartsOn)[0]);
  if (frequency === 'monthly') return format(day, 'yyyy-MM');
  return format(day, 'yyyy');
}

/**
 * The calendar day inside `day`'s period on which the schedule fires.
 *
 * `monthDay` is clamped to the length of the month it lands in, so a schedule
 * set to the 31st fires on the 30th in November and the 28th in February. The
 * alternative — skipping months that are too short — makes "monthly" mean
 * "ten times a year" for four of the thirty-one possible answers, silently.
 */
export function triggerDayFor(
  schedule: TemplateSchedule,
  day: Date,
  weekStartsOn: WeekStart,
): Date {
  if (schedule.frequency === 'weekly') {
    const week = buildWeekDays(day, weekStartsOn);
    return week.find(d => d.getDay() === schedule.weekday) ?? week[0];
  }
  const month = schedule.frequency === 'yearly'
    ? clamp(schedule.month, 1, 12) - 1
    : day.getMonth();
  const inMonth = new Date(day.getFullYear(), month, 1);
  return new Date(
    day.getFullYear(),
    month,
    clamp(schedule.monthDay, 1, getDaysInMonth(inMonth)),
  );
}

/**
 * What a scheduled run is called — and so what its stack or project is called.
 *
 * Dated, deliberately. A weekly template whose every run is named "Sunday
 * reset" leaves the Projects screen (and the Stacks screen) holding a column of
 * rows that can only be told apart by opening them. Derived rather than a
 * stored format string: a second field to keep in step with the template's own
 * name, for a string nobody would write differently.
 */
export function scheduledRunName(templateName: string, day: Date): string {
  const name = templateName.trim();
  return name ? `${name} · ${format(day, 'd MMM')}` : format(day, 'd MMM');
}

/**
 * Whether this template owes a run right now, and what that run's dates are.
 *
 * `now` and `dayResetTime` are both parameters: this decides where tasks land,
 * so it is exactly the kind of computation CLAUDE.md requires to be
 * reset-time-aware. At 1:30am with a 02:00 reset the run belongs to — and is
 * dated to — the previous logical day, not the calendar one.
 */
export function dueTemplateRun(
  template: Pick<TaskTemplate, 'name' | 'schedule' | 'scheduleLastFiredKey'>,
  now: Date,
  weekStartsOn: WeekStart,
  dayResetTime: string,
): TemplateRunDue | null {
  const schedule = template.schedule;
  if (!schedule) return null;

  const today = startOfDay(getDayStart(now, dayResetTime));
  const periodKey = periodKeyFor(schedule.frequency, today, weekStartsOn);
  if (periodKey === template.scheduleLastFiredKey) return null;

  const triggerDay = triggerDayFor(schedule, today, weekStartsOn);
  const [hh, mm] = schedule.time.split(':').map(Number);
  const triggerInstant = new Date(triggerDay);
  triggerInstant.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (now.getTime() < triggerInstant.getTime()) return null;

  // Anchored on the logical day the run is *for*, not on the trigger day it
  // was owed on. Opening the app on Wednesday for a schedule that came due on
  // Sunday should date the work to Wednesday — the run is happening now, and
  // items offset "+1 day" from a Sunday that has passed would arrive overdue.
  const span = schedule.anchorSpanDays;
  const anchors: TemplateAnchors = {
    start: today,
    end: span !== null && span > 0 ? addDays(today, span) : null,
  };

  return { periodKey, anchors, runName: scheduledRunName(template.name, today) };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "1st", "2nd", "23rd" — for naming a day of the month in a sentence. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

/**
 * The schedule as one line — the editor's collapsed summary.
 *
 * Kept short on purpose: this renders through `disclosureValue`, which is
 * `numberOfLines={1}`, so at 390pt anything past roughly 27 characters
 * truncates mid-word. "Every Sunday from 9:00 AM" is the sentence you'd write
 * and it doesn't fit, which is what the field's own hint is for — the summary
 * says which day and what time, and the hint carries the "next time you open
 * the app" part rather than every summary repeating it.
 *
 * States the mechanism plainly, in the app's own voice, and never implies the
 * app is awake to do it.
 */
export function describeTemplateSchedule(
  schedule: TemplateSchedule | null,
  use24Hour = false,
): string {
  if (!schedule) return 'Never';
  const at = formatClock(schedule.time, use24Hour);
  if (schedule.frequency === 'weekly') {
    return `${WEEKDAY_NAMES[clamp(schedule.weekday, 0, 6)]}s · ${at}`;
  }
  if (schedule.frequency === 'monthly') {
    return `${ordinal(clamp(schedule.monthDay, 1, 31))} each month · ${at}`;
  }
  const month = SHORT_MONTH_NAMES[clamp(schedule.month, 1, 12) - 1];
  return `${month} ${clamp(schedule.monthDay, 1, 31)} each year · ${at}`;
}

function formatClock(time: string, use24Hour: boolean): string {
  const [hh, mm] = time.split(':').map(Number);
  const hours = Number.isFinite(hh) ? hh : 0;
  const minutes = Number.isFinite(mm) ? mm : 0;
  const padded = String(minutes).padStart(2, '0');
  if (use24Hour) return `${String(hours).padStart(2, '0')}:${padded}`;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${padded} ${suffix}`;
}
