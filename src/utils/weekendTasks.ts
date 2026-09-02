import type { Project, Task, TimeOfDay } from '../types';
// From types rather than declared here, so useSettingsStore can read them
// without importing this module: that would close a cycle through dateUtils,
// which is exactly why the grocery lead-days trio lives there too.
import {
  WEEKEND_NUDGE_LEAD_DAYS_DEFAULT,
  WEEKEND_NUDGE_LEAD_DAYS_MAX,
  WEEKEND_NUDGE_LEAD_DAYS_MIN,
} from '../types';
import type { DayBucket } from './calendarMonth';
import type { DayLoad } from './dayLoad';
import { dayKeyOf } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { projectReviewLinkUrl } from './projectReviewTasks';

/**
 * The "your weekend is bare" offer, as a task — the eighteenth generator.
 *
 * A weekend with nothing on it is invisible in exactly the way an undated
 * project task is (see `projectPull.ts`): Today never mentions Saturday, Later
 * sorts it in among everything else, and by the time it is Saturday morning the
 * moment to have arranged anything has passed. This says so on Thursday, once,
 * while there is still time to do something about it.
 *
 * Structurally it is `projectReview` one shelf over: a derived condition that
 * time passing brings about, so it fires from the launch sequence and the Today
 * foreground sweep rather than off any mutation, with a clear-then-create
 * ordering and a stale pass for the row whose reason has gone. What is new is
 * the shape of the source — a *weekend* rather than a row or a single day key —
 * and the fact that the thing it offers to fill the weekend with comes from a
 * project the user nominated.
 *
 * Six rules worth not re-deriving:
 *
 * 1. **Friday counts from the evening, and only from the evening.** A weekend
 *    that starts at midnight on Saturday is not the one anybody actually has.
 *    But a Friday with six work tasks on it is not a weekend with plans either,
 *    so the Friday half counts only what the user *placed* in the evening —
 *    `timeSegments` carrying `evening` or `night`. A Friday task with no segment
 *    is a workday task, and reading it as a plan would silence the nudge for
 *    everybody who works Fridays.
 * 2. **It asks before the weekend, never during it.** `isWeekendNudgeLeadDay`
 *    is Thursday and Friday by default, and the user can widen it back to the
 *    Monday (`weekendNudgeLeadDays`) — but never past the Friday, because on
 *    Saturday there is nothing left to plan ahead for, and a row saying "make
 *    plans for the weekend" on Saturday afternoon is the app telling somebody
 *    their weekend is going badly. That floor is in the predicate rather than
 *    only in the setting's clamp, so no stored value can buy a way into the two
 *    days this must stay off.
 * 3. **The stamp is the weekend, not the day** (`weekendNudgeLastWeekendKey`,
 *    holding the Saturday's day key). One offer per weekend falls out of that
 *    with no cooldown arithmetic at all: Thursday's firing marks the weekend,
 *    and Friday's pass finds it already marked. It is the same
 *    "written down before the condition is judged" order `calendarReviewLastDayKey`
 *    and `moodNudgeLastDayKey` are written in, and for the same reason — with no
 *    source row to stamp, nothing else stands between a swiped-away task and an
 *    identical one on the very next foreground sweep.
 * 4. **An unreadable calendar still nudges.** `dayLoad`'s own rule is that no cue
 *    is never "this day is free", and this deliberately departs from it: a day
 *    whose events the app cannot see (`busyKnown: false`) does not block the
 *    offer. Held to that rule the feature would be inert for everybody with
 *    calendar access off, which is most people. The two failure directions are
 *    not symmetrical here the way they are for a cue painted on a date picker —
 *    being wrong costs one task, once a weekend, on a row with a checkbox on it,
 *    where the cue that rule protects is read while booking something.
 * 5. **The project it points at is nominated, never guessed**
 *    (`Project.weekendSource`). Nothing here scores a project for
 *    weekend-ishness, reads its title, or ranks the user's projects by how fun
 *    they look. Several nominated projects break the tie on `sortOrder`, the
 *    hand drag on the Projects screen, for the reason `reachOut` breaks its own
 *    tie there: it is the only ranking of these the user actually made.
 * 6. **It stands down while a mood nudge is live.** `moodNudge`'s task is "Plan
 *    something you enjoy this week", which is this offer with a different reason
 *    behind it, so a low week with a bare weekend would otherwise produce two
 *    rows asking for one thing. This one yields because the other is the more
 *    specific claim: it fired off something the user recorded about themselves,
 *    where this fired off three empty days. Same shape as `checkPantryCheckTasks`
 *    standing down while a `pantryReview` row is live, including that it is the
 *    **create half only** — a weekend nudge already raised, possibly deferred, is
 *    the user's, and the stale pass clears it on its own terms. And like that
 *    pair, the passes are ordered so the suppression lands in the same sweep
 *    rather than one behind it: `checkMoodTasks` runs first at both call sites.
 */

/** The row's title. Never varies. */
export const WEEKEND_NUDGE_TITLE = 'Make plans for the weekend';

/**
 * The time-of-day segments that make a Friday task part of the weekend.
 *
 * `night` rides along with `evening` because the pair is one placement to the
 * person setting it — a Friday task set to `night` is not a Friday *work* task
 * by any reading.
 */
export const WEEKEND_EVENING_SEGMENTS: readonly TimeOfDay[] = ['evening', 'night'];

/** The three days one weekend nudge is asking about. */
export interface WeekendWindow {
  /** Counted from the evening only — see rule 1. */
  fridayKey: string;
  saturdayKey: string;
  sundayKey: string;
}

/**
 * How many days from `today` to the weekend's Saturday; negative once past it.
 *
 * Sunday is the tail of a weekend already under way, so its Saturday is
 * yesterday — the one case that has to come out negative rather than as 6, and
 * the reason both readers below go through this rather than each spelling the
 * weekday arithmetic out.
 */
function daysUntilSaturday(today: Date): number {
  return today.getDay() === 0 ? -1 : 6 - today.getDay();
}

/**
 * The weekend `today` is closest to, from any day of the week.
 *
 * Anchored on the Saturday, which is also what the app's own "this weekend"
 * already means when somebody types it into quick add (`parseNaturalDate`,
 * `nextDay(now, 6)`); two definitions of the weekend that disagreed would be a
 * bug nobody could see until it bit.
 *
 * On Saturday and Sunday it answers with the weekend *in progress* rather than
 * the next one. Nothing raises an offer on those days (rule 2), but the stale
 * pass runs on them, and a window that had already rolled forward would read
 * Friday's live row as spent and delete it in the middle of the weekend it is
 * about.
 */
export function upcomingWeekend(today: Date): WeekendWindow {
  const saturday = new Date(today);
  saturday.setHours(12, 0, 0, 0);
  saturday.setDate(saturday.getDate() + daysUntilSaturday(today));

  const friday = new Date(saturday);
  friday.setDate(friday.getDate() - 1);
  const sunday = new Date(saturday);
  sunday.setDate(sunday.getDate() + 1);

  return {
    fridayKey: dayKeyOf(friday),
    saturdayKey: dayKeyOf(saturday),
    sundayKey: dayKeyOf(sunday),
  };
}

/**
 * Whether today is a day the offer may be raised on.
 *
 * Bounded below at 1 as well as above: on the Saturday and Sunday themselves
 * there is nothing left to plan ahead for (rule 2), and no lead setting may buy
 * a way into those two days.
 */
export function isWeekendNudgeLeadDay(
  today: Date,
  leadDays: number = WEEKEND_NUDGE_LEAD_DAYS_DEFAULT,
): boolean {
  const until = daysUntilSaturday(today);
  return until >= 1 && until <= clampWeekendNudgeLeadDays(leadDays);
}

/**
 * A stored lead setting read back as a usable one.
 *
 * Its own function rather than a clamp at the setter alone, for the reason
 * `parseGroceryUseUpLeadDays` is: a value can reach this module from a stored
 * string or a peer on a different build, and a window of 0 days would be a
 * generator that can never fire rather than one that fires less.
 */
export function clampWeekendNudgeLeadDays(days: number): number {
  if (!Number.isFinite(days)) return WEEKEND_NUDGE_LEAD_DAYS_DEFAULT;
  return Math.max(
    WEEKEND_NUDGE_LEAD_DAYS_MIN,
    Math.min(WEEKEND_NUDGE_LEAD_DAYS_MAX, Math.round(days)),
  );
}

/** How the lead window reads in Settings, and in the stepper's own caption. */
export function describeWeekendNudgeLead(days: number): string {
  const clamped = clampWeekendNudgeLeadDays(days);
  return clamped === 1
    ? 'On Friday'
    : `From ${WEEKDAY_NAMES[(6 - clamped + 7) % 7]}`;
}

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

/** The weekend a nudge task speaks for, or null for any other task. */
export function weekendNudgeWeekendKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'weekendNudge');
}

/** Whether a Friday task sits late enough in the day to count as a plan. */
export function isWeekendEvening(task: Pick<Task, 'timeSegments'>): boolean {
  return task.timeSegments.some(segment => WEEKEND_EVENING_SEGMENTS.includes(segment));
}

/**
 * How many things are already on the weekend.
 *
 * Walks `buildDayBuckets`' own output rather than the task list, which is the
 * point: "what lands on this day" has one answer in this app, projected
 * recurrences and all of `canProject`'s refusals included, and a second walk
 * here would be a third copy of it to keep in step (`snoozeEngine` has the
 * other). What this adds on top is the two narrowings the buckets cannot
 * express — Friday's evening rule, and the fact that a deadline is a day to hit
 * rather than a plan for the evening.
 *
 * A projected occurrence counts. A recurring Saturday chore is not a weekend
 * plan by any generous reading, but a Saturday carrying six of them is not a
 * bare Saturday either, and the cost of the two mistakes is not the same: a
 * missed nudge is silence, and a nudge onto a full day is the app being wrong
 * about the one thing it claimed to know.
 */
export function weekendPlanCount(
  window: WeekendWindow,
  buckets: ReadonlyMap<string, DayBucket>,
  taskById: ReadonlyMap<string, Task>,
): number {
  let count = 0;

  for (const key of [window.fridayKey, window.saturdayKey, window.sundayKey]) {
    const counted = new Set<string>();
    for (const mark of buckets.get(key)?.marks ?? []) {
      // A deadline is a day to hit, not an evening spent — and the row carrying
      // one nearly always carries a due date too, so counting both would charge
      // one task to the weekend twice. Same exclusion `buildDayLoads` makes.
      if (mark.kind === 'deadline') continue;
      // A finished row is something that already happened. It says nothing about
      // whether there is anything left to look forward to.
      if (mark.completed) continue;
      if (counted.has(mark.taskId)) continue;

      if (key === window.fridayKey) {
        // A projected Friday occurrence resolves to the row the rule lives on,
        // which is where the segments are. No row means nothing to read, and an
        // unreadable placement is not evidence of an evening plan.
        const task = taskById.get(mark.taskId);
        if (!task || !isWeekendEvening(task)) continue;
      }

      counted.add(mark.taskId);
      count += 1;
    }
  }

  return count;
}

/**
 * Whether the weekend has nothing on it.
 *
 * Calendar events count for Saturday and Sunday only. Friday's are not read at
 * all: the whole-day busy figure `DayLoad` carries cannot be narrowed to the
 * evening the way the task count can, and a Friday of meetings would otherwise
 * silence the offer for everybody who has a job.
 *
 * `busyKnown: false` does not block — see rule 4 in this module's header, which
 * is the one place this deliberately departs from `dayLoad`'s own reading.
 */
export function isWeekendBare(
  window: WeekendWindow,
  loads: ReadonlyMap<string, DayLoad>,
  planCount: number,
): boolean {
  if (planCount > 0) return false;
  for (const key of [window.saturdayKey, window.sundayKey]) {
    const load = loads.get(key);
    if (load?.busyKnown && load.busyMinutes > 0) return false;
  }
  return true;
}

/**
 * Whether to raise the offer right now.
 *
 * Takes the last weekend's key rather than reading it, so the whole rule is
 * decidable without a store and the "once per weekend" promise is testable at a
 * weekend boundary — the same shape `wantsMoodNudge` takes its cooldown in.
 */
export function wantsWeekendNudge(
  today: Date,
  window: WeekendWindow,
  bare: boolean,
  lastWeekendKey: string | null,
  options: { leadDays?: number; moodNudgeLive?: boolean } = {},
): boolean {
  const { leadDays = WEEKEND_NUDGE_LEAD_DAYS_DEFAULT, moodNudgeLive = false } = options;
  // Rule 6 — see the header. The mood nudge already asked for the same thing.
  if (moodNudgeLive) return false;
  if (!isWeekendNudgeLeadDay(today, leadDays)) return false;
  if (!bare) return false;
  return lastWeekendKey !== window.saturdayKey;
}

/** A project the user nominated, and the thing it would have them do. */
export interface WeekendSuggestion {
  projectId: string;
  projectTitle: string;
  /** The project's next pullable task, or null for a project with none left. */
  candidateTitle: string | null;
}

/**
 * The nominated projects, in the user's own order.
 *
 * Archived projects are excluded because an archive is this app's explicit "I've
 * dealt with this" (see `archiveTask`), and a nomination made months ago is not
 * a reason to keep quoting a project the user has filed away.
 */
export function weekendSourceProjects(
  projects: readonly Project[],
): Project[] {
  return projects
    .filter(project => project.weekendSource && !project.archived)
    // The hand drag on the Projects screen, for the reason `reachOut` breaks its
    // tie on the People screen's: it is the only ranking of these the user made
    // on purpose, and inventing a second one here would be this feature deciding
    // which of somebody's plans it likes best.
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * What the row carries in `linkUrl` — the pull sheet, scoped to the nominated
 * project, which is the surface that already exists for "bring a task out of
 * this project and put a date on it".
 *
 * Deliberately `projectReviewLinkUrl` rather than a second builder spelling the
 * same URL: it is one sheet, and two copies of its address is exactly the drift
 * `SheetHeaderButton` and `InlineAction` exist to undo, one layer down.
 */
export function weekendNudgeLinkUrl(projectId: string | null): string | null {
  return projectId ? projectReviewLinkUrl(projectId) : null;
}

/**
 * The row's notes — why this task is on the list.
 *
 * States what is on the weekend (nothing) and, when there is one, what the
 * nominated project would have you do next. No claim about what a bare weekend
 * means, and no encouragement: the app knows three days have no rows on them,
 * and that is the whole of what it knows.
 */
export function weekendNudgeNotes(suggestion: WeekendSuggestion | null): string {
  const bare = 'Nothing is on your list for Friday evening, Saturday or Sunday.';
  if (!suggestion) return bare;
  if (!suggestion.candidateTitle) {
    return `${bare} You marked ${suggestion.projectTitle} as somewhere to look for weekend plans.`;
  }
  return `${bare} Next in ${suggestion.projectTitle}: ${suggestion.candidateTitle}.`;
}

/**
 * The nudge tasks sitting there whose reason has gone.
 *
 * Two ways that happens, and both have to be caught here rather than by anything
 * the user did, because neither mutation knows a row is sitting on Today
 * describing the old state:
 *
 * - **The weekend has passed.** The source id is the Saturday's key, so a row
 *   whose key is not the current window's is about a weekend that is over. This
 *   is why `upcomingWeekend` answers with the weekend in progress on Saturday
 *   and Sunday rather than rolling forward: rolled forward, Friday's row would
 *   be read as spent on Saturday morning and deleted in the middle of the two
 *   days it exists to be about.
 * - **Plans got made.** Including by the user acting on this very row, which is
 *   the common case and the whole reason the check runs on a sweep — pulling a
 *   task out of the nominated project onto Saturday is what the link is for, and
 *   the row asking for it must not still be there afterwards.
 *
 * A completed task is in neither reading (the user did it, and the row is the
 * record), and neither is an archived one — the same two exclusions
 * `liveGeneratedTasksOfKind` already makes.
 */
export function staleWeekendNudgeTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  window: WeekendWindow,
  bare: boolean,
): T[] {
  return liveGeneratedTasksOfKind(tasks, 'weekendNudge').filter(task => {
    const weekendKey = weekendNudgeWeekendKey(task);
    if (weekendKey !== window.saturdayKey) return true;
    return !bare;
  });
}
