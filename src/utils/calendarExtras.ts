import type { MealPlanEntry, Person, Project, Task } from '../types';
import { dayKeyOf, getLogicalDayKey } from './dateUtils';
import { awaySpanOf, isAwayDay, type AwaySpan } from './awayDates';
import { birthdayInYear, birthdayTitle } from './birthdayTasks';
import { entriesForDay } from './mealPlan';
import { isMissed } from './missed';

/**
 * Everything the Calendar screen shows on a day that isn't a task's own date.
 *
 * The task buckets (`calendarMonth.ts`) answer "what lands on this day"; this
 * answers "what else was the app already holding about it": the trip you're on,
 * the meals planned, whose birthday it is, which project is due, and what got
 * done. Each one has its own home elsewhere in the app, and nothing here writes
 * or derives anything new: it is a read over dates that already exist, the
 * same shape the month grid itself is.
 *
 * Kept apart from the task buckets on purpose. A bucket's marks are task rows
 * and projections, and `dayLoad`, the dots and the outstanding counts all read
 * them as work. None of these is work landing on the day (a completion is work
 * already done), so folding them in would put them into every one of those.
 */

/** A project's away span, named, for the trip band and the day's list. */
export interface CalendarTrip {
  projectId: string;
  name: string;
  span: AwaySpan;
}

export interface DayExtras {
  key: string;
  trips: { projectId: string; name: string }[];
  /** In slot order, the same order Meal Plan draws a day in. */
  meals: MealPlanEntry[];
  /** Titled with `birthdayTitle`, so the calendar names it the way the task does. */
  birthdays: { personId: string; title: string }[];
  projectDeadlines: { projectId: string; name: string }[];
  /** Top-level tasks completed on this logical day, newest first. */
  completedIds: string[];
}

/**
 * Every live project's away span, named.
 *
 * Archived and completed projects are left out, the rule the grid's weight cue
 * already applied: a trip you filed away shouldn't keep drawing a band.
 */
export function calendarTrips(projects: readonly Project[], dayResetTime?: string): CalendarTrip[] {
  const trips: CalendarTrip[] = [];
  for (const project of projects) {
    if (project.archived || project.completed) continue;
    const span = awaySpanOf(project, dayResetTime);
    if (span) trips.push({ projectId: project.id, name: project.title, span });
  }
  return trips;
}

export interface DayExtrasInput {
  trips: readonly CalendarTrip[];
  /** Any superset of the grid's meals; filtered to its days here. */
  meals: readonly MealPlanEntry[];
  people: readonly Person[];
  projects: readonly Project[];
  tasks: readonly Task[];
  dayResetTime?: string;
}

/**
 * Bucket the extras onto the days of a grid, once. A day with none of them
 * has no entry, like `buildDayBuckets`.
 */
export function buildDayExtras(
  days: readonly Date[],
  input: DayExtrasInput,
): Map<string, DayExtras> {
  const { trips, meals, people, projects, tasks, dayResetTime } = input;
  const out = new Map<string, DayExtras>();
  if (days.length === 0) return out;
  const keys = days.map(dayKeyOf);
  const inGrid = new Set(keys);
  const at = (key: string): DayExtras => {
    let extras = out.get(key);
    if (!extras) {
      extras = { key, trips: [], meals: [], birthdays: [], projectDeadlines: [], completedIds: [] };
      out.set(key, extras);
    }
    return extras;
  };

  // Per day rather than per span, through `isAwayDay`, so the band and the
  // weight cue can never disagree about which days a trip covers (the return
  // day isn't one, and a trip with no return date covers only its departure).
  days.forEach((day, i) => {
    for (const trip of trips) {
      if (isAwayDay(trip.span, day, dayResetTime)) {
        at(keys[i]).trips.push({ projectId: trip.projectId, name: trip.name });
      }
    }
  });

  for (const key of keys) {
    const dayMeals = entriesForDay(meals, key);
    if (dayMeals.length > 0) at(key).meals = dayMeals;
  }

  // A grid can straddle a new year, so every year it touches is asked.
  const years = new Set(days.map(d => d.getFullYear()));
  for (const person of people) {
    if (person.archived) continue;
    for (const year of years) {
      const date = birthdayInYear(person, year);
      if (!date) continue;
      const key = dayKeyOf(date);
      if (inGrid.has(key)) at(key).birthdays.push({ personId: person.id, title: birthdayTitle(person) });
    }
  }

  for (const project of projects) {
    if (project.archived || project.completed || !project.deadline) continue;
    const key = dayKeyOf(new Date(project.deadline));
    if (inGrid.has(key)) at(key).projectDeadlines.push({ projectId: project.id, name: project.title });
  }

  // On the logical day it was completed, the way Logbook groups it: a task
  // ticked at 1 AM under a 2 AM reset was done on the evening before. Missed
  // rows are completed in the schema but weren't done, so they stay out.
  // Filtered to the grid before sorting: the task list holds every
  // completion ever kept, and a month wants a few dozen of them.
  const done: { id: string; time: number; key: string }[] = [];
  for (const t of tasks) {
    if (!t.completed || !t.completedAt || t.parentId || t.archived || isMissed(t)) continue;
    const time = Date.parse(t.completedAt);
    const key = getLogicalDayKey(new Date(time), dayResetTime);
    if (inGrid.has(key)) done.push({ id: t.id, time, key });
  }
  done.sort((a, b) => b.time - a.time);
  for (const { id, key } of done) at(key).completedIds.push(id);

  return out;
}

/** Whether the "On this day" card has anything to say. Completions are rows, not card lines. */
export function hasDayNotes(extras: DayExtras | undefined, includeMeals: boolean): boolean {
  if (!extras) return false;
  return extras.trips.length > 0
    || extras.birthdays.length > 0
    || extras.projectDeadlines.length > 0
    || (includeMeals && extras.meals.length > 0);
}

/**
 * The completed rows for a day's "Completed" section: the day's completions
 * minus any task the day's lists already show. A task due today and ticked
 * today is already on the day as a done row; listing it twice would read as
 * two tasks.
 */
export function completedRows(
  extras: DayExtras | undefined,
  alreadyShown: readonly Task[],
  taskById: ReadonlyMap<string, Task>,
): Task[] {
  if (!extras) return [];
  const shown = new Set(alreadyShown.map(t => t.id));
  const out: Task[] = [];
  for (const id of extras.completedIds) {
    if (shown.has(id)) continue;
    const task = taskById.get(id);
    if (task) out.push(task);
  }
  return out;
}

export interface TripBandSegment {
  projectId: string;
  name: string;
  /** Column (0..6) the segment starts in, within its week row. */
  startCol: number;
  /** How many columns it covers. */
  span: number;
  /** The trip started before this row, so the left end is open. */
  continuesBefore: boolean;
  /** The trip carries on past this row, so the right end is open. */
  continuesAfter: boolean;
}

/**
 * One week row's trip bands, in lanes: each lane a list of segments that don't
 * overlap. Two trips that share a day (a weekend away inside a longer one) get
 * a lane each rather than drawing over each other.
 *
 * Reads the coverage `buildDayExtras` already worked out rather than asking
 * `isAwayDay` again, so the band covers exactly the days the list names. A trip
 * with a gap inside one row can't happen (a span is contiguous), but a run is
 * still found by walking the columns rather than assumed.
 */
export function tripBandLanes(
  weekKeys: readonly string[],
  extras: ReadonlyMap<string, DayExtras>,
  /** The days either side of the row, to say whether a band continues. */
  beforeKey: string | null,
  afterKey: string | null,
): TripBandSegment[][] {
  const onDay = (key: string | null, projectId: string): boolean =>
    key !== null && (extras.get(key)?.trips.some(t => t.projectId === projectId) ?? false);

  const segments: TripBandSegment[] = [];
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const key of weekKeys) {
    for (const trip of extras.get(key)?.trips ?? []) {
      if (!names.has(trip.projectId)) {
        names.set(trip.projectId, trip.name);
        order.push(trip.projectId);
      }
    }
  }

  for (const projectId of order) {
    let col = 0;
    while (col < weekKeys.length) {
      if (!onDay(weekKeys[col], projectId)) { col += 1; continue; }
      const startCol = col;
      while (col < weekKeys.length && onDay(weekKeys[col], projectId)) col += 1;
      segments.push({
        projectId,
        name: names.get(projectId)!,
        startCol,
        span: col - startCol,
        continuesBefore: startCol === 0 && onDay(beforeKey, projectId),
        continuesAfter: col === weekKeys.length && onDay(afterKey, projectId),
      });
    }
  }

  // Earliest start first, then the longer one, so a long trip keeps the top
  // lane and a short one inside it drops below rather than the other way round.
  segments.sort((a, b) => a.startCol - b.startCol || b.span - a.span);
  const lanes: TripBandSegment[][] = [];
  for (const segment of segments) {
    const lane = lanes.find(l => l.every(s => s.startCol + s.span <= segment.startCol || segment.startCol + segment.span <= s.startCol));
    if (lane) lane.push(segment);
    else lanes.push([segment]);
  }
  return lanes;
}
