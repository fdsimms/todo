/**
 * What a day or a vacation ending does to quota rows, as the rows to write.
 *
 * Lifted out of `useTaskStore.rolloverQuotas` and `prorateQuotasForVacationEnd`
 * the way `vacationStreaks.ts` was lifted out of the store, and for the same
 * reason: the store imports the notification system, so the MCP server cannot
 * load it, and ending vacation there has to settle weekly targets exactly as
 * the app does. The store and the MCP replica each write what this returns;
 * the store also schedules and cancels reminders, which the phone does for
 * rows the MCP writes once they sync.
 */
import { addDays } from 'date-fns/addDays';
import type { QuotaPeriod, Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  getCurrentDayStart, getEffectiveTaskDate, getNextDueDate, getNextOccurrence, getTaskDayStart,
} from './dateUtils';
import { derivedId, spawnSeed } from './syncIds';
import { nextStreakRecord } from './streakRecord';
import { countsUnits } from './streakUnits';
import { deadlineOnto, reminderOnto as reminderOntoDay } from './taskSkip';
import {
  isCategoryScheduledDay, isHiddenForVacation, isInPausedProject, isQuotaTask, isWithheld, quotaRidesOutTheDay,
} from './visibilityUtils';
import { partWeekPatch, proratedFrom, quotaWeekStart, vacationDaysInWeek } from './quotaSchedule';
import {
  inheritedOccurrence, isRotationTask, rotationMembers, rotationPartWeekPatch, rotationPerWeek,
} from './rotation';

export interface QuotaRolloverPlan {
  /** Rows closed out, to be updated. */
  closed: Task[];
  /** Rows that replace them, to be inserted (or updated where a row with the id exists). */
  spawned: Task[];
}

/**
 * The quota rows a day (or week) going by closes, and the rows that replace
 * them. See `useTaskStore.rolloverQuotas` for when it runs.
 *
 * `endingVacation` is the vacation about to be switched off. A weekly target is
 * withheld all through it, so the pass would skip it, and the week it was left
 * in would close only after vacation mode is off, with nothing left saying how
 * much of the new week the vacation took. With it, those weekly rows are
 * settled here instead: the week left behind closes without touching the
 * streak, and the row that replaces it is scaled to the days of its week that
 * weren't vacation.
 */
export function planQuotaRollover(tasks: readonly Task[], endingVacation?: { startedAt: string }): QuotaRolloverPlan {
  const { dayResetTime, weekStartsOn } = useSettingsStore.getState();
  const todayStart = getCurrentDayStart();
  // Which period a date belongs to, as that period's opening instant. Two
  // dates compare equal exactly when they share a period, which is the test
  // this sweep is really making — "has the stretch this row was counting
  // across finished" — rather than the day comparison it used to make.
  const periodStartOf = (date: Date, period: QuotaPeriod): number => {
    const dayStart = getTaskDayStart(date, dayResetTime);
    return +(period === 'week' ? quotaWeekStart(dayStart, weekStartsOn) : dayStart);
  };
  // A weekly target that only the ending vacation is holding back: a paused
  // project still withholds it, since that pause has its own end.
  const isEndingVacationWeekly = (t: Task) =>
    !!endingVacation && t.quotaPeriod === 'week' && isHiddenForVacation(t) && !isInPausedProject(t);
  const stale = tasks.filter(t =>
    isQuotaTask(t) &&
    !t.completed &&
    !t.archived &&
    // A quota with no repeat has no next day to reset into — it's a one-off
    // ("read 8 chapters"), so it stays overdue like any other undone task
    // rather than being closed out and silently re-spawned as a habit.
    t.recurrenceType !== 'none' &&
    // Vacation-paused tasks are protected from streak loss by design.
    (!isWithheld(t) || isEndingVacationWeekly(t)) &&
    // allowOvershoot tasks get their own sweep (sweepOvershootQuotas, below)
    // that goes through completeTask so an overshot count survives — this
    // manual close always writes progressCount as-is but forces
    // streakCount to 0, which is right for a shortfall but wrong for a
    // task that actually met or beat its target.
    //
    // An interval quota is excluded for a stronger version of the same
    // reason: it has no shortfall to record. Its target is span ÷ interval,
    // so falling "short" of it means nothing more than not having tapped
    // every nudge, and closing the day with streakCount: 0 for that would
    // break the streak on essentially every day the feature works. See
    // sweepFinishedQuotaRuns, which closes it at the end of its run instead.
    !quotaRidesOutTheDay(t) &&
    t.dueDate !== null &&
    // "Its own period is over", not "its own day is over" — a weekly target
    // has six days left to run on the morning after it was spawned, and the
    // day test would close it out short every single night. See
    // Task.quotaPeriod, and periodStartOf just below for the two readings.
    //
    // getEffectiveTaskDate rather than the raw dueDate: a quota task pushed
    // out with deferUntil is hidden until that later day (isTaskVisible),
    // so its stored dueDate reads as overdue every launch in between even
    // though the user moved it forward on purpose. Without this, the row
    // got closed as a shortfall (breaking its streak) and a fresh successor
    // spawned for today — reappearing on Today despite having just been
    // rescheduled later, and duplicating it once the deferred date itself
    // arrived and rolled over a second time.
    //
    // The effective date only decides whether the row is still *ahead of*
    // today's period, though. The count on it was logged in the period its
    // dueDate belongs to, so once that period is over and the deferred day
    // has arrived in a later one, the count is last period's and closes out
    // here. Left alone, a weekly target pushed from Monday to the next
    // Sunday opened the new week still showing last week's 1/5.
    periodStartOf(new Date(t.dueDate), t.quotaPeriod) < periodStartOf(todayStart, t.quotaPeriod) &&
    periodStartOf(new Date(getEffectiveTaskDate(t, dayResetTime)!), t.quotaPeriod) <=
      periodStartOf(todayStart, t.quotaPeriod)
  );
  if (stale.length === 0) return { closed: [], spawned: [] };

  const closed: Task[] = [];
  const spawned: Task[] = [];
  const now = new Date().toISOString();
  for (const task of stale) {
    const spawnedBefore = spawned.length;
    // Stamped at the end of the period it belonged to, not now — the partial
    // is a record of *that* day (or week), and the Logbook groups by
    // completedAt.
    const ownPeriodStart = periodStartOf(new Date(task.dueDate!), task.quotaPeriod);
    // addDays rather than a fixed 24h: the DST spring-forward day is 23
    // hours long, and a fixed stride landed the stamp at 00:59 the next
    // morning, which getLogicalDayKey filed under the wrong day.
    const ownDayEnd = new Date(+addDays(ownPeriodStart, task.quotaPeriod === 'week' ? 7 : 1) - 1);
    // A day the task's own category schedule doesn't cover (see #2201,
    // isCategoryScheduledDay) wasn't a work day, so it closes as a no-op
    // rather than a shortfall — neither advancing nor breaking the streak.
    // Day-period only: a weekly target can still be met on any of the
    // category's scheduled days within its week, so a single day-of-week
    // check doesn't say anything about whether the week itself was worked.
    // `nextStreak` reused for both fields the same way completeTask does,
    // so nextStreakRecord folds nothing when it's unchanged.
    const neutral = task.quotaPeriod !== 'week' && !isCategoryScheduledDay(task.category, new Date(ownPeriodStart));
    // A weekly target counting units is a total, so a short week keeps it.
    // A week left behind for a vacation is neutral too: nothing could be
    // logged while it was hidden, so a short count says nothing about it.
    const keepsStreak = neutral || countsUnits(task) || isEndingVacationWeekly(task);
    const nextStreak = keepsStreak ? task.streakCount : 0;
    closed.push({
      ...task,
      completed: true,
      completedAt: ownDayEnd.toISOString(),
      // progressCount deliberately left as-is — that's the record.
      streakCount: nextStreak,
      streakDate: keepsStreak ? task.streakDate : null,
      previousStreakCount: task.streakCount,
      previousStreakDate: task.streakDate,
      // A partial day closes the run out, so the run it ends is a candidate
      // for the personal best like any other ending.
      priorBestStreak: nextStreakRecord(task, nextStreak),
    });
    // A series that has run out (recurrenceEndDate/recurrenceCount) gets the
    // partial record but no successor — the schedule is consulted only for
    // *whether* it continues, since its answer for *when* would still be in
    // the past if the app sat closed for a week.
    if (getNextDueDate(task, dayResetTime) === null) continue;
    // Today, unless the person had pushed this occurrence to a later day of
    // the current period: the successor keeps that day rather than
    // reappearing on Today.
    const heldDay = getTaskDayStart(new Date(getEffectiveTaskDate(task, dayResetTime)!), dayResetTime);
    // And the repeat rule's own next day for a day-period target. "Drink
    // water, Mon to Fri" left short on Friday and rolled on Saturday was dated
    // Saturday, a day the rule skips, where finishing it on time puts the next
    // one on Monday (the same getNextOccurrence a skip uses, which covers no
    // day). A daily rule gives today, as before. A weekly target keeps its
    // period reading: its row stands for the whole week.
    //
    // completedAt is the day being closed, because a repeat-from-completion
    // rule measures from the day the work was done and otherwise reads "now":
    // a daily target left short yesterday was then counted from today and
    // landed on tomorrow, skipping today altogether.
    const ruleDay = task.quotaPeriod !== 'week'
      ? getNextOccurrence(task, dayResetTime, { catchUp: true, completedAt: ownDayEnd })
      : null;
    const ruleStart = ruleDay ? getTaskDayStart(ruleDay.date, dayResetTime) : todayStart;
    const earliest = ruleStart > todayStart ? ruleStart : todayStart;
    const nextDue = new Date(heldDay > earliest ? heldDay : earliest);
    nextDue.setHours(12, 0, 0, 0);
    const effective: Task = inheritedOccurrence(task);
    spawned.push({
      ...effective,
      // The same seed completeTask's successor uses, because it is the same
      // row: the next occurrence of this task. A partial day closed here on
      // one device while the last unit was logged on the other spawned two
      // successors under two seeds, and nothing merged them.
      id: derivedId(spawnSeed.occurrence(task.id)),
      completed: false,
      completedAt: null,
      missedAt: null,
      doneByOtherAt: null,
      // Same as completeTask's successor: the stamp is per-occurrence, and
      // carrying it would leave this row unable to be charged at all.
      penaltyFiredAt: null,
      penaltyCreditedAt: null,
      autoScheduledAt: null,
      createdAt: now,
      seenAt: now,
      dueDate: nextDue.toISOString(),
      deferUntil: null,
      // Same as completeTask's successor: pinned only when the task asked
      // for every occurrence to be.
      pinned: !!task.pinEachOccurrence,
      progressCount: 0,
      quotaLoggedDayKey: null,
      quotaTapTimes: [],
      // Same as completeTask's successor: the count resets, the mute carries.
      postponeCount: 0,
      driftingSince: null,
      bountyPushes: null,
      // A neutral close (see nextStreak above) carries the live streak
      // forward exactly as it stood — a non-work day never happened, so
      // the successor picking it up must not read as day one either.
      streakCount: nextStreak,
      streakDate: keepsStreak ? task.streakDate : null,
      previousStreakCount: 0,
      previousStreakDate: null,
      // Not 0, unlike everything else reset on this successor: the streak
      // starts again but the record is the task's history, and this row is
      // where the task continues.
      priorBestStreak: nextStreakRecord(task, nextStreak),
      timerStartedAt: null,
      // A target's per-unit countdown banked on the day it closes must not
      // carry onto the next day's first unit.
      timerElapsedSeconds: 0,
      previousOccurrenceId: task.id,
      seriesDefaults: null,
      // The rest of what buildCompletion resets on a successor, which this
      // row had been spreading forward from the day it replaces. Left as
      // they were, yesterday's reminder time was in the past and never fired
      // again, and a repeat count never ran down however many days fell short.
      ...reminderOntoDay(effective, nextDue, dayResetTime),
      deadline: deadlineOnto({ ...effective, deadline: null }, nextDue),
      recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
      recurrenceAnchorDate: null,
      deliverableValue: null,
      deliverableWhy: null,
      deliverableRevisitIf: null,
      rotationLog: [],
      rotationPeriodStart: null,
      quotaStartedAt: null,
      calendarEventId: null,
      calendarEventExternalId: null,
      completionCalendarEventId: null,
      completionCalendarEventExternalId: null,
    });
    if (endingVacation && spawned.length > spawnedBefore && isEndingVacationWeekly(task)) {
      const row = spawned[spawned.length - 1];
      const week = quotaWeekStart(getTaskDayStart(new Date(row.dueDate!), dayResetTime), weekStartsOn);
      const away = vacationDaysInWeek(week, getTaskDayStart(new Date(endingVacation.startedAt), dayResetTime), todayStart);
      const patch = away === 0 ? null
        : isRotationTask(row) ? rotationPartWeekPatch(row, 7 - away, todayStart)
        : partWeekPatch(row, 7 - away, todayStart);
      if (patch) spawned[spawned.length - 1] = { ...row, ...patch };
    }
  }

  return { closed, spawned };
}

/**
 * What a vacation ending owes weekly targets that are still in the week they
 * were left in: scaled to the days of the week that weren't vacation, the way
 * a target set up midweek is scaled to the days left (`partWeekPatch`, the same
 * patch). Counted from the first day back, so a 3-a-week target on a Thursday
 * return is 2, paced from Thursday. A row already scaled is left alone, and so
 * is one whose count has already reached the scaled target, which would
 * otherwise sit full and unfinished.
 */
export function planVacationScaling(tasks: readonly Task[], startedAt: string): Task[] {
  const { dayResetTime, weekStartsOn } = useSettingsStore.getState();
  const todayStart = getCurrentDayStart();
  const week = quotaWeekStart(todayStart, weekStartsOn);
  const away = vacationDaysInWeek(week, getTaskDayStart(new Date(startedAt), dayResetTime), todayStart);
  if (away === 0) return [];
  const scaled: Task[] = [];
  for (const t of tasks) {
    if (
      t.completed || t.archived || t.quotaPeriod !== 'week' || t.recurrenceType === 'none' ||
      t.dueDate === null || !isHiddenForVacation(t) || isInPausedProject(t) || proratedFrom(t) !== null ||
      +quotaWeekStart(getTaskDayStart(new Date(t.dueDate), dayResetTime), weekStartsOn) !== +week
    ) continue;
    let patch: Partial<Task> | null;
    let reached: boolean;
    if (isRotationTask(t)) {
      const counts = new Map(rotationMembers(t, todayStart, weekStartsOn).map(m => [m.item.id, m.count]));
      patch = rotationPartWeekPatch(t, 7 - away, todayStart, counts);
      // Every member already at its scaled count would leave a full row
      // that nothing completes, so that week is left as it is.
      reached = !!patch && patch.rotationItems!.every(i => (counts.get(i.id) ?? 0) >= rotationPerWeek(i));
    } else {
      patch = partWeekPatch(t, 7 - away, todayStart);
      reached = !!patch && t.progressCount >= patch.targetCount!;
    }
    if (!patch || reached) continue;
    scaled.push({ ...t, ...patch });
  }
  return scaled;
}

/**
 * Everything a vacation ending changes in quota rows, run before vacation mode
 * is switched off (it reads which rows vacation is hiding, and the start is
 * cleared with the mode): weeks left behind closed and replaced, then the rows
 * still in their own week scaled.
 */
export function planVacationEndQuotas(
  tasks: readonly Task[],
  startedAt: string,
): QuotaRolloverPlan & { scaled: Task[] } {
  const rolled = planQuotaRollover(tasks, { startedAt });
  const byId = new Map<string, Task>([...rolled.closed, ...rolled.spawned].map(t => [t.id, t]));
  const seen = new Set<string>();
  const after = tasks.map(t => { seen.add(t.id); return byId.get(t.id) ?? t; });
  rolled.spawned.forEach(t => { if (!seen.has(t.id)) after.push(t); });
  return { ...rolled, scaled: planVacationScaling(after, startedAt) };
}
