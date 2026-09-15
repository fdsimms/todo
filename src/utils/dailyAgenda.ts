import { isSameDay } from 'date-fns/isSameDay';
import type { Task } from '../types';
import { getDayStart, getTaskDayStart } from './dateUtils';
import { hhmmToDate } from './clockTime';

/**
 * The daily agenda notification — what it says, and when the next one lands.
 *
 * Pure on purpose: everything here takes the tasks and a target day and
 * returns a string or a Date, so the counting and the wording can be tested
 * without a device. Scheduling it lives in utils/notifications.ts.
 */

export interface AgendaCounts {
  /** Dated for the target day. */
  due: number;
  /**
   * Dated before it and still not done. Deliberately not called "overdue" —
   * a dueDate is the day a task becomes available, not a promise it can break
   * (see formatScheduledDate); `deadlines` is the count that means late.
   */
  carriedOver: number;
  /** Hard deadlines falling on it. */
  deadlines: number;
}

/**
 * What the agenda counts, for a day that hasn't happened yet.
 *
 * Deliberately based on the dates a task carries rather than on
 * `isTaskVisible`, which answers "is this on Today *right now*" and can't
 * answer it about tomorrow morning. Counting what's dated for the day is both
 * computable ahead of time and the thing a morning summary is actually about.
 *
 * Subtasks are excluded the way every top-level list excludes them, and
 * completed or archived rows never count. The caller filters out anything
 * hidden by vacation mode before this sees it — that's a store read, and
 * keeping it out here is what leaves this testable.
 *
 * A recurring task contributes only its current row, since future occurrences
 * aren't materialised until completion. That's accurate for the next agenda —
 * the only one ever scheduled — and would drift for one further out.
 */
export function agendaCounts(tasks: Task[], targetDay: Date, dayResetTime: string): AgendaCounts {
  const target = getDayStart(targetDay, dayResetTime);
  let due = 0;
  let carriedOver = 0;
  let deadlines = 0;

  for (const task of tasks) {
    if (task.completed || task.archived || task.parentId) continue;

    // dueDate/deadline are stored anchors, not "now" moments — a plain
    // date-only pick lands at local midnight (see getLogicalToday), which is
    // earlier than any non-default dayResetTime. getDayStart's early-morning
    // rollback would then read a task dated for the target day as belonging
    // to the day before, undercounting "due" and dropping "deadlines"
    // entirely for anyone who's moved dayResetTime off midnight.
    if (task.dueDate) {
      const day = getTaskDayStart(new Date(task.dueDate), dayResetTime);
      if (isSameDay(day, target)) due++;
      else if (day < target) carriedOver++;
    }

    if (task.deadline) {
      const day = getTaskDayStart(new Date(task.deadline), dayResetTime);
      if (isSameDay(day, target)) deadlines++;
    }
  }

  return { due, carriedOver, deadlines };
}

/**
 * The notification body, or null when there's nothing worth waking someone for.
 *
 * Null rather than "0 tasks today" is the whole design of this feature: a
 * daily notification that fires on empty days is the one people turn off, and
 * the caller skips scheduling entirely when this returns null.
 */
export function agendaBody(counts: AgendaCounts): string | null {
  const parts: string[] = [];
  if (counts.due > 0) parts.push(`${counts.due} due`);
  if (counts.carriedOver > 0) parts.push(`${counts.carriedOver} carried over`);
  if (counts.deadlines > 0) {
    parts.push(`${counts.deadlines} deadline${counts.deadlines === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Joins a list the way somebody would say it, rather than the way a line of
 * text separates things.
 *
 * Its own function because the comma-and rule is exactly what the written body
 * has no use for and the spoken one cannot do without: a middle dot is a mark
 * you see, and a list of two things read out with no "and" between them sounds
 * like the sentence was cut off.
 */
function joinSpoken(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * The same agenda, worded to be heard rather than read.
 *
 * Beside `agendaBody` rather than in a module of its own, so that anything
 * changing what the agenda counts has both phrasings in front of it. Two
 * registers of one sentence, the split `describeRecipeCost` and
 * `describeWeekCost` already make by noun.
 *
 * It is a rewrite rather than the same string spoken, and that was the thing
 * worth checking before assuming otherwise. The written body is
 * `3 due · 2 carried over · 1 deadline`: three fragments a person scans in a
 * notification, separated by a mark that exists only on a screen. Read out,
 * the separator is either silence or the words "middle dot", and "three due"
 * with no noun is not a sentence anybody says. So this one names what is being
 * counted, joins with "and" (see `joinSpoken`), and ends with a full stop so
 * the synthesiser's own intonation falls at the end instead of trailing.
 *
 * "carried over" gains "from earlier" for the same reason: on screen it sits
 * next to the count that explains it, and out loud it is the only phrase here
 * that doesn't say what it means on its own.
 *
 * Null on an empty day, exactly as `agendaBody` returns null, and for the same
 * reason one step further: the one thing worse than a notification on a day
 * with nothing on it is a voice announcing it.
 */
export function agendaSpokenBody(counts: AgendaCounts): string | null {
  const parts: string[] = [];
  if (counts.due > 0) {
    parts.push(`${counts.due} task${counts.due === 1 ? '' : 's'} due`);
  }
  if (counts.carriedOver > 0) {
    parts.push(`${counts.carriedOver} carried over from earlier`);
  }
  if (counts.deadlines > 0) {
    parts.push(`${counts.deadlines} deadline${counts.deadlines === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return null;
  return `Today: ${joinSpoken(parts)}.`;
}

/**
 * The next time the agenda should fire — today's occurrence of `hhmm` if it's
 * still ahead, otherwise tomorrow's.
 *
 * Strictly after `now`: scheduling one for the current minute races the
 * trigger and either fires immediately or is dropped for being in the past,
 * and both look like a bug from the outside.
 */
export function nextAgendaTime(now: Date, hhmm: string): Date {
  const today = hhmmToDate(hhmm, now);
  if (today > now) return today;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}
