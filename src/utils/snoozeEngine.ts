import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { isSameDay } from 'date-fns/isSameDay';
import { isThisWeek } from 'date-fns/isThisWeek';
import { format } from 'date-fns/format';
import type { Task } from '../types';
import { getDayStart, getNextDueDate, getWeekStart } from './dateUtils';
import { effortToMinutes } from './effort';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';

// Effort in "S-task" units (1 unit = the canonical 30min "S" bucket), derived
// from a precise time estimate when the task has one, else its coarse effort
// bucket, else a modest default so unestimated tasks still count toward load.
function effortUnits(t: Task): number {
  return (t.estimatedMinutes ?? effortToMinutes(t.effort) ?? 30) / 30;
}

// True when two dates fall on the same *logical* day under dayResetTime.
function sameLogicalDay(a: Date, b: Date, dayResetTime: string): boolean {
  return isSameDay(getDayStart(a, dayResetTime), getDayStart(b, dayResetTime));
}

export interface SnoozeSuggestion {
  date: Date;
  dayLabel: string;
  reason: string;
  score: number;
}

function labelForDate(d: Date): string {
  const today = new Date();
  const diff = differenceInCalendarDays(d, today);
  if (diff === 1) return 'Tomorrow';
  if (isThisWeek(d, { weekStartsOn: getWeekStart() })) return format(d, 'EEEE');
  return format(d, 'EEE, MMM d');
}

/**
 * Builds a Set of ISO date strings (YYYY-MM-DD) for all days within
 * the candidate window that a given recurring task is expected to land on,
 * beyond its current dueDate (which is already counted in the pending list).
 */
function projectRecurringOccurrences(t: Task, windowEnd: Date): Set<string> {
  const hits = new Set<string>();
  if (t.recurrenceType === 'none' || t.dueDate == null) return hits;

  let cursor = { ...t };
  // Walk forward through occurrences until we pass the window
  for (let i = 0; i < 30; i++) {
    const next = getNextDueDate(cursor);
    if (!next || next > windowEnd) break;
    hits.add(next.toISOString().slice(0, 10));
    cursor = { ...cursor, dueDate: next.toISOString() };
  }
  return hits;
}

export function computeSnoozeSuggestion(
  task: Task,
  allTasks: Task[],
): SnoozeSuggestion {
  const today = new Date();
  const dayResetTime = useSettingsStore.getState().dayResetTime;

  const completed = allTasks.filter(t => !t.parentId && t.completed && t.completedAt != null);
  const pending = allTasks.filter(t => !t.parentId && !t.completed && t.id !== task.id);

  const candidates = Array.from({ length: 7 }, (_, i) => {
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
  const recurringByDay = new Map<string, { count: number; effort: number }>();
  for (const t of pending) {
    if (t.recurrenceType === 'none') continue;
    for (const dateStr of projectRecurringOccurrences(t, windowEnd)) {
      const existing = recurringByDay.get(dateStr) ?? { count: 0, effort: 0 };
      recurringByDay.set(dateStr, {
        count: existing.count + 1,
        effort: existing.effort + effortUnits(t),
      });
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
    const dayKey = d.toISOString().slice(0, 10);

    // Signal 1: load — tasks with an explicit dueDate/deferUntil on this day,
    // plus projected occurrences of recurring tasks that will land here.
    const recurringDay = recurringByDay.get(dayKey) ?? { count: 0, effort: 0 };
    const explicitLoad = pending.filter(t =>
      (t.dueDate != null && sameLogicalDay(new Date(t.dueDate), d, dayResetTime)) ||
      (t.deferUntil != null && sameLogicalDay(new Date(t.deferUntil), d, dayResetTime))
    ).length;
    const loadCount = explicitLoad + recurringDay.count;
    const loadPenalty = loadCount * 2.0;

    // Signal 2: tag-day affinity — historical completion rate on this DOW for matching tags
    const matchingTagCompleted = task.tags.length > 0
      ? completed.filter(t => t.tags.some(tag => task.tags.includes(tag)))
      : [];
    const tagOnDow = matchingTagCompleted.filter(
      t => new Date(t.completedAt!).getDay() === dow
    ).length;
    const tagRate = matchingTagCompleted.length > 0
      ? tagOnDow / matchingTagCompleted.length
      : 0;
    const tagBonus = -(tagRate * 3.0);

    // Signal 3: global DOW completion rate
    const globalDowCompleted = completed.filter(
      t => new Date(t.completedAt!).getDay() === dow
    ).length;
    const dowRate = completed.length > 0
      ? globalDowCompleted / completed.length
      : 1 / 7;
    const dowBonus = -(dowRate * 2.0);

    // Signal 4: effort already on this day (explicit + projected recurring)
    const explicitEffort = pending
      .filter(t =>
        (t.dueDate != null && sameLogicalDay(new Date(t.dueDate), d, dayResetTime)) ||
        (t.deferUntil != null && sameLogicalDay(new Date(t.deferUntil), d, dayResetTime))
      )
      .reduce((sum, t) => sum + effortUnits(t), 0);
    const effortOnDay = explicitEffort + recurringDay.effort;
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

    const score = loadPenalty + tagBonus + dowBonus + effortPenalty + recencyPenalty + priorityPenalty + categoryPenalty;
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
    parts.push(`good for "${task.tags[0]}"`);
  } else if (winner.dowRate >= maxDowRate && winner.dowRate > 0.17) {
    parts.push('your productive day');
  }

  const reason = parts.length > 0 ? parts.slice(0, 2).join(' · ') : 'balanced schedule';

  return {
    date: winner.date,
    dayLabel: labelForDate(winner.date),
    reason,
    score: winner.score,
  };
}
