import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project } from '../types';
import { formatDeadlineDate, getDayStart, getTaskDayStart } from './dateUtils';
import { roundSunLocation } from './sunTimes';

/**
 * A project's away dates — when you leave and when you are back.
 *
 * The reads over `Project.awayStart` / `awayEnd`, kept in one place so the
 * card, the editor and the look-ahead sheet cannot each decide slightly
 * differently what a half-entered span means. See `docs/arch/away-dates.md`
 * for the design this is the first slice of; the rules that matter here:
 *
 * **The two fields are not a symmetric pair.** `awayEnd` is ignored unless
 * `awayStart` is set and the end is not before it — the same refusal shape
 * `effectiveWindowEnd()` uses for `windowStart`/`windowEnd`, and for the same
 * reason: a half-set range that still answers questions is how a reader ends
 * up deciding something about a span nobody entered.
 *
 * **A start with no end is legal and means something.** It is exactly
 * `LookAheadWindow`'s `awayEnd: null` case, which that module describes as
 * knowing a boundary but not a trip. So `awaySpanOf` returns a span with a
 * null end rather than no span at all, and every reader here says less about
 * it rather than nothing.
 *
 * **The bounds are asymmetric, following `lookAhead`.** The day you leave
 * counts as away (that module's cutoff is exclusive for the same reason: "the
 * day you leave is not a day you have"), and the day you are back does not.
 * So containment is `start <= day < end`.
 */

/** A project's away dates, once the half-set rules above have been applied. */
export interface AwaySpan {
  /** The day you leave. Always set — a span with no start is no span. */
  start: Date;
  /** The day you are back, or null for a departure with no return yet. */
  end: Date | null;
}

/** Which side of the span today is on. */
export type AwayPhase = 'before' | 'during' | 'over';

export interface AwayStatus {
  phase: AwayPhase;
  /** Calendar days from today to departure. 0 is today, negative once gone. */
  daysUntilStart: number;
  /** Calendar days from today to the return day, null without an end. */
  daysUntilEnd: number | null;
}

/**
 * Midday on the given day, as the ISO string both columns store.
 *
 * Noon rather than midnight so a span entered at home and read after a flight
 * cannot move by a calendar day — the same reason `getLogicalToday()` returns
 * noon and calls it safe for display. Nine hours either side of midday is
 * still the same date; nine hours either side of midnight is not.
 */
export function awayNoonIso(date: Date): string {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  return noon.toISOString();
}

/**
 * The Leaving date a date answer gives a project, or null to leave it alone.
 *
 * "Pick dates for Lisbon" answered with the 14th: the task opted in
 * (`Task.deliverableSetsAway`), so the trip leaves on the 14th. Only ever
 * fills an empty Leaving date, never moves one somebody set, and refuses a
 * day after an existing Coming back rather than write a span that ends before
 * it starts.
 */
export function departureFromAnswer(
  project: Pick<Project, 'awayStart' | 'awayEnd'>,
  answer: Date | null,
): string | null {
  if (!answer || project.awayStart) return null;
  if (project.awayEnd && getDayStart(answer).getTime() > getDayStart(new Date(project.awayEnd)).getTime()) return null;
  return awayNoonIso(answer);
}

/**
 * The Leaving date to offer moving to, when a project already has one and a
 * date answer (re-answered, or edited later) names a different day. Null when
 * there's nothing to move: no answer, no Leaving date yet (that's
 * departureFromAnswer's to fill), the same day, or a day after Coming back.
 * Offered, never written on its own: this is a date somebody set.
 */
export function departureMoveFromAnswer(
  project: Pick<Project, 'awayStart' | 'awayEnd'>,
  answer: Date | null,
): string | null {
  if (!answer || !project.awayStart) return null;
  if (getDayStart(answer).getTime() === getDayStart(new Date(project.awayStart)).getTime()) return null;
  if (project.awayEnd && getDayStart(answer).getTime() > getDayStart(new Date(project.awayEnd)).getTime()) return null;
  return awayNoonIso(answer);
}

/**
 * The span this project actually has, or null if it has none.
 *
 * An `awayEnd` without an `awayStart` is dropped rather than promoted: on its
 * own it is indistinguishable from `deadline`, which the project already has a
 * field and a label for.
 */
export function awaySpanOf(
  project: Pick<Project, 'awayStart' | 'awayEnd'>,
  dayResetTime?: string,
): AwaySpan | null {
  if (!project.awayStart) return null;
  const start = getTaskDayStart(new Date(project.awayStart), dayResetTime);
  if (!project.awayEnd) return { start, end: null };
  const end = getTaskDayStart(new Date(project.awayEnd), dayResetTime);
  // An end on or before the start is not a shorter trip, it is a typo or a
  // row from a peer that got it wrong. Keep the departure and forget the rest.
  return { start, end: end > start ? end : null };
}

/**
 * Every live project's span. Archived and completed projects are history, not
 * schedule; a span already over is kept, since a reader looking back is
 * entitled to say you were away.
 */
export function liveAwaySpans(
  projects: readonly Pick<Project, 'awayStart' | 'awayEnd' | 'archived' | 'completed'>[],
  dayResetTime?: string,
): AwaySpan[] {
  const spans: AwaySpan[] = [];
  for (const project of projects) {
    if (project.archived || project.completed) continue;
    const span = awaySpanOf(project, dayResetTime);
    if (span) spans.push(span);
  }
  return spans;
}

/** Whether `date` falls inside the span: on or after departure, before the return. */
export function isAwayDay(span: AwaySpan | null, date: Date, dayResetTime?: string): boolean {
  if (!span) return false;
  // Both sides are normalised, not just the day being asked about. `awaySpanOf`
  // already hands back anchored bounds, but `buildDayLoads` takes spans from
  // whoever calls it, and a span built straight from two picked dates carries
  // whatever time of day they had — against which an anchored day sits *before*
  // its own departure, and the day you leave silently stops counting.
  const day = getTaskDayStart(date, dayResetTime);
  const start = getTaskDayStart(span.start, dayResetTime);
  if (day < start) return false;
  // Without a return date the only day known to be away is the departure. The
  // honest alternative — "away forever" — would have every reader here treat
  // an unfinished span as an open-ended absence.
  if (!span.end) return day.getTime() === start.getTime();
  return day < getTaskDayStart(span.end, dayResetTime);
}

/** Nights away, the count `templateQuestions.answerFromDates` means by 'nights'. */
export function awayNights(span: AwaySpan | null): number | null {
  if (!span?.end) return null;
  return differenceInCalendarDays(span.end, span.start);
}

/** Where today sits relative to the span, or null when there isn't one. */
export function awayStatus(
  span: AwaySpan | null,
  now: Date = new Date(),
  dayResetTime?: string,
): AwayStatus | null {
  if (!span) return null;
  const today = getDayStart(now, dayResetTime);
  const daysUntilStart = differenceInCalendarDays(span.start, today);
  const daysUntilEnd = span.end ? differenceInCalendarDays(span.end, today) : null;
  const phase: AwayPhase =
    daysUntilStart > 0
      ? 'before'
      : daysUntilEnd !== null && daysUntilEnd <= 0
        ? 'over'
        : 'during';
  return { phase, daysUntilStart, daysUntilEnd };
}

/**
 * The one line the project card shows for its span, or null for nothing to say.
 *
 * Literal, in the register the rest of the app's rows use: it states when you
 * leave or when you are back, and nothing else. `formatDeadlineDate` does the
 * date, so "Back Tomorrow" capitalises the same way the rest of the app's
 * dates do rather than inventing a second style beside it.
 *
 * A finished trip says nothing. The project is still there to be completed or
 * archived like any other, and a card captioned with a date that has been and
 * gone is noise on every row that ever went anywhere.
 */
export function describeAwaySpan(
  project: Pick<Project, 'awayStart' | 'awayEnd'>,
  now: Date = new Date(),
  dayResetTime?: string,
): string | null {
  const span = awaySpanOf(project, dayResetTime);
  const status = awayStatus(span, now, dayResetTime);
  if (!span || !status) return null;
  if (status.phase === 'over') return null;
  if (status.phase === 'before') {
    if (status.daysUntilStart === 1) return 'Leaves tomorrow';
    return `Leaves in ${status.daysUntilStart} days`;
  }
  // Away now. With no return date there is no second half to say, and
  // guessing one would be the "away forever" reading isAwayDay refuses.
  if (!project.awayEnd || !span.end) return 'Away';
  return `Back ${formatDeadlineDate(span.end.toISOString(), dayResetTime)}`;
}

/**
 * The trip a reader means when they say "my trip": the one happening now, or
 * the next one coming up.
 *
 * Archived and completed projects are skipped, and so is a span that is over —
 * all three are history rather than schedule, the same cut `applyTaskDates`
 * makes when it reconciles a series. A trip in progress beats one still ahead,
 * because a reader standing inside a span is not asking about the next one.
 * Ties among upcoming trips go to the earlier departure; ties on the same day
 * go to `sortOrder`, the hand drag on the Projects screen, for the reason
 * `weekendTasks` breaks its own tie there: it is the only ranking of these the
 * user actually made.
 */
export function nextAwayProject<T extends Pick<Project, 'awayStart' | 'awayEnd' | 'archived' | 'completed' | 'sortOrder'>>(
  projects: readonly T[],
  now: Date = new Date(),
  dayResetTime?: string,
): { project: T; span: AwaySpan } | null {
  const live: { project: T; span: AwaySpan; phase: AwayPhase }[] = [];
  for (const project of projects) {
    if (project.archived || project.completed) continue;
    const span = awaySpanOf(project, dayResetTime);
    if (!span) continue;
    const status = awayStatus(span, now, dayResetTime);
    if (!status || status.phase === 'over') continue;
    live.push({ project, span, phase: status.phase });
  }
  if (live.length === 0) return null;
  live.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === 'during' ? -1 : 1;
    const byStart = a.span.start.getTime() - b.span.start.getTime();
    if (byStart !== 0) return byStart;
    return a.project.sortOrder - b.project.sortOrder;
  });
  const best = live[0];
  return { project: best.project, span: best.span };
}

/**
 * Whether this project is a live trip covering `now`.
 *
 * The "still schedule rather than history" cut `nextAwayProject` makes, asked
 * about one project instead of ranked across many: archived and completed
 * projects are out, and so is a project whose span does not reach today.
 */
export function isProjectAwayNow<T extends Pick<Project, 'awayStart' | 'awayEnd' | 'archived' | 'completed'>>(
  project: T,
  now: Date = new Date(),
  dayResetTime?: string,
): boolean {
  if (project.archived || project.completed) return false;
  return isAwayDay(awaySpanOf(project, dayResetTime), now, dayResetTime);
}

/**
 * The project whose nominated pause is in force right now, or null.
 *
 * The whole of "am I meant to be paused because I am away" in one pure call,
 * so the pass that arms vacation mode (`checkAwayVacation`) and the gate that
 * has to answer the same question *before* that pass has run (expiry, see
 * `isTaskExpired`) cannot read the nomination two slightly different ways.
 *
 * Three conditions, all of them the "nominated, never inferred" rule: the
 * project opted in (`awayPauses`), its span covers today, and the user has not
 * already turned this trip's pause off by hand (`awayPauseDeclinedFor`).
 */
export function awayPauseDriver<T extends Pick<Project, 'awayStart' | 'awayEnd' | 'awayPauses' | 'awayPauseDeclinedFor' | 'archived' | 'completed'>>(
  projects: readonly T[],
  now: Date = new Date(),
  dayResetTime?: string,
): T | null {
  return projects.find(p =>
    p.awayPauses &&
    p.awayPauseDeclinedFor !== p.awayStart &&
    isProjectAwayNow(p, now, dayResetTime),
  ) ?? null;
}

/**
 * The trip whose shopping list should be the one on screen right now, or null.
 *
 * `awayPauseDriver` for lists rather than for vacation mode — same three
 * conditions in the same order, because it is the same question with a
 * different nomination: the project named a list (`awayListId`), its span
 * covers today, and the user has not already switched off that list for this
 * trip (`awayListDeclinedFor`).
 *
 * It is deliberately two functions rather than one parameterised over the
 * field. They are separate opt-ins on purpose — a trip that pauses your tasks
 * is not necessarily a trip you shop for, and a template may set neither (see
 * TaskTemplate.anchorsAreAway) — so collapsing them would suggest a coupling
 * the design spent a paragraph refusing.
 */
export function awayListDriver<T extends Pick<Project, 'awayStart' | 'awayEnd' | 'awayListId' | 'awayListDeclinedFor' | 'archived' | 'completed'>>(
  projects: readonly T[],
  now: Date = new Date(),
  dayResetTime?: string,
): T | null {
  return projects.find(p =>
    p.awayListId !== null &&
    p.awayListDeclinedFor !== p.awayStart &&
    isProjectAwayNow(p, now, dayResetTime),
  ) ?? null;
}

/**
 * Where a leaf module gets the project list from, without importing the store.
 *
 * The `blockerRegistry` / `peopleRegistry` shape, for their exact reason:
 * `useProjectStore` reaches `src/db/database.ts` and therefore expo-sqlite,
 * which does not exist under Jest's `node` environment, and the one reader
 * that needs this (`isTaskExpired`, in `visibilityUtils.ts`) sits underneath
 * roughly the whole app. So the store pushes a getter in here at module load,
 * and this module — which imports nothing but types and date helpers — hands
 * the answer back on demand.
 *
 * Resolve-or-shrug like the others: with no source registered the answer is
 * "no trip", which fails toward the behaviour that existed before any of this
 * did rather than toward sparing rows nobody asked to spare.
 */
type AwayProject = Pick<Project, 'awayStart' | 'awayEnd' | 'awayPauses' | 'awayPauseDeclinedFor' | 'archived' | 'completed' | 'destinationLatitude' | 'destinationLongitude'>;

let awayProjectSource: (() => readonly AwayProject[]) | null = null;

/** Called once by useProjectStore at module load. Tests can point it at a fixture. */
export function registerAwayProjectSource(fn: (() => readonly AwayProject[]) | null): void {
  awayProjectSource = fn;
}

/** Whether a nominated pause is in force right now, per the registered source. */
export function isAwayPauseInForce(now: Date = new Date(), dayResetTime?: string): boolean {
  const projects = awayProjectSource?.();
  if (!projects) return false;
  return awayPauseDriver(projects, now, dayResetTime) !== null;
}

type TripPlace = Pick<Project, 'awayStart' | 'awayEnd' | 'archived' | 'completed' | 'destinationLatitude' | 'destinationLongitude'>;

/**
 * Where the sun is worked out for on a day a trip covers: the destination's
 * coordinates of a live trip whose span holds `date`, or null when no such trip
 * has any (no trip that day, a destination nobody has looked up yet, or one no
 * geocoder knows). Overlapping trips go to the one that started first, the
 * order `nextAwayProject` already ranks them in.
 *
 * Only a planning read, like every other reader of the span: it moves when a
 * window opens, and never whether a task may be done.
 */
export function tripPlaceOn(
  projects: readonly TripPlace[],
  date: Date,
  dayResetTime?: string,
): { latitude: number; longitude: number } | null {
  let best: TripPlace | null = null;
  for (const p of projects) {
    if (p.destinationLatitude == null || p.destinationLongitude == null) continue;
    if (!isProjectAwayNow(p, date, dayResetTime)) continue;
    if (!best || (p.awayStart ?? '') < (best.awayStart ?? '')) best = p;
  }
  return best ? { latitude: best.destinationLatitude!, longitude: best.destinationLongitude! } : null;
}

/** `tripPlaceOn` over the registered project source. */
export function tripSunLocationOn(date: Date, dayResetTime?: string): { latitude: number; longitude: number } | null {
  const projects = awayProjectSource?.();
  if (!projects) return null;
  return tripPlaceOn(projects, date, dayResetTime);
}

/**
 * What else an update to a project has to write when it changes the
 * destination: the coordinates go with the old text, unless the patch names
 * them itself (the trip page writing what it just looked up). Kept with the
 * words they came from, they can never describe a place the trip no longer
 * says it is going to. See Project.destinationLatitude.
 */
export function destinationPinFields(
  project: Pick<Project, 'destination'>,
  patch: Partial<Pick<Project, 'destination' | 'destinationLatitude' | 'destinationLongitude'>>,
): Partial<Pick<Project, 'destinationLatitude' | 'destinationLongitude'>> {
  if (!('destination' in patch)) return {};
  if ('destinationLatitude' in patch || 'destinationLongitude' in patch) return {};
  if ((patch.destination ?? null) === (project.destination ?? null)) return {};
  return { destinationLatitude: null, destinationLongitude: null };
}

/**
 * The patch that keeps a trip's coordinates in step with a geocode of its
 * destination, or null when there is nothing to write: the destination has
 * changed since the lookup was asked (the answer is about words the trip no
 * longer says), or the rounded coordinates are already the stored ones, so a
 * page opened again doesn't rewrite the row and restamp it for sync.
 */
export function destinationPinUpdate(
  project: Pick<Project, 'destination' | 'destinationLatitude' | 'destinationLongitude'>,
  askedFor: string,
  place: { latitude: number; longitude: number },
): Pick<Project, 'destinationLatitude' | 'destinationLongitude'> | null {
  if ((project.destination ?? null) !== askedFor) return null;
  const { latitude, longitude } = roundSunLocation(place);
  if (project.destinationLatitude === latitude && project.destinationLongitude === longitude) return null;
  return { destinationLatitude: latitude, destinationLongitude: longitude };
}
