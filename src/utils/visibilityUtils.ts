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
  const { morningStart, afternoonStart, eveningStart, nightStart } = useSettingsStore.getState();
  const hhmm = timeOfDay === 'morning' ? morningStart
    : timeOfDay === 'afternoon' ? afternoonStart
    : timeOfDay === 'evening' ? eveningStart
    : nightStart;
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

// Anchored to the current *logical* day (getCurrentDayStart()), same as
// getTimeOfDayThreshold above and for the same reason: hhmmToDate()'s default
// base is the literal wall-clock date, so during the early-morning grace
// window before dayResetTime a windowStart/windowEnd time would compare
// against *today's* clock instant instead of the logical day (still
// "yesterday") that's actually in progress — hiding an already-active
// windowed task the instant the calendar flips, well before dayResetTime.
function getWindowThreshold(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const t = getCurrentDayStart();
  t.setHours(h, m, 0, 0);
  return t;
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
  if (task.completed || task.archived || !task.windowStart) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;
  if (!hasDayArrived(task)) return false;
  const now = new Date();
  if (now < getWindowThreshold(task.windowStart)) return false;
  if (task.windowEnd && now >= getWindowThreshold(task.windowEnd)) return false;
  return true;
}

// True once a task's time window has closed (windowEnd has passed on its own
// day) and it's still incomplete. Expired tasks are neither "visible" nor
// "deferred" — they move to their own Expired bucket and stay there until the
// user deals with them (delete, or skip/reschedule a recurring task).
export function isTaskExpired(task: Task): boolean {
  if (task.completed || task.archived || !task.windowEnd) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;
  if (!hasDayArrived(task)) return false;
  return new Date() >= getWindowThreshold(task.windowEnd);
}

// ---- Quota tasks ---------------------------------------------------------
// A quota task is a habit logged several times a day (8 glasses of water)
// rather than done once. It is *hidden from Today while you're on pace* and
// surfaces only once you've fallen behind, so a day you keep up with produces
// no feed rows at all and a single tap (which logs one unit) usually re-hides
// it again. Reaching targetCount completes the task like any other, so the
// per-day reset is free: the next occurrence starts at progressCount 0.

export function isQuotaTask(task: Task): boolean {
  return task.targetCount !== null && task.targetCount > 1;
}

// The span the pace ramps across: the task's own time window when it has one,
// otherwise the global active hours. Anchored to the current *logical* day via
// getWindowThreshold, for the reason documented there.
function getQuotaSpan(task: Task): { start: Date; end: Date } {
  const { activeHoursStart, activeHoursEnd } = useSettingsStore.getState();
  return {
    start: getWindowThreshold(task.windowStart ?? activeHoursStart),
    end: getWindowThreshold(task.windowEnd ?? activeHoursEnd),
  };
}

// How many units you'd expect to have logged by now. Ceil rather than floor so
// the first unit is owed the moment the span opens ("start the day with one")
// instead of only after a target-th of it has passed; the last is owed as the
// span closes. Outside the span it's all or nothing.
export function quotaExpectedByNow(task: Task): number {
  if (!isQuotaTask(task)) return 0;
  const target = task.targetCount!;
  const { start, end } = getQuotaSpan(task);
  const now = new Date();
  if (now <= start) return 0;
  // end <= start means active hours are set to a span that doesn't resolve on
  // one logical day (e.g. crossing midnight) — treat the whole day as past due
  // rather than dividing by zero below.
  if (now >= end || end <= start) return target;
  return Math.min(target, Math.ceil((target * (+now - +start)) / (+end - +start)));
}

export function isQuotaOnPace(task: Task): boolean {
  return task.progressCount >= quotaExpectedByNow(task);
}

// The moment quotaExpectedByNow ticks up to progressCount + 1 — i.e. when the
// next unit comes due. Places an on-pace quota task in Later's running order.
export function quotaNextDueAt(task: Task): Date {
  const { start, end } = getQuotaSpan(task);
  if (end <= start) return start;
  return new Date(+start + ((+end - +start) * task.progressCount) / task.targetCount!);
}

// True for a quota occurrence closed out without reaching its target — the
// record rolloverQuotas leaves behind for a day you fell short. Derived from
// the count, so a partial day needs no column of its own.
export function isQuotaPartial(task: Task): boolean {
  return task.completed && isQuotaTask(task) && task.progressCount < task.targetCount!;
}

export function isTaskVisible(task: Task): boolean {
  if (task.completed) return false;
  if (task.archived) return false;

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

  if (task.windowStart && now < getWindowThreshold(task.windowStart)) return false;

  if (isTaskExpired(task)) return false;

  // Project tasks default to living in their project, not the daily lists —
  // they only surface on Today once given an explicit due date.
  if (task.projectId && !task.dueDate) return false;

  // A non-project task with no date/time signal at all has nowhere to be
  // "due" today — it lives in the Inbox (untriaged) or Unscheduled (triaged
  // but undated) view instead, not on Today.
  if (!task.projectId && hasNoDateSignal(task)) return false;

  if (task.dueDate) {
    const taskDayStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    const todayStart = getCurrentDayStart();
    if (taskDayStart > todayStart) return false;
  }

  // Last of the gates, so a quota task still loses to its own date/defer/window
  // checks first: being on pace only hides a task that would otherwise be due
  // right now.
  if (isQuotaTask(task) && isQuotaOnPace(task)) return false;

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
  if (task.archived) return false;
  if (task.vacationPause && useSettingsStore.getState().vacationMode) return false;
  if (isCategoryHiddenOnVacation(task.category)) return false;
  if (isTaskExpired(task)) return false;
  // Undated project tasks aren't visible, but they don't belong in Later
  // either — they have no date to be deferred to, so they just live in their
  // project until one is assigned.
  if (task.projectId && !task.dueDate) return false;
  // Same reasoning for Inbox/Unscheduled tasks: no date signal means nothing
  // to defer to, so they stay out of Later too.
  if (!task.projectId && hasNoDateSignal(task)) return false;
  return !isTaskVisible(task);
}

// True when a task is a "loose" item with no organizing metadata — the kind
// that lands in the Inbox for triage (e.g. voice-added or quickly jotted tasks).
// It's a pure computed view: as soon as a task gains a category, tag, date,
// time window, recurrence, reminder or priority it leaves the Inbox on its own,
// so there's no stored flag to keep in sync. Deliberately NOT disqualifying:
// notes, effort, estimatedMinutes, pinned, vacationPause — those don't file a
// task anywhere. Inbox tasks don't appear on Today (see isTaskVisible) — the
// Inbox is where they wait until triaged (dated, filed under a project, or
// otherwise organized).
export function isInboxTask(task: Task): boolean {
  return (
    !task.parentId &&
    !task.completed &&
    !task.archived &&
    task.projectId == null &&
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

// True when a task carries none of the signals that gate its day-to-day
// visibility (dueDate, deferUntil, timeSegments, windowStart) — the same
// three fields isTaskVisible/isTaskDeferred check to decide whether a task is
// "scheduled" at all. isInboxTask is a subset of this: a bare inbox task has
// no date signal AND no other organizing metadata either.
export function hasNoDateSignal(task: Task): boolean {
  return (
    task.dueDate == null &&
    task.deferUntil == null &&
    task.timeSegments.length === 0 &&
    task.windowStart == null
  );
}

// True when a task is a "someday" item: organized (category, tags, priority,
// etc. — otherwise it'd be an Inbox task) but with no date/time signal to
// place it on a particular day, and not filed under a project (a project's
// own screen is that task's home instead). Drives the Unscheduled view.
export function isUnscheduledTask(task: Task): boolean {
  return (
    !task.parentId &&
    !task.completed &&
    !task.archived &&
    task.projectId == null &&
    hasNoDateSignal(task) &&
    !isInboxTask(task)
  );
}

// True when a task is hidden solely because its time-of-day segment hasn't started yet today.
// Excludes tasks deferred to a future day or due on a future day.
export function isUpcomingToday(task: Task): boolean {
  if (task.completed || task.archived || task.timeSegments.length === 0) return false;
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
    const threshold = getWindowThreshold(task.windowStart);
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

  // An on-pace quota task comes back when its next unit falls due rather than
  // at any day boundary — that's what orders it against everything else in Later.
  if (isQuotaTask(task) && isQuotaOnPace(task)) {
    const nextUnit = quotaNextDueAt(task);
    if (nextUnit > now) candidates.push(nextUnit);
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

// The active step's title while mid a multi-step chain, else null. A
// single-item chain reads no differently from a plain task anywhere else in
// the UI (no badge, same behavior), so this only kicks in once there's more
// than one step to distinguish.
export function activeChainStepTitle(task: Task): string | null {
  if (!task.chainEnabled || task.chainItems.length <= 1) return null;
  return task.chainItems[task.chainIndex % task.chainItems.length]?.title ?? null;
}

// What the user should see as "the title" for a task — the active chain
// step's title mid-chain, otherwise the task's own title. Every surface that
// names a task (row, Logbook, Search, notification, widget, VoiceOver label)
// should route through this rather than reading task.title directly, so a
// chain step's identity survives everywhere it's shown, not just the
// collapsed Today row.
export function displayTitleFor(task: Task): string {
  return activeChainStepTitle(task) ?? task.title;
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

// A stack's real membership, and the only thing any surface should count.
//
// A recurring task isn't one row: completing it leaves the completed row
// behind and inserts a fresh one (see completeTask), and *both* keep the same
// groupId forever — so the raw child list grows by one row per completion for
// the life of the stack. A stack of 8 nightly habits reads as 22 children
// after two weeks and 1000 after a year, none of which the user thinks of as
// being in the stack. The roster collapses that back to one entry per task
// *series*: whichever occurrence represents that series right now.
//
// In:
//   - anything relevant to today (due/visible now, or completed today), so
//     the tally still reads 8/8 after the evening's completions have each
//     spawned tomorrow's replacement;
//   - a live occurrence with no successor yet, even when it isn't due for
//     days — iron every other day is still a member of Supplements on the
//     days it isn't due, it just isn't due.
// Out:
//   - old completions (the tombstones — this is the unbounded growth);
//   - archived children;
//   - an occurrence already superseded by a later one, which now speaks for
//     the series;
//   - a future occurrence whose own predecessor is already in the roster,
//     which would otherwise count one series twice on the day it's completed
//     (tonight's finished row plus tomorrow's fresh one).
// A dated series is several real rows standing for one commitment (see
// Task.seriesId), so a stack holding "walk the dog" on the 10th and the 15th
// would otherwise read as two members. Collapses each series to the row that
// speaks for it right now — whichever is relevant to today if any is, else
// the earliest one still to come — keeping it in the position its first row
// held so the roster's order doesn't jump around.
function collapseSeries(tasks: Task[]): Task[] {
  const slotOf = new Map<string, number>();
  const out: (Task | null)[] = [];

  for (const task of tasks) {
    if (!task.seriesId) {
      out.push(task);
      continue;
    }
    const slot = slotOf.get(task.seriesId);
    if (slot === undefined) {
      slotOf.set(task.seriesId, out.length);
      out.push(task);
      continue;
    }
    const held = out[slot]!;
    const heldToday = isRelevantToGroupToday(held);
    const taskToday = isRelevantToGroupToday(task);
    if (taskToday && !heldToday) {
      out[slot] = task;
    } else if (taskToday === heldToday && (task.dueDate ?? '') < (held.dueDate ?? '')) {
      out[slot] = task;
    }
  }

  return out.filter((t): t is Task => t !== null);
}

export function groupRoster(children: Task[]): Task[] {
  const superseded = new Set<string>();
  const byId = new Map<string, Task>();
  for (const child of children) {
    byId.set(child.id, child);
    if (child.previousOccurrenceId) superseded.add(child.previousOccurrenceId);
  }
  const collapsed = children.filter(child => {
    // Checked first so a successor that IS due today (a chain step spawned
    // from a dated predecessor picks up today's date — see completeTask)
    // is never dropped as a duplicate of the step that spawned it.
    if (isRelevantToGroupToday(child)) return true;
    if (child.completed || child.archived) return false;
    if (superseded.has(child.id)) return false;
    const prev = child.previousOccurrenceId ? byId.get(child.previousOccurrenceId) : undefined;
    if (prev && isRelevantToGroupToday(prev)) return false;
    return true;
  });
  return collapseSeries(collapsed);
}

// True when a "user dismissed this" stamp belongs to the current logical day.
// Self-expiring by construction: the stamp is compared against today rather
// than just checked for existence, so whatever it hides comes back on its own
// at the day rollover and nothing has to remember to clear it. Callers pair it
// with a live condition (see isGroupHiddenToday) so the thing re-surfaces early
// if the circumstances that justified hiding it stop holding.
export function isDismissedToday(stamp: string | null): boolean {
  if (!stamp) return false;
  return +getDayStart(new Date(stamp)) === +getCurrentDayStart();
}

// True when the user has dismissed this stack for the current logical day.
// Callers pair this with "every member due today is done" (see TaskGroupHeader)
// so a stack that gains live work again after being dismissed can't stay hidden.
export function isGroupDismissedToday(completedAt: string | null): boolean {
  return isDismissedToday(completedAt);
}

// Whether a dismissed stack should actually stay hidden right now. `dueToday`
// is the stack's members relevant to today (roster ∩ isRelevantToGroupToday).
//
// The "and everything due today is still done" half is what makes the
// dismissal safe to leave lying around: a stack that gains live work again —
// a recurring member spawning its next occurrence, an undo, a task added to
// it — stops satisfying this and shows itself, so nothing has to detect those
// events and clear the stamp. The old design did clear it, from four separate
// call sites, and missed a fifth.
export function isGroupHiddenToday(completedAt: string | null, dueToday: Task[]): boolean {
  if (!isGroupDismissedToday(completedAt)) return false;
  return dueToday.length > 0 && dueToday.every(t => t.completed);
}
