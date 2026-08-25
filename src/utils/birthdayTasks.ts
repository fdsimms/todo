import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { startOfDay } from 'date-fns/startOfDay';
import type { Person, Task } from '../types';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';

/**
 * Somebody's birthday, as a task — the first thing the people layer does
 * unprompted, and deliberately the gentlest thing it could do.
 *
 * See `docs/arch/people.md` for the rules this serves. The one that shapes this
 * file: nothing here measures a relationship or says anything about how it is
 * going. A birthday is a fact on a calendar, the same kind of fact a meal slot
 * is, and this generator knows nothing else about the person.
 *
 * **The only generator whose trigger is known years in advance.** Every other
 * one fires off something that just changed (a meal planned, a jar opened) or
 * off time passing against a window nobody chose (a project going quiet, a
 * pantry guess lapsing). This one knows the date already, which is what lets it
 * put the task *before* the thing it is about rather than after — and that lead
 * is the whole point, since a birthday you find out about on the day is one you
 * have already half missed.
 *
 * Pure, and takes `today` rather than reading the clock, so every rule here is
 * exercisable from the `node` test environment without standing up the settings
 * store. The firing pass supplies `getCurrentDayStart()`; see
 * `checkBirthdayTasks`.
 */

/**
 * Days before the birthday that the task surfaces.
 *
 * Three, because the row exists so there is time to do something — buy a card,
 * book a table, get a present posted — and none of those is a same-day job. It
 * is not longer because a task that sits on Today for a fortnight stops being
 * read; `dueDate` is what moves with this setting, while `deadline` stays the
 * birthday itself, so the day never drifts however this is set.
 */
export const DEFAULT_BIRTHDAY_LEAD_DAYS = 3;

/** Nothing above a month: past that the row is furniture rather than a prompt. */
export const MAX_BIRTHDAY_LEAD_DAYS = 30;

/** Zero is allowed and means "on the day itself". */
export function clampBirthdayLeadDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_BIRTHDAY_LEAD_DAYS;
  return Math.min(MAX_BIRTHDAY_LEAD_DAYS, Math.max(0, Math.round(days)));
}

/**
 * The stored setting, as a number — the read half, and deliberately not just
 * `clampBirthdayLeadDays(Number(raw))`.
 *
 * `Number(null)` and `Number('')` are **0**, not `NaN`, so a clamp alone reads
 * "nothing stored" as a deliberate zero and every install that had never
 * touched the setting would get its birthday tasks on the morning of the
 * birthday. Zero is a real answer somebody can choose, so the two cases have to
 * be told apart before the string becomes a number rather than after.
 */
export function parseBirthdayLeadDays(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_BIRTHDAY_LEAD_DAYS;
  return clampBirthdayLeadDays(Number(raw));
}

/**
 * What a birthday task carries in `generatedSourceId`: the person, and the year
 * the birthday falls in.
 *
 * A composite source id, the same idea `mealSlot` uses for `2026-08-22#lunch`,
 * and it is what makes "one task per person per year" true by construction
 * rather than by a rule somebody has to remember. Without the year the second
 * year's task would be blocked by the first year's completed row, and the
 * feature would work exactly once.
 */
export function birthdaySourceId(personId: string, year: number): string {
  return `${personId}#${year}`;
}

/** The person and year a birthday task speaks for, or null for any other task. */
export function parseBirthdaySource(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): { personId: string; year: number } | null {
  const raw = generatedSourceOf(task, 'birthday');
  if (!raw) return null;
  const at = raw.lastIndexOf('#');
  if (at <= 0) return null;
  const year = Number(raw.slice(at + 1));
  if (!Number.isInteger(year)) return null;
  return { personId: raw.slice(0, at), year };
}

/** Whether this person has a birthday on file at all. Both halves or neither. */
export function hasBirthday(
  person: Pick<Person, 'birthdayMonth' | 'birthdayDay'>
): boolean {
  const { birthdayMonth: m, birthdayDay: d } = person;
  return m !== null && d !== null && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * The birthday's date in a given year.
 *
 * **February 29 clamps to the 28th in a common year, and that clamp can never
 * accumulate** — which is the entire reason `Person` stores a month and a day
 * rather than a date. `recurrenceAnchorDay` exists because a stored *date*
 * clamped by `addMonths` feeds the next clamp (Jan 31 becomes Feb 28 becomes
 * Mar 28, for ever, off a single February). Anchoring to the numbers the user
 * typed makes that impossible here: 2027 is computed from (2, 29) again, not
 * from what 2026 resolved to.
 *
 * Returns null for a person with no birthday on file.
 */
export function birthdayInYear(
  person: Pick<Person, 'birthdayMonth' | 'birthdayDay'>,
  year: number
): Date | null {
  if (!hasBirthday(person)) return null;
  const month = person.birthdayMonth! - 1;
  // Day 0 of the *next* month is the last day of this one, which is how the
  // clamp is expressed without a leap-year branch.
  const lastOfMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(person.birthdayDay!, lastOfMonth);
  // Noon, not midnight, for the reason ParsedSchedule gives: a midnight
  // timestamp can slip into the previous logical day under a dayResetTime after
  // 00:00, and a birthday landing a day early is the one thing this must not do.
  return new Date(year, month, day, 12, 0, 0, 0);
}

/**
 * The next time this birthday comes round, on or after `today`.
 *
 * On the day itself counts as still to come: the task should not vanish at
 * 00:01 on somebody's actual birthday, which is the moment it is most wanted.
 */
export function nextBirthday(
  person: Pick<Person, 'birthdayMonth' | 'birthdayDay'>,
  today: Date
): Date | null {
  const thisYear = birthdayInYear(person, today.getFullYear());
  if (!thisYear) return null;
  if (differenceInCalendarDays(thisYear, today) >= 0) return thisYear;
  return birthdayInYear(person, today.getFullYear() + 1);
}

/** How old they are turning, or null when the year isn't on file — which is normal. */
export function ageTurning(
  person: Pick<Person, 'birthYear'>,
  birthdayYear: number
): number | null {
  if (person.birthYear === null || !Number.isInteger(person.birthYear)) return null;
  const age = birthdayYear - person.birthYear;
  return age > 0 && age < 150 ? age : null;
}

/**
 * The row's title.
 *
 * Names whose birthday it is and stops there. Deliberately not "Wish Ansley a
 * happy birthday": the row lands three days early precisely because what to do
 * about it might be a card, a table booked, or a present posted, and a title
 * that picks one of those is wrong two times in three. It also has to read
 * correctly with no meta line beside it, on the widget, in Search and in the
 * Logbook — the standard `projectReviewTitle` sets.
 *
 * Always "'s", including after a name ending in s ("Chris's birthday"), which
 * is the American convention the rest of the app's copy follows.
 */
export function birthdayTitle(person: Pick<Person, 'name' | 'nickname'>): string {
  const who = person.nickname.trim() || person.name.trim();
  return `${who}'s birthday`;
}

/** The row's chip: "Turning 34", or nothing at all when the year isn't known. */
export function describeBirthdayAge(age: number | null): string | null {
  return age === null ? null : `Turning ${age}`;
}

/** What a birthday task carries in `linkUrl`: the person it is about. */
export const PEOPLE_LINK_URL = 'dundundun://people';

/**
 * The link one birthday task carries — that person's own screen, where their
 * number, their notes and (from #2045) the history live.
 *
 * A query string rather than a path segment, the form `mealPlanNudgeLinkUrl`
 * and `projectReviewLinkUrl` already established for this scheme. Falls back to
 * the bare link for an empty id, so a malformed call can't mint a URL that
 * scopes to nobody.
 */
export function personLinkUrl(personId: string): string {
  return personId ? `${PEOPLE_LINK_URL}?person=${personId}` : PEOPLE_LINK_URL;
}

/** One person who should have a birthday task sitting on the list right now. */
export interface BirthdayWant {
  personId: string;
  year: number;
  sourceId: string;
  title: string;
  /** When the row surfaces: `leadDays` before the birthday. */
  dueDate: Date;
  /** The birthday itself, which is the thing that can't be moved. */
  deadline: Date;
  /** Copied onto the task so the row's own call and text buttons work. */
  phoneNumber: string | null;
}

/**
 * Which people should have a birthday task right now, soonest first.
 *
 * **There is no cap here, unlike every other generator**, and the asymmetry is
 * the point. A cap exists elsewhere because the qualifying set is open-ended
 * and mostly arbitrary — a dozen parked projects, a whole catalog of groceries
 * whose guesses lapsed on the same launch — so metering it out is the only way
 * the list stays readable. Birthdays are neither: they are spread across a year
 * by nature, the window is a few days wide, and every row in the set names a
 * real date that is genuinely about to happen. Three friends born in the same
 * week should produce three tasks, because that week really does have three
 * birthdays in it, and dropping one would be the app quietly deciding which
 * friend matters least. That is the exact thing `docs/arch/people.md` forbids.
 */
export function wantedBirthdayTasks(
  people: readonly Person[],
  leadDays: number,
  today: Date
): BirthdayWant[] {
  const lead = clampBirthdayLeadDays(leadDays);
  const wants: BirthdayWant[] = [];
  for (const person of people) {
    if (person.archived || person.birthdayTaskOptOut) continue;
    const date = nextBirthday(person, today);
    if (!date) continue;
    const away = differenceInCalendarDays(date, today);
    // Outside the window: the birthday is real but it is not yet this task's
    // business. Without this every person on file would carry a row all year.
    if (away > lead) continue;
    const year = date.getFullYear();
    // Today, always — not `lead` days before the birthday, which sounds like
    // the same thing and isn't. The window above is what decides *whether* the
    // row exists, so by the time we get here the birthday is at most `lead`
    // days off and the row wants to be seen now. Computing it backwards from
    // the birthday would date it into the past whenever the app wasn't opened
    // on the exact day the window opened (a weekend away, a flat battery), and
    // `isTaskVisible` would render a birthday that hasn't happened yet as
    // overdue. `deadline` carries the real date; this only says when to look.
    const dueDate = startOfDayNoon(today);
    wants.push({
      personId: person.id,
      year,
      sourceId: birthdaySourceId(person.id, year),
      title: birthdayTitle(person),
      dueDate,
      deadline: date,
      phoneNumber: person.phoneNumber,
    });
  }
  return wants.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

/** Noon on the given day, matching what `birthdayInYear` returns. */
function startOfDayNoon(day: Date): Date {
  const d = startOfDay(day);
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * The birthday tasks sitting there whose reason has gone.
 *
 * A birthday task outlives its reason in ways the other generators' don't: the
 * person can be deleted, archived, have their birthday cleared or corrected to
 * a different date entirely. All four leave a row on Today naming a day that is
 * no longer anybody's birthday, and none of those mutations knows the row is
 * there — which is why this runs on a sweep, the same argument
 * `staleProjectReviewTasks` makes.
 *
 * Judged against the wanted set by source id, so a row for last year's birthday
 * is stale the moment the window closes on it, and a row whose person changed
 * their date is stale because the new date has a different `deadline` (see
 * `driftedBirthdayTasks`) rather than because it stopped being wanted.
 */
export function staleBirthdayTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(tasks: readonly T[], wants: readonly BirthdayWant[]): T[] {
  const wanted = new Set(wants.map(w => w.sourceId));
  return liveGeneratedTasksOfKind(tasks, 'birthday').filter(task => {
    const source = generatedSourceOf(task, 'birthday');
    return !source || !wanted.has(source);
  });
}

/**
 * Whether a live row's dates need rewriting, and to what.
 *
 * **The date is chased only when the birthday itself moved**, which is the rule
 * `docs/arch/generated-tasks.md` states for every generator and the one that
 * cost #1953 to learn: a reconcile that recomputes a date from anything other
 * than its source silently overwrites the field the user is most likely to have
 * changed by hand. Deferring one of these rows is the main thing anyone does to
 * it, and the app should not undo that at the next launch.
 *
 * The comparison is against the task's own `deadline`, which is the field
 * recording the birthday the day was last derived from — exactly how
 * `groceryUseUp` reads `expiresAt` off the deadline it wrote. So a corrected
 * birthday moves the row, and a lead-time setting change does not.
 */
export function birthdayDrift(
  task: Pick<Task, 'deadline'>,
  want: BirthdayWant
): { dueDate: string; deadline: string } | null {
  const recorded = task.deadline ? startOfDay(new Date(task.deadline)).getTime() : null;
  const wanted = startOfDay(want.deadline).getTime();
  if (recorded === wanted) return null;
  // ISO, because these go straight onto the task — dates are stored and passed
  // as ISO strings everywhere in this app.
  return { dueDate: want.dueDate.toISOString(), deadline: want.deadline.toISOString() };
}
