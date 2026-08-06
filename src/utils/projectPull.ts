import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, Task } from '../types';
import { DEFAULT_NUDGE_CADENCE_DAYS } from '../types';
import { getCurrentDayStart, getDayStart } from './dateUtils';
import { hasNoDateSignal } from './visibilityUtils';
import { scoreTask, type PinContext } from './pinSuggest';
import { computeSnoozeSuggestion } from './snoozeEngine';
import { sumEstimatedMinutes } from './effort';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * "Pull from projects" — finds projects that have gone quiet and proposes the
 * next task to bring into play.
 *
 * The problem this exists for: an undated project task is invisible in *every*
 * list. isTaskVisible drops it from Today, isTaskDeferred from Later, and both
 * isUnscheduledTask and isInboxTask require projectId == null. That's
 * deliberate — a project shouldn't dump itself onto Today — but it means a
 * project doesn't decay gradually, it goes silent the instant nothing in it
 * carries a date, and nothing ever mentions it again.
 *
 * This is the mirror image of utils/deloadPlan: same shape (propose, let the
 * user approve row by row, commit through one undoable action), pointed the
 * other way — instead of moving work off today, pull work in from projects
 * that have stopped moving.
 *
 * Everything here is derived. There is deliberately no "last nudged" column:
 * acting on a nudge dates a member, which makes the project non-stalled, which
 * drops it out on its own; and completing that member stamps a fresh
 * completedAt, which restarts the quiet clock. The auto-schedule drip is
 * idempotent for the same reason rolloverQuotas is — its condition self-clears
 * rather than being gated by a flag.
 */

/** How many project rows one nudge shows, however many projects are quiet. */
export const MAX_PULLED_PROJECTS = 3;

/** Candidate tasks offered per project row, cycled from the sheet. */
export const MAX_CANDIDATES_PER_PROJECT = 3;

/**
 * Above this much already planned today, a pull lands on a future day instead
 * of today. Matches PIN_BUDGET_MINUTES' spirit but is deliberately looser —
 * this is "is today already full", not "is this shortlist too long".
 */
export const PULL_TODAY_BUDGET_MINUTES = 180;

/**
 * Score bonus for sitting at the top of the project's own hand-sorted list,
 * decaying to nothing by QUEUE_DEPTH. Sized against pinSuggest's
 * priorityPerLevel (12) so the user's ordering decides between comparable
 * tasks while an urgent one buried deep still comes out ahead.
 */
const QUEUE_LEAD = 18;
const QUEUE_DEPTH = 6;

/** A project that has gone quiet, and why. */
export interface ProjectStall {
  project: Project;
  /** Live members: top-level, incomplete, unarchived — all of them undated. */
  members: Task[];
  /** The subset that can actually be dated (excludes mid-chain steps). */
  pullable: Task[];
  /** ISO. Newest member completion, else the project's own creation. */
  lastTouchedAt: string;
  quietDays: number;
  cadenceDays: number;
  /** quietDays - cadenceDays; >= 0 for a stall. Drives the ordering. */
  overdueBy: number;
}

/** Where one pulled task would land, in the snooze engine's vocabulary. */
export interface PullDate {
  date: Date;
  dayLabel: string;
  reason: string;
}

export interface ProjectPullProposal {
  project: Project;
  /** Ranked, <= MAX_CANDIDATES_PER_PROJECT. The sheet cycles through these. */
  candidates: Task[];
  quietDays: number;
  /** Destination for candidates[0]; the sheet recomputes when it cycles. */
  suggestion: PullDate;
  /** Checked by default in the sheet. */
  selected: boolean;
}

export interface ProjectPullPlan {
  proposals: ProjectPullProposal[];
  /** Stalled projects that didn't fit in MAX_PULLED_PROJECTS. */
  overflowCount: number;
}

/**
 * A mid-chain step is undated by construction and advances on completion, not
 * by date (see completeTask's spawnsNext logic) — dating one is meaningless.
 * Same test deloadPlan.findBlocker uses for its 'chain' blocker.
 */
function isPullable(task: Task): boolean {
  return !(task.chainEnabled && task.chainItems.length > 0 && task.chainIndex > 0);
}

/**
 * When the project last saw activity. Completed and archived rows both count —
 * a completion is a touch regardless of what happened to the row afterward —
 * falling back to the project's creation so a project that has never had a
 * completion still ages.
 */
export function lastTouchedAt(project: Project, allMembers: readonly Task[]): string {
  let latest = project.createdAt;
  for (const t of allMembers) {
    if (t.completedAt && t.completedAt > latest) latest = t.completedAt;
  }
  return latest;
}

/**
 * Every project that has gone quiet, most overdue first.
 *
 * One bucketing pass over `tasks` rather than a filter per project: TodayScreen
 * re-renders on every store change plus a 30s tick, so this runs a lot.
 */
export function findProjectStalls(
  projects: readonly Project[],
  tasks: readonly Task[],
): ProjectStall[] {
  // Vacation mode silences the whole feature. Nudging someone to schedule more
  // work is exactly what vacation mode exists to stop.
  if (useSettingsStore.getState().vacationMode) return [];

  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.projectId || t.parentId !== null) continue;
    const bucket = byProject.get(t.projectId);
    if (bucket) bucket.push(t);
    else byProject.set(t.projectId, [t]);
  }

  const todayStart = getCurrentDayStart();
  const stalls: ProjectStall[] = [];

  for (const project of projects) {
    if (project.archived) continue;
    // 0 is an explicit "never ask about this one", for a project deliberately
    // parked — not a degenerate cadence.
    const cadenceDays = project.nudgeCadenceDays;
    if (cadenceDays <= 0) continue;

    const allMembers = byProject.get(project.id) ?? [];
    const members = allMembers.filter(t => !t.completed && !t.archived);
    // No live members at all. Covers both the empty shell and the project whose
    // members are all done — that one isn't silent, it's finished.
    if (members.length === 0) continue;

    // One scheduled member and the project is not quiet. hasNoDateSignal is the
    // same predicate the visibility gates use, so "stalled" means precisely
    // "nothing in here can appear anywhere".
    if (!members.every(hasNoDateSignal)) continue;

    const pullable = members.filter(isPullable);
    if (pullable.length === 0) continue;

    const touched = lastTouchedAt(project, allMembers);
    // Calendar days on the logical day boundary, never string-sliced ISO — see
    // the timezone note on pinSuggest.overdueDays.
    const quietDays = differenceInCalendarDays(todayStart, getDayStart(new Date(touched)));
    if (quietDays < cadenceDays) continue;

    stalls.push({
      project,
      members,
      pullable,
      lastTouchedAt: touched,
      quietDays,
      cadenceDays,
      overdueBy: quietDays - cadenceDays,
    });
  }

  // Ties resolve by the user's own project ordering, so the same board always
  // surfaces the same projects in the same order.
  return stalls.sort(
    (a, b) =>
      b.overdueBy - a.overdueBy ||
      a.project.sortOrder - b.project.sortOrder ||
      a.project.id.localeCompare(b.project.id)
  );
}

/**
 * The scoring context a pull needs.
 *
 * Deliberately *not* buildPinContext. Every candidate here satisfies
 * hasNoDateSignal, which requires dueDate to be null and timeSegments to be
 * empty, so scoreTask's due and segment terms are structurally 0; and `listed`
 * is always empty (see rankPullCandidates), so the batch and co-completion
 * terms never fire either. Building the real context would run an
 * O(n·window) scan over 300 completed tasks — on every Today render, since the
 * banner derives from it — to produce numbers that cannot change the result.
 *
 * What's left, and all that actually discriminates: priority, and deadline (a
 * project task can carry one without a dueDate — hasNoDateSignal doesn't look
 * at `deadline`, which is right, since a deadline isn't a schedule).
 */
function pullContext(): PinContext {
  return {
    todayStart: getCurrentDayStart(),
    // Inert: a candidate has no timeSegments, so segmentScore returns 0
    // whatever the clock says.
    currentSegment: 'morning',
    // Inert: only suggestPins reads this, never scoreTask.
    excludedCategories: new Set(),
    // Inert: co-occurrence is scored against already-listed tasks, and a pull
    // lists one task per project.
    coOccurrence: new Map(),
  };
}

/**
 * Rank a stalled project's pullable tasks, best first — a blend of the
 * project's own hand-sorted order and pinSuggest's scorer.
 *
 * `listed` is passed empty on purpose: the batch and co-completion terms answer
 * "does this go *with* what's already picked", and one task per project isn't
 * a batch.
 */
export function rankPullCandidates(
  pullable: readonly Task[],
  ctx: PinContext = pullContext(),
): Task[] {
  const inOrder = [...pullable].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );

  const scored = inOrder.map((task, index) => ({
    task,
    index,
    score: scoreTask(task, [], ctx) + QUEUE_LEAD * Math.max(0, 1 - index / QUEUE_DEPTH),
  }));

  // Strictly greater on score, so an exact tie keeps the earlier queue
  // position — the ordering the user already dragged into place.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, MAX_CANDIDATES_PER_PROJECT).map(s => s.task);
}

/**
 * Where a pulled task should land.
 *
 * Today by default, deliberately: computeSnoozeSuggestion only ever proposes
 * days +1..+7 (its candidates start at i + 1), so using it unconditionally
 * would make the whole sheet's output invisible for the rest of the day —
 * reproducing the exact silence this feature exists to fix, one day later.
 *
 * The engine is still used where it's genuinely right. When today is already
 * loaded, a pull would only make a heavy day heavier, so the destination falls
 * back to the same engine behind the date picker's Suggest button and inherits
 * its wording — a pulled task then reads like any other suggested date.
 */
export function suggestPullDate(
  task: Task,
  allTasks: readonly Task[],
  todaysTasks: readonly Task[],
  quietDays: number,
): PullDate {
  if (sumEstimatedMinutes(todaysTasks) >= PULL_TODAY_BUDGET_MINUTES) {
    const suggestion = computeSnoozeSuggestion(task, allTasks as Task[]);
    return { date: suggestion.date, dayLabel: suggestion.dayLabel, reason: suggestion.reason };
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return { date: today, dayLabel: 'Today', reason: `quiet ${quietDays} days` };
}

/**
 * Build the plan the sheet reviews.
 *
 * Projects on auto-schedule never appear here — the drip handles them, so they
 * can't be nagged and dripped at once. The two layers coordinate through the
 * data, not through a flag.
 */
export function buildProjectPullPlan(
  projects: readonly Project[],
  allTasks: readonly Task[],
  todaysTasks: readonly Task[],
): ProjectPullPlan {
  const stalls = findProjectStalls(projects, allTasks).filter(s => !s.project.autoSchedule);
  const ctx = pullContext();

  const proposals = stalls.slice(0, MAX_PULLED_PROJECTS).map(stall => {
    const candidates = rankPullCandidates(stall.pullable, ctx);
    return {
      project: stall.project,
      candidates,
      quietDays: stall.quietDays,
      suggestion: suggestPullDate(candidates[0], allTasks, todaysTasks, stall.quietDays),
      selected: true,
    };
  });

  return { proposals, overflowCount: Math.max(0, stalls.length - proposals.length) };
}

/**
 * The field updates that apply one pull.
 *
 * Deliberately no defer/reschedule split like DeloadProposal's: that exists to
 * protect an *existing* dueDate a recurrence grid or hand-picked series date
 * anchors to, and a pull candidate has no date to protect (hasNoDateSignal).
 */
export function projectPullUpdates(date: Date): Partial<Task> {
  return { dueDate: date.toISOString(), deferUntil: null };
}

/**
 * The single task an auto-scheduled project should date for itself, or null if
 * it isn't due to. Layer B's entire decision.
 */
export function dripCandidate(project: Project, allTasks: readonly Task[]): Task | null {
  if (!project.autoSchedule) return null;
  const stall = findProjectStalls([project], allTasks)[0];
  if (!stall) return null;
  return rankPullCandidates(stall.pullable)[0] ?? null;
}

/** Re-exported so callers don't have to reach into types for the default. */
export { DEFAULT_NUDGE_CADENCE_DAYS };
