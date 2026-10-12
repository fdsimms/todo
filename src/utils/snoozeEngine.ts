import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { isSameDay } from 'date-fns/isSameDay';
import { isThisWeek } from 'date-fns/isThisWeek';
import { format } from 'date-fns/format';
import type { Task } from '../types';
import { dayKeyOf, getDayStart, getNextDueDate, getTaskDayStart, getWeekStart } from './dateUtils';
import { projectOccurrences } from './calendarMonth';
import { estimatedMinutesFor } from './effort';
import { type BusyEvent, busyMinutesIn, hasWholeDayBlockIn } from './calendarBusy';
import { isAwayDay, type AwaySpan } from './awayDates';
import { FULL_DAY_MINUTES } from './dayLoad';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';

// Effort in "S-task" units (1 unit = the canonical 30min "S" bucket), derived
// from a precise time estimate when the task has one, else its coarse effort
// bucket, else a modest default so unestimated tasks still count toward load.
function effortUnits(t: Task): number {
  return (estimatedMinutesFor(t) ?? 30) / 30;
}

// What the scorer reads off a task, derived once per task object instead of once
// per candidate day per call. `computeSnoozeSuggestion` is called per task by the
// deload plan, over the same array with one row swapped each time, so rows that
// keep their identity keep their entry; tasks are replaced rather than mutated
// everywhere in the app, which is what makes identity a safe key. Keyed on the
// reset time as well since every field here depends on it.
interface TaskDayFacts {
  reset: string;
  due: string | null;
  defer: string | null;
  completedDow: number | null;
}
const dayFactsCache = new WeakMap<Task, TaskDayFacts>();

// The stored due/defer day keys go through getTaskDayStart, not getDayStart: a
// stored date is the calendar day it names, and getDayStart's grace-window
// rollback would file one stored at midnight (quick add's Today/Tomorrow) under
// the day before whenever the reset isn't 00:00, shifting every day's load one
// day early.
function dayFactsOf(t: Task, reset: string): TaskDayFacts {
  const hit = dayFactsCache.get(t);
  if (hit && hit.reset === reset) return hit;
  const facts: TaskDayFacts = {
    reset,
    due: t.dueDate != null ? dayKeyOf(getTaskDayStart(new Date(t.dueDate), reset)) : null,
    defer: t.deferUntil != null ? dayKeyOf(getTaskDayStart(new Date(t.deferUntil), reset)) : null,
    completedDow: t.completedAt != null ? getDayStart(new Date(t.completedAt), reset).getDay() : null,
  };
  dayFactsCache.set(t, facts);
  return facts;
}

// A recurring task's projected day keys over a window, cached the same way. The
// signature carries everything the walk read besides the task itself.
const projectionCache = new WeakMap<Task, { sig: string; days: string[] }>();

export interface SnoozeSuggestion {
  date: Date;
  dayLabel: string;
  reason: string;
  score: number;
}

function labelForDate(d: Date, dayResetTime: string): string {
  const today = getDayStart(new Date(), dayResetTime);
  const diff = differenceInCalendarDays(d, today);
  if (diff === 1) return 'Tomorrow';
  if (isThisWeek(d, { weekStartsOn: getWeekStart() })) return format(d, 'EEEE');
  return format(d, 'EEE, MMM d');
}

/** How many days out the search looks when nothing constrains it. */
const DEFAULT_HORIZON_DAYS = 7;

/**
 * How far a task may be pushed before it runs into its own schedule.
 *
 * A daily task moved a week out hasn't been rescheduled, it's been skipped six
 * times over — so a recurring task's candidate window stops at its own next
 * occurrence. Weekly and rarer recurrences reach the default horizon anyway, so
 * this only ever tightens the near-cadence cases. Returns null when nothing
 * constrains the window (one-off tasks, and a recurrence that has run out).
 */
function recurrenceHorizonDays(task: Task, dayResetTime: string): number | null {
  if (task.recurrenceType === 'none') return null;
  const next = getNextDueDate(task, dayResetTime);
  if (!next) return null;
  const days = differenceInCalendarDays(next, getDayStart(new Date(), dayResetTime));
  // An overdue recurring task can compute a next occurrence that's already
  // past; every candidate is at least tomorrow, so floor it there.
  return Math.min(Math.max(days, 1), DEFAULT_HORIZON_DAYS);
}

/**
 * What a day inside a project's away span costs a candidate.
 *
 * Large enough to put every away day behind every day that isn't, and finite
 * on purpose: the span ranks, it never gates (docs/arch/away-dates.md). When
 * every candidate is away the best of them still wins, and a suggestion is a
 * default the user can pick past anyway. Below the category schedule's 1000,
 * which is a rule about the task rather than about the day.
 */
export const AWAY_PENALTY = 100;

export function computeSnoozeSuggestion(
  task: Task,
  allTasks: Task[],
  // Calendar events, for weighing a day's meetings alongside its tasks.
  // Defaults to none — the caller is the one that knows whether calendar read
  // is on and the window loaded (TaskEditor's reminder nudge follows the same
  // gate-at-the-call-site shape), so an omitted array reproduces exactly
  // today's task-only scoring rather than this engine re-deciding permission
  // state itself.
  busyEvents: readonly BusyEvent[] = [],
  // Project away spans, to rank days you're away last (see AWAY_PENALTY).
  // Passed by the caller for the same reason the events are.
  awaySpans: readonly AwaySpan[] = [],
): SnoozeSuggestion {
  const dayResetTime = useSettingsStore.getState().dayResetTime;
  const today = getDayStart(new Date(), dayResetTime);

  const completed = allTasks.filter(t => !t.parentId && t.completed && t.completedAt != null);
  const pending = allTasks.filter(t => !t.parentId && !t.completed && t.id !== task.id);

  const horizon = recurrenceHorizonDays(task, dayResetTime);
  const candidates = Array.from({ length: horizon ?? DEFAULT_HORIZON_DAYS }, (_, i) => {
    const d = addDays(today, i + 1);
    d.setHours(12, 0, 0, 0);
    return d;
  });

  const windowEnd = candidates[candidates.length - 1];

  // Category schedule — only constrain the candidate window when at least one
  // of the 7 candidates actually falls on a day the category is scheduled for;
  // otherwise the restriction would rule out every option, which is worse than
  // ignoring it.
  const categoryScheduleDays = task.category
    ? useCategoryStore.getState().getCategoryByName(task.category)?.scheduleDays ?? null
    : null;
  const activeScheduleDays = categoryScheduleDays && categoryScheduleDays.length > 0
    && candidates.some(d => categoryScheduleDays.includes(d.getDay()))
    ? categoryScheduleDays
    : null;

  // Pre-compute projected recurring occurrences for all pending recurring tasks.
  // Maps ISO date string → { count, effort } from recurrence projections.
  //
  // Shares the month grid's walk rather than keeping its own. The private copy
  // this replaced had none of `canProject`'s refusals, so a
  // recurrenceFromCompletion task — whose next date getNextDueDate answers from
  // *today*, never advancing as the cursor moves — folded the same day into the
  // set thirty times over and projected a schedule the app doesn't promise. The
  // stored row is excluded by the walk itself, which is what this wants: it's
  // already counted in `pending`.
  //
  // `canProject` refuses a `recurrenceFromCompletion` task outright — rightly,
  // for a calendar cell that promises a date the app can't actually predict.
  // This is only a load estimate, not a promise, so it's worth the assumption
  // `canProject`'s own doc comment says the app can't make: project it as if it
  // *will* be completed on schedule, by walking the grid with the flag cleared
  // so `getNextDueDate` anchors to the due date like a fixed schedule instead of
  // to today. Wrong the moment the user actually runs late, but silently
  // dropping every one of these tasks from every day's load is a worse guess
  // than a schedule that assumes they land on time.
  const recurringByDay = new Map<string, { count: number; effort: number }>();
  const projectionSig = `${today.getTime()}|${windowEnd.getTime()}|${dayResetTime}`;
  for (const t of pending) {
    if (t.recurrenceType === 'none') continue;
    let cached = projectionCache.get(t);
    if (!cached || cached.sig !== projectionSig) {
      const projectable = t.recurrenceFromCompletion ? { ...t, recurrenceFromCompletion: false } : t;
      cached = {
        sig: projectionSig,
        days: projectOccurrences(projectable, today, windowEnd, dayResetTime).map(date => dayKeyOf(date)),
      };
      projectionCache.set(t, cached);
    }
    for (const dateStr of cached.days) {
      const existing = recurringByDay.get(dateStr) ?? { count: 0, effort: 0 };
      recurringByDay.set(dateStr, {
        count: existing.count + 1,
        effort: existing.effort + effortUnits(t),
      });
    }
  }

  // Explicit load per candidate day, in one pass over the pending tasks rather
  // than one per day. A task whose due date and defer both land on a day counts
  // once, as the filter it replaces did.
  const candidateKeys = new Set(candidates.map(d => dayKeyOf(getTaskDayStart(d, dayResetTime))));
  const explicitByDay = new Map<string, { count: number; effort: number }>();
  for (const t of pending) {
    const f = dayFactsOf(t, dayResetTime);
    const keys = [f.due, f.defer];
    for (let i = 0; i < 2; i++) {
      const k = keys[i];
      if (k == null || !candidateKeys.has(k) || (i === 1 && k === f.due)) continue;
      const e = explicitByDay.get(k) ?? { count: 0, effort: 0 };
      e.count += 1;
      e.effort += effortUnits(t);
      explicitByDay.set(k, e);
    }
  }

  interface Scored {
    date: Date;
    score: number;
    loadCount: number;
    tagRate: number;
    dowRate: number;
  }

  const scored: Scored[] = candidates.map(d => {
    const dow = d.getDay();
    const dOut = differenceInCalendarDays(d, today);
    const dayKey = dayKeyOf(d);

    // Signal 1: load — tasks with an explicit dueDate/deferUntil on this day,
    // plus projected occurrences of recurring tasks that will land here.
    const recurringDay = recurringByDay.get(dayKey) ?? { count: 0, effort: 0 };
    const explicit = explicitByDay.get(dayKeyOf(getTaskDayStart(d, dayResetTime))) ?? { count: 0, effort: 0 };
    const explicitLoad = explicit.count;
    const loadCount = explicitLoad + recurringDay.count;
    const loadPenalty = loadCount * 2.0;

    // Signal 2: tag-day affinity — historical completion rate on this DOW for matching tags
    const matchingTagCompleted = task.tags.length > 0
      ? completed.filter(t => t.tags.some(tag => task.tags.includes(tag)))
      : [];
    const tagOnDow = matchingTagCompleted.filter(
      t => dayFactsOf(t, dayResetTime).completedDow === dow
    ).length;
    const tagRate = matchingTagCompleted.length > 0
      ? tagOnDow / matchingTagCompleted.length
      : 0;
    const tagBonus = -(tagRate * 3.0);

    // Signal 3: global DOW completion rate
    const globalDowCompleted = completed.filter(
      t => dayFactsOf(t, dayResetTime).completedDow === dow
    ).length;
    const dowRate = completed.length > 0
      ? globalDowCompleted / completed.length
      : 1 / 7;
    const dowBonus = -(dowRate * 2.0);

    // Signal 4: effort already on this day (explicit + projected recurring +
    // calendar meetings, all in the same S-task-unit scale — a day with two
    // tasks and six hours of meetings should score exactly as loaded as a day
    // with twelve tasks, not as a light one because only tasks were counted).
    const explicitEffort = explicit.effort;
    const dayStart = getDayStart(d, dayResetTime);
    // An all-day event left busy (a conference, "out of office") is the user
    // saying the day is taken, so it weighs as a full day of meetings would,
    // the same reading dayLoad's cue gives it. A free one (the default for a
    // birthday or a holiday) still weighs nothing.
    const busyMinutes = busyEvents.length > 0
      ? Math.max(
          busyMinutesIn(busyEvents, dayStart, addDays(dayStart, 1)),
          hasWholeDayBlockIn(busyEvents, dayStart, addDays(dayStart, 1)) ? FULL_DAY_MINUTES : 0,
        )
      : 0;
    const effortOnDay = explicitEffort + recurringDay.effort + busyMinutes / 30;
    const effortPenalty = effortOnDay * 0.5;

    // Signal 5: recency — slight bias toward sooner dates
    const recencyPenalty = dOut * 0.3;

    // Signal 6: priority urgency — high-priority tasks shouldn't drift far
    const priorityPenalty =
      task.priority === 4 ? dOut * 1.5
      : task.priority === 3 ? dOut * 0.7
      : 0;

    // Signal 7: category schedule — rule out days the task's category isn't
    // scheduled for, when the constraint leaves at least one day standing.
    const categoryPenalty = activeScheduleDays && !activeScheduleDays.includes(dow) ? 1000 : 0;

    // Signal 8: away — rank a day inside a trip below every day that isn't.
    const awayPenalty = awaySpans.some(span => isAwayDay(span, d, dayResetTime)) ? AWAY_PENALTY : 0;

    const score = loadPenalty + tagBonus + dowBonus + effortPenalty + recencyPenalty + priorityPenalty + categoryPenalty + awayPenalty;
    return { date: d, score, loadCount, tagRate, dowRate };
  });

  const winner = scored.reduce((best, c) => c.score < best.score ? c : best);

  // Build a short reason string from the dominant signal
  const maxLoad = Math.max(...scored.map(s => s.loadCount));
  const maxDowRate = Math.max(...scored.map(s => s.dowRate));
  const parts: string[] = [];

  if (winner.loadCount <= 1) {
    parts.push('light day');
  } else if (winner.loadCount < maxLoad) {
    // Only call out load when the winner is genuinely lighter than other options
    parts.push('fewest tasks');
  }

  if (winner.tagRate > 0.2 && task.tags.length > 0) {
    parts.push(`good for “${task.tags[0]}”`);
  } else if (winner.dowRate >= maxDowRate && winner.dowRate > 0.17) {
    parts.push('your productive day');
  }

  // When the recurrence is what stopped the search and the winner sits on the
  // last day left, that constraint is the real answer — "light day" would be
  // claiming a choice the task never had.
  const cappedByRecurrence = horizon !== null && horizon < DEFAULT_HORIZON_DAYS;
  const reason =
    cappedByRecurrence && isSameDay(winner.date, windowEnd)
      ? 'when it next repeats'
      : parts.length > 0 ? parts.slice(0, 2).join(' · ') : 'balanced schedule';

  return {
    date: winner.date,
    dayLabel: labelForDate(winner.date, dayResetTime),
    reason,
    score: winner.score,
  };
}
