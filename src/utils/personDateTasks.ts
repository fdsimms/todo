/**
 * The task a person's other dates put on the list: an anniversary, the day you
 * met, the day somebody starts a new job (`Person.dates`).
 *
 * It is the birthday generator (`birthdayTasks.ts`) with one more key in the
 * source id, and every rule is the birthday's, restated only where a date can
 * differ from a birthday:
 *
 * - **One task per date per year**, keyed `personId#dateId#year`. The birthday
 *   kind's `personId#year` can't carry a person with two dates in one year.
 * - **A one-off date happens once.** A date that isn't `yearly` is wanted only
 *   in its own year, and never again once it has passed.
 * - **It shares the birthday's switch, lead time and category.** To the person
 *   reading Settings an anniversary reminder is the same kind of row as a
 *   birthday reminder (see the `personDate` spec in `generatedTasks.ts`).
 * - **Deleting the task turns that date's `remind` off**, the permanent "no"
 *   `birthdayTaskOptOut` is for a birthday (`writeGeneratedOptOut`).
 * - **No cap, and nothing ranked**, for the reason `wantedBirthdayTasks` gives:
 *   every row names a real day that is about to happen.
 */
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { startOfDay } from 'date-fns/startOfDay';
import type { Person, PersonDate, Task } from '../types';
import { birthdayInYear, clampBirthdayLeadDays } from './birthdayTasks';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { primaryNickname } from './nicknames';

/** The labels the editor offers before a custom one. */
export const PERSON_DATE_PRESETS = ['Anniversary', 'Day we met'] as const;

/** The most dates one person can carry. */
export const MAX_PERSON_DATES = 20;

/** The longest label, in characters. */
export const PERSON_DATE_LABEL_MAX_LENGTH = 40;

/** One task per date per year; see the header. */
export function personDateSourceId(personId: string, dateId: string, year: number): string {
  return `${personId}#${dateId}#${year}`;
}

/** The person, date and year a personDate task speaks for, or null for any other task. */
export function parsePersonDateSource(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): { personId: string; dateId: string; year: number } | null {
  const raw = generatedSourceOf(task, 'personDate');
  if (!raw) return null;
  const parts = raw.split('#');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  const year = Number(parts[2]);
  if (!Number.isInteger(year)) return null;
  return { personId: parts[0], dateId: parts[1], year };
}

/** Whether a date names a real day of the year, and a year when it needs one. */
export function isWholePersonDate(date: Pick<PersonDate, 'month' | 'day' | 'year' | 'yearly'>): boolean {
  if (!(date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31)) return false;
  return date.yearly || date.year !== null;
}

/**
 * This date in a given year, at noon, with February 29 clamped to the 28th in
 * a common year. The birthday's own rule (`birthdayInYear`), reused rather than
 * restated so the two can't disagree about a leap day.
 */
export function personDateInYear(date: Pick<PersonDate, 'month' | 'day'>, year: number): Date | null {
  return birthdayInYear({ birthdayMonth: date.month, birthdayDay: date.day }, year);
}

/**
 * When this date next comes round, on or after `today`: this year's or next
 * year's for a yearly date, and its own year's or nothing for a one-off. On
 * the day itself counts as still to come, as it does for a birthday.
 */
export function nextPersonDate(
  date: Pick<PersonDate, 'month' | 'day' | 'year' | 'yearly'>,
  today: Date
): Date | null {
  if (!isWholePersonDate(date)) return null;
  if (!date.yearly) {
    const once = personDateInYear(date, date.year!);
    return once && differenceInCalendarDays(once, today) >= 0 ? once : null;
  }
  const thisYear = personDateInYear(date, today.getFullYear());
  if (!thisYear) return null;
  if (differenceInCalendarDays(thisYear, today) >= 0) return thisYear;
  return personDateInYear(date, today.getFullYear() + 1);
}

/**
 * The row's title: whose day it is, then what the day is ("Sam: Anniversary").
 * Not "Sam’s anniversary", the birthday's shape, because a label is whatever
 * the person typed and most of them don't read after a possessive ("Sam’s
 * started new job").
 */
export function personDateTitle(person: Pick<Person, 'name' | 'nickname'>, date: Pick<PersonDate, 'label'>): string {
  const who = primaryNickname(person.nickname) || person.name.trim();
  return `${who}: ${date.label.trim()}`;
}

/** One date that should have a task sitting on the list right now. */
export interface PersonDateWant {
  personId: string;
  dateId: string;
  year: number;
  sourceId: string;
  title: string;
  /** When the row surfaces: today, once the date is inside the window. */
  dueDate: Date;
  /** The date itself. */
  deadline: Date;
  phoneNumber: string | null;
}

/**
 * Which dates should have a task right now, soonest first.
 *
 * Skips what the birthday skips (an archived person, a business) plus a date
 * with `remind` off. `dueDate` is today rather than `leadDays` before the date,
 * for the reason `wantedBirthdayTasks` spells out: worked out backwards it
 * would date the row into the past whenever the app wasn't opened the day the
 * window opened.
 */
export function wantedPersonDateTasks(
  people: readonly Person[],
  leadDays: number,
  today: Date
): PersonDateWant[] {
  const lead = clampBirthdayLeadDays(leadDays);
  const wants: PersonDateWant[] = [];
  for (const person of people) {
    if (person.archived || person.kind === 'business') continue;
    for (const date of person.dates ?? []) {
      if (!date.remind || !date.label.trim()) continue;
      const when = nextPersonDate(date, today);
      if (!when) continue;
      if (differenceInCalendarDays(when, today) > lead) continue;
      const year = when.getFullYear();
      const dueDate = startOfDay(today);
      dueDate.setHours(12, 0, 0, 0);
      wants.push({
        personId: person.id,
        dateId: date.id,
        year,
        sourceId: personDateSourceId(person.id, date.id, year),
        title: personDateTitle(person, date),
        dueDate,
        deadline: when,
        phoneNumber: person.phoneNumber,
      });
    }
  }
  return wants.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

/**
 * The live rows whose reason has gone: the person or the date deleted,
 * archived, moved, or its reminder turned off. Judged by source id against the
 * wanted set, like `staleBirthdayTasks`.
 */
export function stalePersonDateTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(tasks: readonly T[], wants: readonly PersonDateWant[]): T[] {
  const wanted = new Set(wants.map(w => w.sourceId));
  return liveGeneratedTasksOfKind(tasks, 'personDate').filter(task => {
    const source = generatedSourceOf(task, 'personDate');
    return !source || !wanted.has(source);
  });
}

/**
 * Whether a live row's dates need rewriting: only when the date itself moved,
 * read off the deadline the row was written with, so a row the person deferred
 * stays deferred (`birthdayDrift`'s rule).
 */
export function personDateDrift(
  task: Pick<Task, 'deadline'>,
  want: PersonDateWant
): { dueDate: string; deadline: string } | null {
  const recorded = task.deadline ? startOfDay(new Date(task.deadline)).getTime() : null;
  if (recorded === startOfDay(want.deadline).getTime()) return null;
  return { dueDate: want.dueDate.toISOString(), deadline: want.deadline.toISOString() };
}

/**
 * A person's dates as the editor saves them: labels trimmed, and a date with no
 * label or no real day dropped, since neither has anything to remember. A
 * one-off still missing its year is kept, because the editor says so beside it
 * and the generator simply skips it until one is added.
 */
export function cleanPersonDates(dates: readonly PersonDate[]): PersonDate[] {
  return dates
    .map(d => ({ ...d, label: d.label.trim().slice(0, PERSON_DATE_LABEL_MAX_LENGTH) }))
    .filter(d => d.label && isWholePersonDate({ ...d, yearly: true }));
}

/**
 * A person's dates with one turned off or back on, for the opt-out a deleted
 * task writes and its undo. Returns null when nothing would change.
 */
export function withPersonDateRemind(
  dates: readonly PersonDate[] | undefined,
  dateId: string,
  remind: boolean
): PersonDate[] | null {
  const list = dates ?? [];
  const target = list.find(d => d.id === dateId);
  if (!target || target.remind === remind) return null;
  return list.map(d => (d.id === dateId ? { ...d, remind } : d));
}
