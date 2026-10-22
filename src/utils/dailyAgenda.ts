import { isSameDay } from 'date-fns/isSameDay';
import type { MealPlanEntry, Person, Recipe, Task } from '../types';
import { formatTimeOfDay, getDayStart, getEffectiveTaskDate, getTaskDayStart } from './dateUtils';
import { occupiesTime, type BusyEvent } from './calendarBusy';
import { hhmmToDate } from './clockTime';
import { recipeIndex, titleForEntry, uncookedEntries } from './mealPlan';
import { birthdayInYear } from './birthdayTasks';
import { primaryNickname } from './nicknames';

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
  /**
   * The day's meetings (`agendaMeetings`), or absent when the calendar wasn't
   * read for the day: unknown is left unsaid rather than reported as none.
   */
  meetings?: AgendaMeetings | null;
  /**
   * What's planned for dinner (`agendaDinners`). Absent with the kitchen
   * switched off, and empty when nothing is planned: both leave the line out.
   */
  dinners?: string[];
  /** Whose birthday the day is (`agendaBirthdays`), by the name the app calls them. */
  birthdays?: string[];
}

export interface AgendaMeetings {
  count: number;
  /** When the first one starts. */
  first: Date;
}

/**
 * The meetings starting on the agenda's day: events that occupy time
 * (`occupiesTime`, so no all-day, free or cancelled ones), counted by when they
 * start, so last night's event running past midnight isn't one of today's.
 * Null when there are none, which leaves the line out.
 */
export function agendaMeetings(
  events: readonly BusyEvent[],
  dayStart: Date,
  dayEnd: Date,
): AgendaMeetings | null {
  let count = 0;
  let first: number | null = null;
  for (const event of events) {
    if (!occupiesTime(event)) continue;
    const start = Date.parse(event.start);
    if (!(start >= dayStart.getTime() && start < dayEnd.getTime())) continue;
    count++;
    if (first === null || start < first) first = start;
  }
  return count > 0 && first !== null ? { count, first: new Date(first) } : null;
}

/**
 * The day's dinners, in plan order, by the name each row shows on the week.
 *
 * Dinner only: it is the meal a morning summary can still do something about
 * (a thaw, a stop at the store on the way home), and the line stays one line.
 * A dinner already marked cooked is left out, which matters only when the
 * agenda is rebuilt late on the day it covers.
 */
export function agendaDinners(entries: readonly MealPlanEntry[], recipes: readonly Recipe[]): string[] {
  const index = recipeIndex(recipes);
  return uncookedEntries(entries.filter(e => e.slot === 'dinner'))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(e => titleForEntry(e, index).trim())
    .filter(Boolean);
}

/**
 * Who has a birthday on the agenda's day, named the way the birthday task
 * names them (their nickname when they have one).
 *
 * Read from the people themselves rather than from the birthday tasks, which
 * land days early on purpose (`birthdayLeadDays`) and so are never dated for
 * the birthday itself. Archived people are left out, as they are everywhere a
 * person would otherwise surface.
 */
export function agendaBirthdays(people: readonly Person[], day: Date): string[] {
  const names: string[] = [];
  for (const person of people) {
    if (person.archived) continue;
    const birthday = birthdayInYear(person, day.getFullYear());
    if (!birthday || !isSameDay(birthday, day)) continue;
    const name = primaryNickname(person.nickname) || person.name.trim();
    if (name) names.push(name);
  }
  return names;
}

/** "Dinner: Chicken tacos" and "Gideon’s birthday", each on a line of its own. */
function extraLines(counts: AgendaCounts): string[] {
  const lines: string[] = [];
  if (counts.dinners && counts.dinners.length > 0) lines.push(`Dinner: ${counts.dinners.join(', ')}`);
  const names = counts.birthdays ?? [];
  if (names.length === 1) lines.push(`${names[0]}’s birthday`);
  else if (names.length > 1) lines.push(`Birthdays: ${names.join(', ')}`);
  return lines;
}

function meetingsPhrase(meetings: AgendaMeetings, use24Hour: boolean, spoken: boolean): string {
  const noun = `${meetings.count} meeting${meetings.count === 1 ? '' : 's'}`;
  const at = formatTimeOfDay(meetings.first, use24Hour);
  if (meetings.count === 1) return `${noun} at ${at}`;
  return spoken ? `${noun}, the first at ${at}` : `${noun}, first at ${at}`;
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
    //
    // The effective date, so a task deferred to Friday is not "due" or
    // "carried over" on the mornings in between.
    const placed = getEffectiveTaskDate(task, dayResetTime);
    if (task.dueDate && placed) {
      const day = getTaskDayStart(new Date(placed), dayResetTime);
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
export function agendaBody(counts: AgendaCounts, use24Hour = false): string | null {
  const parts: string[] = [];
  if (counts.due > 0) parts.push(`${counts.due} due`);
  if (counts.carriedOver > 0) parts.push(`${counts.carriedOver} carried over`);
  if (counts.deadlines > 0) {
    parts.push(`${counts.deadlines} deadline${counts.deadlines === 1 ? '' : 's'}`);
  }
  // Last: the counts above are the app's own business, and a day of meetings
  // with no task on it is still a day worth a morning summary.
  if (counts.meetings) parts.push(meetingsPhrase(counts.meetings, use24Hour, false));
  // Dinner and birthdays are names rather than counts, so they get lines of
  // their own under the counts instead of more fragments between the dots.
  const lines = parts.length > 0 ? [parts.join(' · ')] : [];
  lines.push(...extraLines(counts));
  return lines.length > 0 ? lines.join('\n') : null;
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
export function agendaSpokenBody(counts: AgendaCounts, use24Hour = false): string | null {
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
  if (counts.meetings) parts.push(meetingsPhrase(counts.meetings, use24Hour, true));
  const sentences: string[] = [];
  if (parts.length > 0) sentences.push(`Today: ${joinSpoken(parts)}.`);
  if (counts.dinners && counts.dinners.length > 0) sentences.push(`Dinner is ${joinSpoken(counts.dinners)}.`);
  const names = counts.birthdays ?? [];
  if (names.length === 1) sentences.push(`It’s ${names[0]}’s birthday.`);
  else if (names.length > 1) sentences.push(`${joinSpoken(names)} have birthdays.`);
  return sentences.length > 0 ? sentences.join(' ') : null;
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
