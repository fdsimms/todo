import type { Task, TimeOfDay, Category } from '../types';
import { getCurrentDayStart, getTaskDayStart, getDayStart, hhmmToDate, getNextDueDate } from './dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';

// Anchored to the current *logical* day (getCurrentDayStart), not the literal
// wall-clock date — otherwise, during the early-morning grace window before
// dayResetTime, a segment threshold at or before the reset hour would appear
// to be "later today" (pointing at a clock time hours in the future) instead
// of already having passed for the logical day that's still in progress.
function getTimeOfDayThreshold(timeOfDay: TimeOfDay): Date {
  const { morningStart, afternoonStart, eveningStart } = useSettingsStore.getState();
  const hhmm = timeOfDay === 'morning' ? morningStart
    : timeOfDay === 'afternoon' ? afternoonStart
    : eveningStart;
  const [h, m] = hhmm.split(':').map(Number);
  const t = getCurrentDayStart();
  t.setHours(h, m, 0, 0);
  return t;
}

// True when the task's category is set to hide while vacation mode is on.
// Mirrors per-task `vacationPause`: the task is hidden everywhere (Today and Later).
function isCategoryHiddenOnVacation(category: string | null): boolean {
  if (!category) return false;
  if (!useSettingsStore.getState().vacationMode) return false;
  const cat = useCategoryStore.getState().getCategoryByName(category);
  return !!cat?.hideOnVacation;
}

// True when a task is hidden *specifically* because vacation mode is on — either
// it's individually vacation-paused or it belongs to a category set to hide on
// vacation. These tasks are absent from both Today and Later; the screens can
// surface them behind a "show hidden" reveal.
export function isHiddenForVacation(task: Task): boolean {
  if (task.completed) return false;
  if (!useSettingsStore.getState().vacationMode) return false;
  if (task.vacationPause) return true;
  return isCategoryHiddenOnVacation(task.category);
}

function isCategoryScheduleActive(category: string | null): boolean {
  if (!category) return true;
  const cat = useCategoryStore.getState().getCategoryByName(category);
  if (!cat || !cat.scheduleDays || !cat.scheduleStart || !cat.scheduleEnd) return true;

  const now = new Date();
  const dayOfWeek = now.getDay();
  if (!cat.scheduleDays.includes(dayOfWeek)) return false;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = cat.scheduleStart.split(':').map(Number);
  const [eh, em] = cat.scheduleEnd.split(':').map(Number);
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

function getNextCategoryWindowStart(cat: Category): Date | null {
  if (!cat.scheduleDays || !cat.scheduleStart || !cat.scheduleEnd) return null;

  const now = new Date();
  const [sh, sm] = cat.scheduleStart.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = sh * 60 + sm;
  const dayOfWeek = now.getDay();

  if (cat.scheduleDays.includes(dayOfWeek) && nowMins < startMins) {
    const next = new Date(now);
    next.setHours(sh, sm, 0, 0);
    return next;
  }

  for (let i = 1; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + i);
    if (cat.scheduleDays.includes(candidate.getDay())) {
      candidate.setHours(sh, sm, 0, 0);
      return candidate;
    }
  }

  return null;
}

function earliestSegmentThreshold(segments: TimeOfDay[]): Date | null {
  if (segments.length === 0) return null;
  return segments
    .map(s => getTimeOfDayThreshold(s))
    .reduce((min, t) => (t < min ? t : min));
}

// True once the task's own day (deferUntil / dueDate) has arrived — i.e. it's
// not sitting hidden behind a future date. Used to distinguish a genuinely
// expired time window from a window on a task that hasn't come up yet, and to
// gate early completion of recurring tasks shown ahead of time in Later.
export function hasDayArrived(task: Task): boolean {
  const { dayResetTime } = useSettingsStore.getState();
  const todayStart = getCurrentDayStart();
  if (task.deferUntil) {
    const deferDayStart = getTaskDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart > todayStart) return false;
  }
  if (task.dueDate) {
    const taskDayStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    if (taskDayStart > todayStart) return false;
  }
  return true;
}

// True while a task with a time window is currently inside that window
// (windowStart has passed, windowEnd hasn't) — used to surface the
// "time-limited, act now" indicator.
export function isTaskWindowActive(task: Task): boolean {
  if (task.completed || !task.windowStart) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;
  if (!hasDayArrived(task)) return false;
  const now = new Date();
  if (now < hhmmToDate(task.windowStart)) return false;
  if (task.windowEnd && now >= hhmmToDate(task.windowEnd)) return false;
  return true;
}

// True once a task's time window has closed (windowEnd has passed on its own
// day) and it's still incomplete. Expired tasks are neither "visible" nor
// "deferred" — they move to their own Expired bucket and stay there until the
// user deals with them (delete, or skip/reschedule a recurring task).
export function isTaskExpired(task: Task): boolean {
  if (task.completed || !task.windowEnd) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;
  if (!hasDayArrived(task)) return false;
  return new Date() >= hhmmToDate(task.windowEnd);
}

export function isTaskVisible(task: Task): boolean {
  if (task.completed) return false;

  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;

  if (isCategoryHiddenOnVacation(task.category)) return false;

  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();

  if (task.deferUntil) {
    const deferDayStart = getTaskDayStart(new Date(task.deferUntil), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (deferDayStart > todayStart) return false;
  }

  if (task.timeSegments.length > 0) {
    const threshold = earliestSegmentThreshold(task.timeSegments)!;
    if (now < threshold) return false;
  }

  if (task.windowStart && now < hhmmToDate(task.windowStart)) return false;

  if (isTaskExpired(task)) return false;

  if (task.dueDate) {
    const taskDayStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (taskDayStart > todayStart) return false;
  }

  if (!isCategoryScheduleActive(task.category)) return false;

  return true;
}

// True for a recurring task that's showing up in Later ahead of its own day
// (deferred to, or due on, a future day). Completing these early skips the
// point of the schedule — the next occurrence gets generated before this one
// was actually due — so callers use this to block completion until the day
// arrives.
export function isRecurrenceNotYetDue(task: Task): boolean {
  return task.recurrenceType !== 'none' && !task.completed && !hasDayArrived(task);
}

// True for a not-yet-completed recurring task that still has a next
// occurrence ahead of it. Used to decide whether deleting this task is
// ambiguous (could mean "skip this one" vs. "end the series") — a task whose
// series has already ended (getNextDueDate returns null), or one sitting as
// a completed log entry, has only one sensible delete outcome.
export function isLiveRecurring(task: Task): boolean {
  if (task.recurrenceType === 'none' || task.completed) return false;
  const { dayResetTime } = useSettingsStore.getState();
  return getNextDueDate(task, dayResetTime) !== null;
}

export function isTaskDeferred(task: Task): boolean {
  if (task.completed) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;
  if (isTaskExpired(task)) return false;
  return !isTaskVisible(task);
}

// True when a task is a "loose" item with no organizing metadata — the kind
// that lands in the Inbox for triage (e.g. voice-added or quickly jotted tasks).
// It's a pure computed view: as soon as a task gains a category, tag, date,
// time window, recurrence, reminder or priority it leaves the Inbox on its own,
// so there's no stored flag to keep in sync. Deliberately NOT disqualifying:
// notes, effort, estimatedMinutes, focused, vacationPause — those don't file a
// task anywhere. Inbox tasks still appear on Today; the Inbox is a triage lens,
// not a hidden holding pen.
export function isInboxTask(task: Task): boolean {
  return (
    !task.parentId &&
    !task.completed &&
    task.category == null &&
    task.tags.length === 0 &&
    task.dueDate == null &&
    task.deadline == null &&
    task.deferUntil == null &&
    task.timeSegments.length === 0 &&
    task.windowStart == null &&
    task.windowEnd == null &&
    task.recurrenceType === 'none' &&
    task.reminderTime == null &&
    task.priority === 0
  );
}

// True when a task is hidden solely because its time-of-day segment hasn't started yet today.
// Excludes tasks deferred to a future day or due on a future day.
export function isUpcomingToday(task: Task): boolean {
  if (task.completed || task.timeSegments.length === 0) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;

  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();
  const todayStart = getCurrentDayStart();

  if (task.deferUntil) {
    const deferDayStart = getTaskDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart > todayStart) return false;
  }

  if (task.dueDate) {
    const taskDayStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    if (taskDayStart > todayStart) return false;
  }

  const threshold = earliestSegmentThreshold(task.timeSegments)!;
  return now < threshold;
}

export function getVisibleAt(task: Task): Date {
  const now = new Date();
  const { dayResetTime } = useSettingsStore.getState();
  const candidates: Date[] = [];
  const todayStart = getCurrentDayStart();

  // Both timeSegments and windowStart refine a day to a specific clock time;
  // a task normally uses one or the other, so timeSegments takes precedence
  // when both happen to be set.
  const applyTimeThreshold = (base: Date): Date => {
    const threshold = task.timeSegments.length > 0
      ? earliestSegmentThreshold(task.timeSegments)
      : task.windowStart ? hhmmToDate(task.windowStart) : null;
    if (!threshold) return base;
    const result = new Date(base);
    result.setHours(threshold.getHours(), threshold.getMinutes(), 0, 0);
    return result;
  };

  if (task.deferUntil) {
    const deferDayStart = getTaskDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart > todayStart) {
      candidates.push(applyTimeThreshold(deferDayStart));
    }
  }

  if (task.timeSegments.length > 0 && candidates.length === 0) {
    const threshold = earliestSegmentThreshold(task.timeSegments)!;
    if (threshold > now) candidates.push(threshold);
  } else if (task.windowStart && candidates.length === 0) {
    const threshold = hhmmToDate(task.windowStart);
    if (threshold > now) candidates.push(threshold);
  }

  if (task.dueDate) {
    const taskStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    if (taskStart > todayStart) {
      const candidate = applyTimeThreshold(taskStart);
      if (candidates.length === 0 || candidate > candidates[candidates.length - 1]) {
        candidates.push(candidate);
      }
    }
  }

  if (task.category) {
    const cat = useCategoryStore.getState().getCategoryByName(task.category);
    if (cat) {
      const nextWindow = getNextCategoryWindowStart(cat);
      if (nextWindow && nextWindow > now) candidates.push(nextWindow);
    }
  }

  if (candidates.length === 0) return now;
  return candidates.reduce((latest, d) => (d > latest ? d : latest));
}

// The most recent moment a day-based visibility gate (deferUntil, dueDate, or
// a time-of-day segment) let this task through. Only these three are "day
// turnover" gates — windowStart/vacationPause aren't, and already have their
// own indicators — so a task with none of them returns null (never "new").
function getBecameVisibleAt(task: Task): Date | null {
  const { dayResetTime } = useSettingsStore.getState();
  const now = new Date();
  const todayStart = getCurrentDayStart();
  const candidates: Date[] = [];

  if (task.deferUntil) {
    const deferDayStart = getTaskDayStart(new Date(task.deferUntil), dayResetTime);
    if (deferDayStart <= todayStart) candidates.push(deferDayStart);
  }

  if (task.dueDate) {
    const dueDayStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    if (dueDayStart <= todayStart) candidates.push(dueDayStart);
  }

  if (task.timeSegments.length > 0) {
    const threshold = earliestSegmentThreshold(task.timeSegments)!;
    if (threshold <= now) candidates.push(threshold);
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((latest, d) => (d > latest ? d : latest));
}

// True for a visible task that hasn't been interacted with since it most
// recently crossed a day-based visibility gate — drives the "new" dot.
export function isTaskNew(task: Task): boolean {
  if (!isTaskVisible(task)) return false;
  const becameVisibleAt = getBecameVisibleAt(task);
  if (!becameVisibleAt) return false;
  const seenAt = new Date(task.seenAt ?? task.createdAt);
  return becameVisibleAt > seenAt;
}

// True when a task counts toward its group's "N/M done today" tally — either
// still visible/due (not yet done), or completed earlier today. A child
// completed on some other day (e.g. a one-off task finished last week) stops
// counting once today no longer matches, so the tally reflects today's
// routine instead of accumulating forever. Deliberately doesn't require
// recurrence: a plain one-off grouped task still counts on the day it's done.
export function isRelevantToGroupToday(task: Task): boolean {
  if (!task.completed) return isTaskVisible(task);
  if (!task.completedAt) return false;
  return +getDayStart(new Date(task.completedAt)) === +getCurrentDayStart();
}

export function getSegmentLabels(task: Task): string[] {
  const SEG_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
  return task.timeSegments.map(s => SEG_LABELS[s]);
}
