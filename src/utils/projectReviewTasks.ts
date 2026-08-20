import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, Task } from '../types';
import { getCurrentDayStart, getDayStart } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { MAX_PULLED_PROJECTS, type ProjectStall } from './projectPull';
import { isDismissedToday } from './visibilityUtils';

/**
 * The "a project has gone quiet" offer, as tasks.
 *
 * This replaced `ProjectNudgeBanner`, a strip above the Today list that said
 * "3 projects gone quiet" with a Review button and an ✕. The banner worked, and
 * the objection to it was never that it was wrong — it was that it sat outside
 * the one flow the whole app is about. It could not be deferred, snoozed for
 * one project, given a reminder, searched for, or seen anywhere but Today; its
 * only answer was a single global "not today" (`projectNudgeDismissedAt`) that
 * covered every quiet project at once; and it occupied the header slot above
 * the pinned block whether or not now was the moment. A banner is chrome, and
 * chrome asks for attention on its own schedule.
 *
 * A task asks on yours. "Review Kitchen renovation" is a row: put it off till
 * Saturday, drop it in a stack, let it sit. Everything the banner did by hand
 * (naming which projects, saying how long each has been silent, opening the
 * pull sheet scoped to one of them) a row does with machinery that already
 * exists — a title, a derived caption, and `linkUrl`.
 *
 * **The decision is still entirely derived.** Nothing here stores "quiet" or
 * "last nudged"; `findProjectStalls` answers that fresh every time, exactly as
 * it did for the banner (see `projectPull.ts`'s header on why there is no such
 * column). What is new is that the answer is now *written down as a row*, so
 * the two can drift — a project that stops being quiet leaves a task behind.
 * That is what `partitionProjectReviewTasks` is for, and why the check runs on
 * a foreground sweep rather than only at launch.
 *
 * Three rules worth not re-deriving:
 *
 * - **The task carries no `projectId`.** It points at its project through
 *   `generatedSourceId`, like every other generated task points at its source,
 *   and filing it *in* the project would be a loop with no bottom: a dated
 *   member makes `hasNoDateSignal` false, which makes the project not stalled,
 *   which deletes the task, which makes it stalled again. Cook tasks aren't
 *   filed in a meal plan either.
 * - **It is capped at `MAX_PULLED_PROJECTS`**, the same three the sheet
 *   proposes and the same three the banner used to preview. A generator with no
 *   ceiling writes one row per quiet project, and a board of a dozen parked
 *   projects would answer a request for less chrome with twelve tasks.
 * - **Declining is a day, not a verdict** — see `Project.reviewDeclinedAt`.
 *
 * The tasks are deliberately *not* a stack, unlike the meal-plan nudge's seven
 * days. That set is one job with a meaningful tally ("3/7 of the week planned");
 * these are independent offers about unrelated projects, there is no "3/3 quiet
 * projects reviewed" worth counting, and the common case is one or two — a
 * stack header over a single row is a heading for nothing.
 */

/** Row-per-project ceiling, shared with the sheet so the two can't disagree. */
export const MAX_PROJECT_REVIEW_TASKS = MAX_PULLED_PROJECTS;

/** What a review task carries in `linkUrl`, scoped to its own project. */
export const PROJECT_REVIEW_LINK_URL = 'dundundun://projects';

/**
 * The link one review task carries: the pull sheet, opened on that project
 * alone rather than on the whole board.
 *
 * A query string rather than a path segment, the form `mealPlanNudgeLinkUrl`
 * already established for this scheme. Falls back to the bare link for an empty
 * id, so a malformed call can't mint a URL that scopes to nothing.
 */
export function projectReviewLinkUrl(projectId: string): string {
  return projectId ? `${PROJECT_REVIEW_LINK_URL}?pull=${projectId}` : PROJECT_REVIEW_LINK_URL;
}

/**
 * The project a review task speaks for, or null for any other task.
 *
 * Thin, and deliberately just `generatedSourceOf` under a name that says what
 * the string means here — one column holds five generators' source ids now, and
 * a grocery item's id read as a project id would scope the pull sheet to a
 * project that doesn't exist.
 */
export function projectReviewProjectId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'projectReview');
}

/**
 * The row's title.
 *
 * Names the verb, unlike the meal-plan nudge's day rows, which are bare dates
 * under a stack header that supplies the sentence. These have no header: a row
 * reading "Kitchen renovation" on Today, in Search or on the widget is a task
 * to *do the renovation*, which is the one thing it isn't.
 */
export function projectReviewTitle(project: Pick<Project, 'title'>): string {
  return `Review ${project.title}`;
}

/**
 * How long a review task's project has been silent — the "21d" the banner used
 * to put beside each project name, and the one thing the row would otherwise
 * have lost in the move.
 *
 * Derived at render, never stored on the task, for the same reason the
 * meal-plan nudge's "2/3 planned" is: the number moves every day, and a copy
 * on the row would be a second thing to keep true. Null for a project that
 * isn't there any more, which renders no chip at all rather than "0 days" — a
 * row can outlive its project by up to one sweep, and naming a duration of
 * zero would be the app stating something false about it.
 *
 * Deliberately *not* read off `findProjectStalls`, which is the wrong shape for
 * a row: that runs every gate for every project to answer a question this
 * already knows the answer to (a task exists, so the project was quiet when it
 * was written). This is the one line of it that renders.
 */
export function projectQuietDays(
  project: Pick<Project, 'createdAt'> | null | undefined,
  members: readonly Pick<Task, 'completedAt'>[]
): number | null {
  if (!project) return null;
  let latest = project.createdAt;
  for (const t of members) {
    if (t.completedAt && t.completedAt > latest) latest = t.completedAt;
  }
  // Calendar days across the logical day boundary, never a millisecond
  // division — see the timezone note on pinSuggest.overdueDays.
  return Math.max(0, differenceInCalendarDays(getCurrentDayStart(), getDayStart(new Date(latest))));
}

/** The chip's own words. */
export function describeProjectQuiet(quietDays: number): string {
  return `Quiet ${quietDays} ${quietDays === 1 ? 'day' : 'days'}`;
}

/**
 * Whether this project's review task was swiped away today — the "not today"
 * that `Project.reviewDeclinedAt` records.
 *
 * Straight `isDismissedToday`, the app's existing self-expiring-stamp idiom and
 * the very one the banner's own global dismissal used. Wrapped rather than
 * called inline so the field has one reader, the way `mealPlanNudgeDayKey`
 * wraps `generatedSourceOf` — and so the comparison can't drift into "within
 * the cadence", which is a different and much longer promise (see
 * `declinedToday` in projectPull.ts for why the day is the right unit).
 */
export function declinedToday(project: Pick<Project, 'reviewDeclinedAt'>): boolean {
  return isDismissedToday(project.reviewDeclinedAt);
}

/**
 * Projects whose review task the user has already dealt with today — ticked
 * off, or archived.
 *
 * Without this the offer is unrefusable in the one way that matters most.
 * `liveGeneratedTask` looks at rows that are neither completed nor archived, so
 * ticking "Review Kitchen renovation" off without pulling anything in leaves no
 * live task, the project is still quiet, and the next sweep — the next
 * foreground, possibly seconds later — writes an identical row. The banner at
 * least had an ✕.
 *
 * `blocksOnFinished` is the mechanism's own answer to this and is the wrong one
 * here: it blocks on a finished task *for ever*, which is right for a meal (one
 * event, one cook task) and wrong for a project, which goes quiet again every
 * few months and should be able to ask again when it does. So the question is
 * scoped to the day, the same unit and the same self-expiring stamp a decline
 * uses — and derived from the rows rather than written anywhere, since the
 * rows already say it.
 *
 * Archiving counts because it is this app's other explicit "I've dealt with
 * this" (see the note on `archiveTask`), and it lands in the same blind spot.
 */
export function projectsReviewedToday(
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'>[]
): Set<string> {
  const done = new Set<string>();
  for (const task of tasks) {
    const projectId = projectReviewProjectId(task);
    if (!projectId) continue;
    const dealtWith =
      (task.completed && isDismissedToday(task.completedAt)) ||
      (task.archived && isDismissedToday(task.archivedAt));
    if (dealtWith) done.add(projectId);
  }
  return done;
}

/** One project that should have a review task sitting on today's list. */
export interface ProjectReviewWant {
  projectId: string;
  title: string;
  quietDays: number;
}

/**
 * Which quiet projects should have a task right now, most overdue first.
 *
 * Rides `findProjectStalls` in **'nudge' mode** — the caller's job — because
 * this writes a row nobody asked for, the same standard the banner and the drip
 * are held to. Opening the pull sheet by hand still sees every quiet project
 * (see `StallMode`); the two counts disagreeing is the design.
 */
export function wantedProjectReviews(
  stalls: readonly ProjectStall[],
  /** From `projectsReviewedToday` — projects already dealt with since the day turned. */
  reviewedToday: ReadonlySet<string> = new Set(),
  cap: number = MAX_PROJECT_REVIEW_TASKS
): ProjectReviewWant[] {
  return stalls
    .filter(stall => !reviewedToday.has(stall.project.id))
    // autoSchedule projects are excluded here rather than left to the caller,
    // the same filter the banner applied and for the same reason the pull sheet
    // applies it: the drip is already dating that project's next task, so an
    // offer to pick one by hand is the app asking about work it has done.
    .filter(stall => !stall.project.autoSchedule && !declinedToday(stall.project))
    .slice(0, Math.max(0, cap))
    .map(stall => ({
      projectId: stall.project.id,
      title: projectReviewTitle(stall.project),
      quietDays: stall.quietDays,
    }));
}

/**
 * The review tasks sitting there whose reason has gone.
 *
 * **This is the whole reason the check runs on a sweep** rather than only when
 * something changes. A project stops being quiet the moment anything in it is
 * dated — including by the user acting on this very row — and nothing about
 * that mutation knows a task is sitting on Today describing the old state.
 * "Review Kitchen renovation" left over after you pulled a task from Kitchen
 * renovation is a chore about nothing, the same thing `dropGeneratedTask`
 * exists to clear.
 *
 * **Judged against every stalled project, not against the capped set
 * `wantedProjectReviews` returns.** The two answer different questions: the cap
 * decides who gets a *new* task when several projects are queued, and losing
 * that contest is not a reason to delete a row the user has already deferred to
 * Saturday. A project that is still quiet still justifies the task it has.
 * A project switched to auto-schedule is the one exception — the drip is dating
 * its next task now, so an offer to pick one by hand is about work already done.
 *
 * A completed task is in neither reading (the user did it, and the row is the
 * record), and neither is an archived one — the same two exclusions
 * `liveGeneratedTasksOfKind` already makes.
 */
export function staleProjectReviewTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  stalls: readonly ProjectStall[]
): T[] {
  const stillQuiet = new Set(
    stalls.filter(stall => !stall.project.autoSchedule).map(stall => stall.project.id)
  );
  return liveGeneratedTasksOfKind(tasks, 'projectReview').filter(task => {
    const projectId = projectReviewProjectId(task);
    return !projectId || !stillQuiet.has(projectId);
  });
}
