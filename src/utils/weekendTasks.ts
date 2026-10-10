import type { Project, Task, TimeOfDay } from '../types';
import { isPausedOn } from './projectPause';
// From types rather than declared here, so useSettingsStore can read them
// without importing this module: that would close a cycle through dateUtils,
// which is exactly why the grocery lead-days trio lives there too.
import {
  WEEKEND_NUDGE_LEAD_DAYS_DEFAULT,
  WEEKEND_NUDGE_LEAD_DAYS_MAX,
  WEEKEND_NUDGE_LEAD_DAYS_MIN,
  WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT,
  WEEKEND_NUDGE_PLAN_THRESHOLD_MAX,
  WEEKEND_NUDGE_PLAN_THRESHOLD_MIN,
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
 * 7. **A recurring task never counts against bareness, however many of them
 *    there are.** This used to go the other way — a standing Saturday chore
 *    counted as a "plan" the same as anything else — on the reasoning that a
 *    Saturday carrying six of them isn't bare either. In practice that made
 *    the offer silent for anyone whose weekend carries even one routine
 *    errand, which is most people: a weekly grocery run shouldn't derail a
 *    feature about whether there's a *plan*. `weekendPlanCount` is where this
 *    lives; a one-off task or a real calendar event still counts, since
 *    either one is a choice made about this particular Saturday.
 * 8. **"Bare" tolerates a small, user-set number of one-off plans, not only
 *    zero.** `weekendNudgePlanThreshold` (default
 *    `WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT`) is how many `weekendPlanTitles`
 *    may return and the weekend still counts — a single movie or dinner
 *    booked for an otherwise open Saturday and Sunday is not a *planned*
 *    weekend, and treating it as one would have this offer go quiet the
 *    moment anybody puts one thing on the calendar. `isWeekendBare` is where
 *    the threshold is read; a known calendar busy window still blocks
 *    outright rather than counting toward it, since a block of somebody
 *    else's time isn't comparable to one more task.
 * 9. **The row names what's already there instead of only grading the
 *    weekend empty or not.** The point of the offer is "here's what you have,
 *    want to fill in the rest", not a pass/fail on how bare it is —
 *    `weekendNudgeNotes` takes the titles `weekendPlanTitles` found and says
 *    them, rather than collapsing straight to a count the person then has to
 *    go find on their own calendar. A title comes off the `DayMark` itself
 *    (see that function's own note), so this needs no second task lookup and
 *    reads correctly for a projected occurrence too.
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
 * `clampUseUpLeadDays` (`groceryExpiry.ts`) and `parseBirthdayLeadDays` are: a value can reach this module from a stored
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
 * The titles already on the weekend — one entry per plan, in Friday/Saturday/
 * Sunday order.
 *
 * Walks `buildDayBuckets`' own output rather than the task list, which is the
 * point: "what lands on this day" has one answer in this app, projected
 * recurrences and all of `canProject`'s refusals included, and a second walk
 * here would be a third copy of it to keep in step (`snoozeEngine` has the
 * other). What this adds on top is the three narrowings the buckets cannot
 * express — Friday's evening rule, the fact that a deadline is a day to hit
 * rather than a plan for the evening, and recurrence.
 *
 * A recurring task never counts, chore or not. This used to go the other way
 * (a projected occurrence counted on the reasoning that a Saturday carrying
 * six chores isn't bare either), but that made the offer silent for anyone
 * whose weekend carries even one standing errand — a weekly grocery run is
 * exactly the kind of thing that shouldn't derail a feature about whether
 * there's a *plan*. Recurrence is what tells the two apart: it repeats
 * whether or not anything else is happening, so its presence says nothing
 * about the weekend being free. A one-off task or a real calendar event is
 * a choice made about this particular Saturday, and still counts.
 *
 * The title comes off the mark itself, not a second lookup through
 * `taskById` — `DayMark.title` is captured precisely because a projected
 * occurrence has no row of its own to name itself from (see that field's own
 * doc comment), so it is already the right caption for a real row too, with
 * no `displayTitleFor` needed here: this module stays pure logic with no
 * store or chain-step handling to pull in, and the row the nudge itself
 * writes leans on `displayTitleFor` only for the nominated project's own
 * suggestion, which is a different, single task with its own lookup.
 */
export function weekendPlanTitles(
  window: WeekendWindow,
  buckets: ReadonlyMap<string, DayBucket>,
  taskById: ReadonlyMap<string, Task>,
): string[] {
  const titles: string[] = [];

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

      // A projected mark's taskId resolves to the row the rule lives on. No
      // row found means nothing to read either way, so it's read as a one-off
      // rather than silently dropped.
      const task = taskById.get(mark.taskId);

      if (key === window.fridayKey) {
        // A projected Friday occurrence resolves to the row the rule lives on,
        // which is where the segments are. No row means nothing to read, and an
        // unreadable placement is not evidence of an evening plan.
        if (!task || !isWeekendEvening(task)) continue;
      }

      if (task?.recurrenceType && task.recurrenceType !== 'none') continue;

      counted.add(mark.taskId);
      titles.push(mark.title);
    }
  }

  return titles;
}

/** How many things are already on the weekend. */
export function weekendPlanCount(
  window: WeekendWindow,
  buckets: ReadonlyMap<string, DayBucket>,
  taskById: ReadonlyMap<string, Task>,
): number {
  return weekendPlanTitles(window, buckets, taskById).length;
}

/**
 * A stored plan-threshold setting read back as a usable one, for the reason
 * `clampWeekendNudgeLeadDays` is its own function rather than a clamp at the
 * setter alone: a value can reach this module from a stored string or a peer
 * on a different build.
 */
export function clampWeekendNudgePlanThreshold(count: number): number {
  if (!Number.isFinite(count)) return WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT;
  return Math.max(
    WEEKEND_NUDGE_PLAN_THRESHOLD_MIN,
    Math.min(WEEKEND_NUDGE_PLAN_THRESHOLD_MAX, Math.round(count)),
  );
}

/** How the plan threshold reads in Settings, and in the stepper's own caption. */
export function describeWeekendNudgePlanThreshold(count: number): string {
  const clamped = clampWeekendNudgePlanThreshold(count);
  if (clamped === 0) return 'Only a fully open weekend';
  return `Up to ${clamped} ${clamped === 1 ? 'thing' : 'things'} already planned`;
}

/**
 * Whether the weekend is under-planned enough to nudge about.
 *
 * Not "has nothing on it" — `threshold` (default
 * `WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT`) is how many one-off things may
 * already be there and the weekend still counts. A single movie or dinner on
 * an otherwise open Saturday and Sunday is not a *planned* weekend by any
 * reading that also calls a bare one worth nudging about, so this used to
 * demand literal zero and don't anymore: `planCount` crossing the threshold is
 * what a weekend actually filling up looks like, one thing at a time is not.
 *
 * Calendar events count for Saturday and Sunday only, and any known busy time
 * (an all-day event left busy included) blocks outright rather than adding to `planCount` — the two aren't
 * comparable (a task is a single plan, a busy window is however long the
 * calendar says), and a half-day commitment is reason enough on its own
 * regardless of how much of the day-count threshold is left. Friday's events
 * are not read at all: the whole-day busy figure `DayLoad` carries cannot be
 * narrowed to the evening the way the task count can, and a Friday of
 * meetings would otherwise silence the offer for everybody who has a job.
 *
 * `busyKnown: false` does not block — see rule 4 in this module's header, which
 * is the one place this deliberately departs from `dayLoad`'s own reading.
 */
export function isWeekendBare(
  window: WeekendWindow,
  loads: ReadonlyMap<string, DayLoad>,
  planCount: number,
  threshold: number = WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT,
): boolean {
  if (planCount > clampWeekendNudgePlanThreshold(threshold)) return false;
  for (const key of [window.saturdayKey, window.sundayKey]) {
    const load = loads.get(key);
    if (load?.busyKnown && (load.busyMinutes > 0 || load.busyAllDay)) return false;
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
  todayKey?: string,
): Project[] {
  return projects
    // Completed ones too, for the same reason: a finished project has
    // nothing left to suggest, and one still nominated from when it was open
    // was being quoted anyway.
    .filter(project => project.weekendSource && !project.archived && !project.completed)
    // Paused, or set to never come up: the pull sheet the row links to refuses
    // both, so naming one sent the person to a sheet that said no.
    .filter(project => project.nudgeOptIn && !(todayKey && isPausedOn(project, todayKey)))
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
export function weekendNudgeLinkUrl(projectId: string | null, saturdayKey?: string | null): string | null {
  // With the Saturday, so what the sheet pulls lands on the weekend this row
  // is about rather than on today.
  return projectId ? projectReviewLinkUrl(projectId, saturdayKey) : null;
}

/**
 * Titles joined into one clause: "A", "A and B", "A, B, and C" — the reading
 * every other list-of-names sentence in the app already uses (a stack's
 * roster, a project's members), so this doesn't invent a fourth way to join
 * three things.
 */
function joinTitles(titles: readonly string[]): string {
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(', ')}, and ${titles[titles.length - 1]}`;
}

/**
 * The row's notes — why this task is on the list.
 *
 * Names what's already on the weekend rather than only reporting a count —
 * the point of the row is to show the person what they have and offer to
 * fill in the rest, not to grade the weekend as empty or not. A non-empty
 * `planTitles` is only possible with the plan threshold raised past its
 * default, since this row is dropped once any plan gets made either way
 * (`staleWeekendNudgeTasks`) — but the copy still has to be honest for the
 * whole range `isWeekendBare` accepts, or a weekend carrying its one allowed
 * plan gets told it has none. No claim beyond what it names, and no
 * encouragement: the app knows these titles and that is the whole of what it
 * knows.
 */
export function weekendNudgeNotes(planTitles: readonly string[], suggestion: WeekendSuggestion | null): string {
  const bare = planTitles.length === 0
    ? 'Nothing is on your list for Friday evening, Saturday or Sunday.'
    : `${joinTitles(planTitles)} ${planTitles.length === 1 ? 'is' : 'are'} on your list for Friday evening, Saturday or Sunday. There’s still room to plan more.`;
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
