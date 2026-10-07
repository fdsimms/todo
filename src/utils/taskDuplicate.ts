import type { Task } from '../types';

/**
 * A copy of a task: what `duplicateTask` writes, lifted out of the store so the
 * MCP server's `duplicate_task` writes the same rows. The copy keeps every
 * setting and starts every piece of progress over; its subtasks come with it.
 */
export function duplicateRows(
  original: Task,
  subtasks: readonly Task[],
  opts: { now: string; sortOrder: number; newId: () => string },
): { copy: Task; subtaskCopies: Task[] } {
  const now = opts.now;
  const resetForCopy = {
    completed: false,
    completedAt: null,
    missedAt: null,
    doneByOtherAt: null,
    // A copy is the user's own doing, whatever put the date on the original.
    autoScheduledAt: null,
    createdAt: now,
    seenAt: now,
    pinned: false,
    streakCount: 0,
    streakDate: null,
    previousStreakCount: 0,
    previousStreakDate: null,
    priorBestStreak: 0,
    timerStartedAt: null,
    actualMinutes: null,
    // The duplicate keeps the duration but starts its countdown fresh. The
    // health target is not reset alongside it, and neither is timedMinutes:
    // the countdown's *progress* is what belongs to the original run, where
    // the target is part of what the task is.
    timerElapsedSeconds: 0,
    // Same split as actualMinutes above: the copy still asks the question,
    // it just hasn't been answered yet.
    deliverableValue: null,
    deliverableWhy: null,
    deliverableRevisitIf: null,
    previousOccurrenceId: null,
    seriesId: null,
    seriesMonthDays: [],
    seriesRepeatMonths: 1,
    seriesDefaults: null,
    archived: false,
    archivedAt: null,
    chainIndex: 0, // a duplicate starts a chain fresh, not mid-way through the original
    // Both, unlike a recurrence successor: a copy is a new task the user just
    // made, so it has neither a history of being ducked nor a mute they set.
    postponeCount: 0,
    postponeMuted: false,
    driftingSince: null,
    bountyPushes: null,
    // deadlineOnCalendar (the preference) carries via ...original, same as
    // every other setting on the copy, but the device event does not —
    // two tasks pointing at one event means editing either one's deadline
    // silently drags the other's calendar entry with it. Nor its server id,
    // which would let the copy find the original's event again (#2950).
    calendarEventId: null,
    calendarEventExternalId: null,
    // logCompletionToCalendar carries via ...original the same way, but a
    // copy is a fresh, uncompleted task — it hasn't logged anything yet.
    completionCalendarEventId: null,
    completionCalendarEventExternalId: null,
    // Same reasoning, and the copy has no claim on the original's slot
    // anyway — the block was time set aside for one piece of work.
    timeBlockEventId: null,
    timeBlockExternalId: null,
  };
  const copy: Task = {
    ...original,
    ...resetForCopy,
    id: opts.newId(),
    sortOrder: opts.sortOrder,
  };
  const subtaskCopies = subtasks.map(sub => ({
    ...sub,
    ...resetForCopy,
    id: opts.newId(),
    parentId: copy.id,
  }));
  return { copy, subtaskCopies };
}
