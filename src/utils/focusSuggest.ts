import { PRIORITY_LABELS, type Task, type TimeOfDay } from '../types';
import { getDeadlineCountdown, getLogicalToday } from './dateUtils';
import { estimatedMinutesFor, formatDuration } from './effort';
import { currentTimeSegment, overdueDays } from './pinSuggest';
import { isBlocked, resolverFor, type TaskResolver } from './blocking';

/**
 * Which tasks to offer for a focus session, and why.
 *
 * Deliberately the same shape as `pinSuggest.ts` — greedy pick, re-score,
 * batch terms that ask "does this go *with* what's already queued" — because
 * it's answering the same kind of question and the confirmation sheet built on
 * it works the same way (swap a row, keep the company). The clock and overdue
 * helpers are imported from there rather than rewritten; only the weights and
 * the eligibility rules differ, and they differ because a focus queue is not a
 * shortlist of what matters most. It's an hour of your attention, in order.
 *
 * Three rules follow from that, and they're the whole difference:
 *
 * - **An estimate is worth real points.** The plan's stretches are cut from
 *   `estimatedMinutesFor`, so a task carrying a number is one the session can
 *   be honest about; a task without one gets `focusDefaultWorkMinutes`, which
 *   is a guess wearing a countdown. Not a veto (an urgent unestimated task
 *   still belongs in the queue) but the tiebreak between otherwise equal work.
 * - **Very short tasks are penalised.** Sitting a two-minute task under a
 *   25-minute stretch and a chime is a worse experience than just doing it,
 *   and it burns a break on nothing.
 * - **Blocked tasks are excluded outright**, not penalised. Everything else
 *   here is a judgement about what's worth doing next; a task waiting on
 *   another one is work you *cannot* do, and a queue that puts you in front of
 *   it has already failed.
 */

/** How many tasks the suggester offers up. */
export const MAX_SUGGESTED_FOCUS = 5;

/**
 * Roughly how much work a session should add up to. Soft, like
 * `PIN_BUDGET_MINUTES`: going over costs points rather than disqualifying a
 * task, so one long task can still be suggested when nothing shorter competes.
 */
export const FOCUS_BUDGET_MINUTES = 120;

/** At or under this, a task is quicker to just do than to schedule around. */
const SHORT_TASK_MINUTES = 5;

const WEIGHTS = {
  /** Per priority level: 1 = low … 4 = urgent. */
  priorityPerLevel: 10,

  dueToday: 10,
  overduePerDay: 2,
  overdueCapDays: 14,

  deadlinePassed: 22,
  deadlinePerDayCloser: 3,

  segmentMatch: 12,
  segmentMismatch: -10,

  /** The task carries a real estimate, so its stretch is a measurement. */
  hasEstimate: 14,
  /** Short enough that a focus block is overhead rather than help. */
  tooShort: -18,

  /** Shared context with a task already queued. Scored as the max over that
   *  queue rather than the sum, so a third task from one category can't
   *  out-earn genuinely urgent work just by matching twice. Worth more than
   *  the pin equivalents: a session that stays in one context is the point of
   *  running one, where a pinned list is only a shortlist. */
  sameCategory: 10,
  sameProject: 10,
  sharedTag: 7,

  /** Per 10 minutes the queue would run past FOCUS_BUDGET_MINUTES. */
  overflowPer10Min: 1.5,
  overflowFloor: -30,
} as const;

export interface FocusContext {
  /** Start of the current logical day (respects dayResetTime). */
  todayStart: Date;
  /** Time-of-day segment currently in progress. */
  currentSegment: TimeOfDay;
  /** Resolves blocker ids, so a blocked task can be dropped from the pool. */
  resolve: TaskResolver;
}

/**
 * Read the current clock and task list into a scoring context.
 *
 * `allTasks` is the full list rather than the candidate pool: the resolver has
 * to be able to find a blocker that isn't itself a candidate, which is the
 * usual case (you're blocked by something that isn't on today).
 */
export function buildFocusContext(allTasks: readonly Task[]): FocusContext {
  return {
    todayStart: getLogicalToday(),
    currentSegment: currentTimeSegment(),
    resolve: resolverFor([...allTasks]),
  };
}

function dueScore(task: Task, ctx: FocusContext): number {
  const late = overdueDays(task, ctx.todayStart);
  if (late == null || late < 0) return 0;
  if (late === 0) return WEIGHTS.dueToday;
  return WEIGHTS.dueToday + Math.min(late, WEIGHTS.overdueCapDays) * WEIGHTS.overduePerDay;
}

function deadlineScore(task: Task): number {
  if (!task.deadline) return 0;
  const days = getDeadlineCountdown(task.deadline);
  if (days <= 0) return WEIGHTS.deadlinePassed;
  return Math.max(0, WEIGHTS.deadlinePassed - days * WEIGHTS.deadlinePerDayCloser);
}

function segmentScore(task: Task, ctx: FocusContext): number {
  if (task.timeSegments.length === 0) return 0;
  return task.timeSegments.includes(ctx.currentSegment)
    ? WEIGHTS.segmentMatch
    : WEIGHTS.segmentMismatch;
}

/** Credit for carrying a usable estimate, debit for being too small to bother. */
function estimateScore(task: Task): number {
  const minutes = estimatedMinutesFor(task);
  if (minutes == null || minutes <= 0) return 0;
  if (minutes <= SHORT_TASK_MINUTES) return WEIGHTS.tooShort;
  return WEIGHTS.hasEstimate;
}

/** How much `task` looks like it belongs alongside one specific queued task. */
function affinity(task: Task, other: Task): number {
  let score = 0;
  if (task.category && task.category === other.category) score += WEIGHTS.sameCategory;
  if (task.projectId && task.projectId === other.projectId) score += WEIGHTS.sameProject;
  if (task.tags.some(tag => other.tags.includes(tag))) score += WEIGHTS.sharedTag;
  return score;
}

/**
 * What a task will actually cost the session: its estimate, or nothing when it
 * has none. The default stretch length isn't charged here because it's a
 * setting this module doesn't read — the budget term only has to rank
 * candidates against each other, and an unestimated task is already handled by
 * `estimateScore`.
 */
function queueMinutes(tasks: readonly Task[]): number {
  return tasks.reduce((sum, t) => sum + (estimatedMinutesFor(t) ?? 0), 0);
}

function overflowScore(task: Task, listed: readonly Task[]): number {
  const total = queueMinutes([...listed, task]);
  if (total <= FOCUS_BUDGET_MINUTES) return 0;
  const penalty = ((total - FOCUS_BUDGET_MINUTES) / 10) * WEIGHTS.overflowPer10Min;
  return Math.max(WEIGHTS.overflowFloor, -penalty);
}

/** Score one candidate against the tasks already queued. */
export function scoreFocusTask(task: Task, listed: readonly Task[], ctx: FocusContext): number {
  const base =
    task.priority * WEIGHTS.priorityPerLevel +
    dueScore(task, ctx) +
    deadlineScore(task) +
    segmentScore(task, ctx) +
    estimateScore(task);

  const batch = listed.length === 0
    ? 0
    : Math.max(...listed.map(other => affinity(task, other)));

  return base + batch + overflowScore(task, listed);
}

/**
 * The tasks eligible to be suggested, in the order ties resolve in.
 *
 * Subtasks are dropped because a focus stretch is cut from the task's own
 * estimate and a subtask's minutes mean something else entirely (a stretch of
 * its *parent's* countdown, see utils/timerSegments.ts). Ticking one off from
 * a session would also leave the parent sitting there looking undone.
 */
function eligible(tasks: readonly Task[], ctx: FocusContext, exclude: Set<string>): Task[] {
  return tasks
    .filter(t =>
      !t.completed &&
      !t.archived &&
      t.parentId === null &&
      !exclude.has(t.id) &&
      !isBlocked(t, ctx.resolve)
    )
    // Ties resolve by the user's own ordering, so the same board always
    // produces the same queue.
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * The single best task to add to `listed`, ignoring anything in `excludeIds`.
 *
 * Exported for the same reason `nextPinSuggestion` is: the setup sheet needs
 * the greedy step one pick at a time, so swapping a row means "best candidate
 * not already on screen and not rejected", scored against the rows the user is
 * keeping. Returns null when the pool is exhausted.
 */
export function nextFocusSuggestion(
  tasks: readonly Task[],
  listed: readonly Task[],
  excludeIds: readonly string[],
  ctx: FocusContext,
): string | null {
  const pool = eligible(tasks, ctx, new Set(excludeIds));
  if (pool.length === 0) return null;

  let best = pool[0];
  let bestScore = scoreFocusTask(pool[0], listed, ctx);
  for (let i = 1; i < pool.length; i++) {
    const score = scoreFocusTask(pool[i], listed, ctx);
    // Strictly greater, so an exact tie keeps the earlier task — the tie-break
    // `eligible`'s sort already established.
    if (score > bestScore) {
      bestScore = score;
      best = pool[i];
    }
  }
  return best.id;
}

/**
 * Pick up to `limit` tasks for a focus queue, best first.
 *
 * The order they come back in is the order they were picked, which is also the
 * order the session will run them: the first pick is what most wants doing,
 * and each one after it is chosen partly for going with the ones above it.
 */
export function suggestFocusTasks(
  tasks: readonly Task[],
  ctx: FocusContext,
  limit: number = MAX_SUGGESTED_FOCUS,
): string[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const listed: Task[] = [];
  const picked: string[] = [];

  while (picked.length < limit) {
    const id = nextFocusSuggestion(tasks, listed, picked, ctx);
    if (id === null) break;
    picked.push(id);
    listed.push(byId.get(id)!);
  }

  return picked;
}

/**
 * A short "why this one" for a suggested row, phrased for someone who isn't
 * reading the weights above.
 *
 * Only terms the user can act on are named, and the batch term names the task
 * this one goes with, so swapping a row reads as a change of company rather
 * than just a change of row.
 */
export function focusReason(task: Task, listed: readonly Task[], ctx: FocusContext): string | null {
  const candidates: { score: number; label: string }[] = [];

  if (task.priority > 0) {
    candidates.push({
      score: task.priority * WEIGHTS.priorityPerLevel,
      label: `${PRIORITY_LABELS[task.priority]} priority`,
    });
  }

  const late = overdueDays(task, ctx.todayStart);
  if (late != null && late >= 0) {
    candidates.push({
      score: dueScore(task, ctx),
      label: late === 0 ? 'Due today' : `Waiting ${late} day${late === 1 ? '' : 's'}`,
    });
  }

  if (task.deadline) {
    const days = getDeadlineCountdown(task.deadline);
    candidates.push({
      score: deadlineScore(task),
      label: days <= 0 ? 'Deadline reached' : `Deadline in ${days} day${days === 1 ? '' : 's'}`,
    });
  }

  if (task.timeSegments.includes(ctx.currentSegment)) {
    candidates.push({ score: WEIGHTS.segmentMatch, label: `Set for this ${ctx.currentSegment}` });
  }

  const minutes = estimatedMinutesFor(task);
  if (minutes != null && minutes > SHORT_TASK_MINUTES) {
    candidates.push({ score: WEIGHTS.hasEstimate, label: `Estimated ${formatDuration(minutes)}` });
  }

  let bestCompanion: { score: number; other: Task } | null = null;
  for (const other of listed) {
    const score = affinity(task, other);
    if (score > 0 && (bestCompanion === null || score > bestCompanion.score)) {
      bestCompanion = { score, other };
    }
  }
  if (bestCompanion) {
    candidates.push({ score: bestCompanion.score, label: `Goes with ${bestCompanion.other.title}` });
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.score > a.score ? b : a)).label;
}
