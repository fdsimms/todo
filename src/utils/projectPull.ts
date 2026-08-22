import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, Task } from '../types';
import { DEFAULT_NUDGE_CADENCE_DAYS } from '../types';
import { getCurrentDayStart, getDayStart } from './dateUtils';
import { hasNoDateSignal, isHeldBack } from './visibilityUtils';
import { liveProjectSteps } from './projectOrder';
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

/**
 * Who is asking, which decides whether `nudgeCadenceDays` is a gate or just a
 * sort key.
 *
 * 'nudge' — the app volunteering: the accent tint and "N projects gone quiet"
 * on the Today options row, and the auto-schedule drip, which dates a task
 * unattended. Both speak without being asked, so the cadence gates them. A
 * project nobody opted in is silent, which is the whole point of the 0 default.
 *
 * 'ask' — the user tapped "Pull from projects". The cadence answers "when
 * should I chase you unprompted", and that is not the question a tap on the
 * button asks: tapping it *is* the nudge, so there is nothing left to opt into.
 * Gating it too made the sheet inert for everyone — 0 is the default for new
 * projects as well as the migration backfill, so every project ever created is
 * excluded until its cadence is set by hand, and the sheet answered a board of
 * entirely undated projects with "nothing waiting". The cadence still *ranks*
 * here (see overdueBy), it just doesn't exclude.
 *
 * It also can't exclude honestly: 0 is both "I parked this project" and "I have
 * never opened this picker", and nothing distinguishes them.
 */
export type StallMode = 'nudge' | 'ask';

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
  /**
   * quietDays - cadenceDays. Drives the ordering, and does the right thing in
   * both modes without a second sort key: in 'nudge' it's >= 0 by construction,
   * and in 'ask' an un-opted-in project subtracts nothing, so it ranks on how
   * long it's actually been quiet, while a project whose own cadence hasn't
   * come round yet goes negative and sorts below the ones overdue for it.
   */
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

/**
 * Why the sheet has nothing to offer, when it has nothing to offer.
 *
 * There are seven ways to produce an empty plan and the sheet used to name one
 * of them unconditionally ("every project has something scheduled"). On an
 * install that predates the feature that message is the opposite of the truth:
 * the migration backfills nudge_cadence_days to 0 — deliberately, so the
 * feature doesn't start by nagging about projects nobody opted in — so every
 * existing project reads as "never nudge me", and a board of entirely undated
 * projects gets told they're all scheduled. Nothing else in the sheet points
 * at the switch that's actually off, so the copy has to.
 */
export type PullEmptyReason =
  /** Vacation mode silences the feature wholesale. */
  | 'vacation'
  /** No unarchived projects to pull from at all. */
  | 'no-projects'
  /** nudgeOptIn is false — the project is excluded from every nudge surface. */
  | 'nudge-excluded'
  /** nudgeCadenceDays is 0 — the project has never been opted in. */
  | 'cadence-off'
  /** Stalled, but on auto-schedule, so the drip handles it instead. */
  | 'auto-scheduled'
  /** Quiet, but not yet for as long as its own cadence asks. */
  | 'too-soon'
  /** A member carries a date signal, so the project isn't silent. */
  | 'has-schedule'
  /** Everything left is waiting on another task, which a date can't free. */
  | 'all-waiting'
  /** Only mid-chain steps left, which can't be dated. */
  | 'no-pullable'
  /** The user cleared what the drip scheduled today — it stands down till tomorrow. */
  | 'declined-today'
  /** Nothing live left in it — empty, or finished. */
  | 'no-live-tasks';

export interface PullEmptyState {
  reason: PullEmptyReason;
  /** Unarchived projects this reason accounts for. */
  count: number;
  /** Unarchived projects considered. */
  total: number;
  /** 'too-soon' only: days until the nearest project goes quiet. */
  daysUntilQuiet?: number;
}

export interface ProjectPullPlan {
  proposals: ProjectPullProposal[];
  /** Stalled projects that didn't fit in MAX_PULLED_PROJECTS. */
  overflowCount: number;
  /** Populated only when there are no proposals; null otherwise. */
  empty: PullEmptyState | null;
}

/**
 * A mid-chain step is undated by construction and advances on completion, not
 * by date (see completeTask's spawnsNext logic) — dating one is meaningless.
 * Same test taskMoves.deloadBlockerFor uses for its 'chain' blocker.
 */
function isPullable(task: Task): boolean {
  return !(task.chainEnabled && task.chainItems.length > 0 && task.chainIndex > 0);
}

/**
 * The user cleared, today, a date the drip put on this project — an
 * autoScheduledAt stamp with no dueDate left beside it (see Task.autoScheduledAt).
 *
 * Clearing a date is the one way to say "not this project today" that costs a
 * single tap, and until this existed the drip couldn't see it: clearing
 * restores hasNoDateSignal, which is *precisely* what makes a project stalled,
 * so the next foreground dated the same task again seconds later. Nothing the
 * user could do short of completing or archiving reset the quiet clock, because
 * lastTouchedAt only moves on a completion.
 *
 * Scoped to the project, not the task, because the refusal is about the project
 * — picking the runner-up candidate instead would be the same interruption
 * wearing a different title. And scoped to the logical day, not to the cadence:
 * a full cadence is the user's answer to "how often should I be chased", not to
 * "I'm not doing this today", and on a fortnightly project it would bury the
 * task for two weeks over one tap.
 */
function declinedToday(members: readonly Task[], todayStart: Date): boolean {
  return members.some(
    t =>
      t.autoScheduledAt !== null &&
      hasNoDateSignal(t) &&
      +getDayStart(new Date(t.autoScheduledAt)) === +todayStart
  );
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

/** Top-level rows per project, in one pass. */
function bucketByProject(tasks: readonly Task[]): Map<string, Task[]> {
  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.projectId || t.parentId !== null) continue;
    const bucket = byProject.get(t.projectId);
    if (bucket) bucket.push(t);
    else byProject.set(t.projectId, [t]);
  }
  return byProject;
}

/** Either the project has stalled, or here is the gate that said it hasn't. */
type ProjectVerdict =
  | { stall: ProjectStall; reason?: undefined; daysUntilQuiet?: undefined }
  | { stall?: undefined; reason: PullEmptyReason; daysUntilQuiet?: number };

/**
 * The gates, in order, for one project — shared by findProjectStalls (which
 * wants the stalls) and diagnosePullEmpty (which wants the refusals). Written
 * once so the empty-state copy can't drift from the rule it's describing.
 */
function classifyProject(
  project: Project,
  allMembers: readonly Task[],
  todayStart: Date,
  mode: StallMode,
): ProjectVerdict {
  // Excluded from every nudge surface, in both modes — unlike cadenceDays
  // below, this isn't softened for a sheet the user opened by hand. A
  // reference list ("Gift ideas") is never a candidate to pull into today,
  // whether the app suggests it or the user goes looking.
  if (!project.nudgeOptIn) return { reason: 'nudge-excluded' };

  // 0 means "don't bring this up unasked", for a project deliberately parked —
  // not a degenerate cadence. It silences the volunteered surfaces only; see
  // StallMode for why a sheet the user opened themselves ignores it.
  const cadenceDays = project.nudgeCadenceDays;
  if (mode === 'nudge' && cadenceDays <= 0) return { reason: 'cadence-off' };

  const members = allMembers.filter(t => !t.completed && !t.archived);
  // No live members at all. Covers both the empty shell and the project whose
  // members are all done — that one isn't silent, it's finished.
  if (members.length === 0) return { reason: 'no-live-tasks' };

  // A held-back member is invisible everywhere a date could put it, so it can
  // neither rescue the project from being quiet nor be the thing pulled in —
  // this is the same argument the sequential slice below already makes, applied
  // to both ways a task can be held (see visibilityUtils.isHeldBack). Without
  // it the drip dates a waiting task unattended, which then reads as a schedule
  // the project hasn't got and silences the nudge until its blocker is done.
  const actionable = members.filter(t => !isHeldBack(t));
  if (actionable.length === 0) return { reason: 'all-waiting' };

  // One scheduled member and the project is not quiet. hasNoDateSignal is the
  // same predicate the visibility gates use, so "stalled" means precisely
  // "nothing in here can appear anywhere".
  if (!actionable.every(hasNoDateSignal)) return { reason: 'has-schedule' };

  // A sequential project has exactly one task available to bring into play,
  // whatever else is sitting in it: dating a step further down the order lands
  // it on a day it still can't appear on (isSequenceBlocked), so the sheet
  // would be offering a task that then goes nowhere — and auto-schedule would
  // do it unattended. Ranked over every live member rather than over
  // `actionable`, so a held first step refuses rather than promoting step two.
  const available = project.sequential
    ? liveProjectSteps(project.id, members).slice(0, 1).filter(t => !isHeldBack(t))
    : actionable;
  const pullable = available.filter(isPullable);
  if (pullable.length === 0) return { reason: 'no-pullable' };

  // Nudge-mode only, for the same reason the cadence is: this answers "should I
  // speak up unasked today", and a sheet the user opened themselves has already
  // been asked. Tapping "Pull from projects" an hour after clearing a drip is a
  // change of mind, and the sheet should honour it.
  if (mode === 'nudge' && declinedToday(members, todayStart)) {
    return { reason: 'declined-today', daysUntilQuiet: 1 };
  }

  const touched = lastTouchedAt(project, allMembers);
  // Calendar days on the logical day boundary, never string-sliced ISO — see
  // the timezone note on pinSuggest.overdueDays.
  const quietDays = differenceInCalendarDays(todayStart, getDayStart(new Date(touched)));
  // The cadence is a threshold only for the surfaces that speak first. Asked
  // directly, a project that went quiet yesterday is still a fair suggestion —
  // it just ranks below one that's been quiet a month (see overdueBy).
  if (mode === 'nudge' && quietDays < cadenceDays) {
    return { reason: 'too-soon', daysUntilQuiet: cadenceDays - quietDays };
  }

  return {
    stall: {
      project,
      members,
      pullable,
      lastTouchedAt: touched,
      quietDays,
      cadenceDays,
      overdueBy: quietDays - cadenceDays,
    },
  };
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
  mode: StallMode = 'nudge',
): ProjectStall[] {
  // Vacation mode silences the whole feature, in both modes — unlike the
  // cadence, it's a deliberate, unambiguous "hide work from me" the user set
  // today, and every route out of this sheet dates a task.
  if (useSettingsStore.getState().vacationMode) return [];

  const byProject = bucketByProject(tasks);
  const todayStart = getCurrentDayStart();
  const stalls: ProjectStall[] = [];

  for (const project of projects) {
    // A completed project is done, same as an archived one — neither has a
    // "next task" to nudge for.
    if (project.archived || project.completed) continue;
    const verdict = classifyProject(project, byProject.get(project.id) ?? [], todayStart, mode);
    if (verdict.stall) stalls.push(verdict.stall);
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

  const today = getCurrentDayStart();
  today.setHours(12, 0, 0, 0);
  return { date: today, dayLabel: 'Today', reason: `quiet ${quietDays} days` };
}

/**
 * Which reason to name when several apply. Ordered by how much it tells the
 * user they can act on: an unset cadence is a switch they can flip, a project
 * that isn't quiet yet has a date, and "everything's scheduled" is the one that
 * needs no action at all.
 */
const REASON_PRIORITY: readonly PullEmptyReason[] = [
  'nudge-excluded',
  'cadence-off',
  'too-soon',
  'declined-today',
  'auto-scheduled',
  'has-schedule',
  'all-waiting',
  'no-pullable',
  'no-live-tasks',
];

/**
 * Why an empty plan is empty — the most common reason across the board, ties
 * broken by REASON_PRIORITY. Returns null if some project did stall after all,
 * which only happens if this is called on a plan that wasn't empty.
 *
 * Runs its own pass rather than riding along with findProjectStalls, because
 * the answer is only wanted on the rare open where the sheet has nothing, and
 * the stall path runs on every Today render.
 */
export function diagnosePullEmpty(
  projects: readonly Project[],
  tasks: readonly Task[],
  mode: StallMode = 'ask',
): PullEmptyState | null {
  if (useSettingsStore.getState().vacationMode) {
    return { reason: 'vacation', count: 0, total: 0 };
  }

  const active = projects.filter(p => !p.archived && !p.completed);
  if (active.length === 0) return { reason: 'no-projects', count: 0, total: 0 };

  const byProject = bucketByProject(tasks);
  const todayStart = getCurrentDayStart();
  const counts = new Map<PullEmptyReason, number>();
  let daysUntilQuiet: number | undefined;

  for (const project of active) {
    const verdict = classifyProject(project, byProject.get(project.id) ?? [], todayStart, mode);
    // A stall that got here is one buildProjectPullPlan filtered out, which it
    // only does for auto-schedule — that project is being handled, not ignored.
    const reason = verdict.stall
      ? verdict.stall.project.autoSchedule
        ? ('auto-scheduled' as const)
        : null
      : verdict.reason;
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    if (
      verdict.daysUntilQuiet !== undefined &&
      (daysUntilQuiet === undefined || verdict.daysUntilQuiet < daysUntilQuiet)
    ) {
      daysUntilQuiet = verdict.daysUntilQuiet;
    }
  }

  let best: PullEmptyReason | null = null;
  for (const reason of REASON_PRIORITY) {
    const count = counts.get(reason) ?? 0;
    if (count === 0) continue;
    if (best === null || count > (counts.get(best) ?? 0)) best = reason;
  }
  if (best === null) return null;

  return {
    reason: best,
    count: counts.get(best) ?? 0,
    total: active.length,
    ...(best === 'too-soon' && daysUntilQuiet !== undefined ? { daysUntilQuiet } : {}),
  };
}

/** The sheet's empty-state sentence. */
export function describePullEmpty(state: PullEmptyState): string {
  const { count, total } = state;
  const projects = (n: number) => `${n} project${n === 1 ? '' : 's'}`;
  // Named reason plus "and the rest didn't qualify either" — the head sentence
  // must never imply it covers every project when it doesn't.
  const rest = count > 0 && count < total ? ' The rest have nothing to pull yet.' : '';

  switch (state.reason) {
    case 'vacation':
      return 'Vacation mode is on. Project nudges are paused until you turn it off.';
    case 'no-projects':
      return 'No projects yet. Tasks filed under one can be pulled in from here.';
    case 'nudge-excluded':
      return count === total
        ? 'No project is included in nudges yet. Open a project and turn on “Include in nudges” to have it show up here.'
        : `${projects(count)} of ${total} aren't included in nudges. Turn on “Include in nudges” on one to have it show up here.${rest}`;
    case 'cadence-off':
      return count === total
        ? 'No project is set to be nudged yet. Open a project and set “Nudge me” to have it show up here.'
        : `${projects(count)} of ${total} aren't set to be nudged. Set “Nudge me” on one to include it.${rest}`;
    case 'too-soon':
      return state.daysUntilQuiet !== undefined
        ? `Nothing has been quiet long enough yet. The next one is due in ${state.daysUntilQuiet} day${state.daysUntilQuiet === 1 ? '' : 's'}.`
        : 'Nothing has been quiet long enough yet.';
    case 'declined-today':
      // Only reachable from a 'nudge'-mode diagnosis — the sheet asks in 'ask'
      // mode, where a change of mind is honoured (see classifyProject).
      return count === total
        ? 'You cleared what was scheduled today. Nothing new until tomorrow.'
        : `${projects(count)} of ${total} had today's suggestion cleared.${rest}`;
    case 'auto-scheduled':
      return `${count === 1 ? 'One quiet project is' : `${projects(count)} are quiet and`} on auto-schedule. The next task gets dated without you.${rest}`;
    case 'has-schedule':
      return count === total
        ? 'Every project has something scheduled.'
        : `${projects(count)} of ${total} already have something scheduled.${rest}`;
    case 'all-waiting':
      return count === total
        ? 'Everything left is waiting on another task. Those come back once the task they wait on is done.'
        : `${projects(count)} of ${total} have only tasks that are waiting on another task.${rest}`;
    case 'no-pullable':
      return count === total
        ? 'Only mid-chain steps are left, and those get their turn by being completed, not by being dated.'
        : `${projects(count)} of ${total} have only mid-chain steps left, which can't be dated.${rest}`;
    case 'no-live-tasks':
      return count === total
        ? 'Nothing left to do in any project.'
        : `${projects(count)} of ${total} have nothing left to do.${rest}`;
  }
}

/**
 * Build the plan the sheet reviews. 'ask' mode: the user opened this, so every
 * quiet project is a candidate whether or not it was opted in for nudging (see
 * StallMode), ranked by how overdue it is for attention.
 *
 * Projects on auto-schedule never appear here — the drip handles them, so they
 * can't be nagged and dripped at once. The two layers coordinate through the
 * data, not through a flag.
 */
export function buildProjectPullPlan(
  projects: readonly Project[],
  allTasks: readonly Task[],
  todaysTasks: readonly Task[],
  /**
   * When set, restricts the plan to these projects only — used when the sheet
   * is opened from the quiet-project nudge, which is already about a specific
   * project (or handful of them), not the whole board.
   */
  scopeProjectIds?: readonly string[],
): ProjectPullPlan {
  let stalls = findProjectStalls(projects, allTasks, 'ask').filter(s => !s.project.autoSchedule);
  if (scopeProjectIds && scopeProjectIds.length > 0) {
    const scope = new Set(scopeProjectIds);
    stalls = stalls.filter(s => scope.has(s.project.id));
  }
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

  return {
    proposals,
    overflowCount: Math.max(0, stalls.length - proposals.length),
    empty: proposals.length === 0 ? diagnosePullEmpty(projects, allTasks) : null,
  };
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
 *
 * Stays in 'nudge' mode, and must: this dates a task with nobody watching, so
 * the cadence is the only thing deciding when. (The editor already refuses to
 * store autoSchedule without one, so the gate is never load-bearing here — but
 * it's the gate that makes that invariant safe to rely on rather than assume.)
 */
export function dripCandidate(project: Project, allTasks: readonly Task[]): Task | null {
  if (!project.autoSchedule) return null;
  const stall = findProjectStalls([project], allTasks, 'nudge')[0];
  if (!stall) return null;
  return rankPullCandidates(stall.pullable)[0] ?? null;
}

/** Re-exported so callers don't have to reach into types for the default. */
export { DEFAULT_NUDGE_CADENCE_DAYS };
