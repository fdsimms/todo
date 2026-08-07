import { differenceInCalendarDays, startOfDay } from 'date-fns';
import { PRIORITY_LABELS, type Task, type TimeOfDay } from '../types';
import { getCurrentDayStart, getDeadlineCountdown, getLogicalToday } from './dateUtils';
import { sumEstimatedMinutes } from './effort';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';

/**
 * Local scorer behind "suggest pins". Every criterion here is arithmetic over
 * columns SQLite already holds, which is why this replaced a round-trip to
 * Haiku: the model was handed a *text rendering* of exact facts and asked to
 * estimate over them. Doing it here makes the feature deterministic (the same
 * board always yields the same picks), instant, private, and usable with no
 * API key at all.
 *
 * The shape is greedy with re-scoring: pick the best-scoring task, then score
 * every remaining task again with that pick now part of the list. Only the
 * batch and co-completion terms change between rounds, and that's the point —
 * they're the two that ask "does this go *with* what's already here", which is
 * exactly the coherence a one-shot ranking can't express.
 */

/** How many tasks the suggester fills the pinned list up to. */
export const MAX_SUGGESTED_PINS = 3;

/** Two tasks completed within this long of each other count as one session. */
const CO_COMPLETION_WINDOW_MS = 2 * 60 * 60 * 1000;

/** How far back the co-completion index reads. Bounds the O(n·window) scan. */
const MAX_COMPLETED_HISTORY = 300;

/**
 * Rough minutes a full pinned list should add up to. Not a hard cap — going
 * over costs points (see `overflowPer10Min`) rather than disqualifying a task,
 * so a single long task can still be suggested when it's clearly the right
 * call and nothing shorter competes.
 */
const PIN_BUDGET_MINUTES = 120;

/**
 * Point values for each term. Tuned so priority and lateness dominate the
 * first pick (nothing else is known yet), while batch and co-completion —
 * capped lower individually — can still decide the second and third pick
 * between tasks of similar urgency. That's the intended feel: the list leads
 * with what matters most, then fills with what goes alongside it.
 */
const WEIGHTS = {
  /** Per priority level: 1 = low … 4 = urgent. */
  priorityPerLevel: 12,

  /** Flat credit once a task's due day has arrived. */
  dueToday: 10,
  /** Added per day late, on top of `dueToday`, saturating at the cap — a task
   *  three weeks overdue is not meaningfully more urgent than one two weeks
   *  overdue, and without a cap ancient tasks would crowd out everything. */
  overduePerDay: 2.5,
  overdueCapDays: 14,

  /** A deadline at or past due. Scales to 0 over the following week. */
  deadlinePassed: 25,
  deadlinePerDayCloser: 3,

  /** The task names the time-of-day segment currently in progress… */
  segmentMatch: 15,
  /** …or names only other segments, which makes now the wrong time for it. */
  segmentMismatch: -10,

  /** Shared context with a task already on the list. Scored as the max over
   *  that list rather than the sum, so a third task from the same category
   *  can't out-earn a genuinely urgent one just by matching twice. */
  sameCategory: 8,
  sameProject: 8,
  sharedTag: 6,

  /** Per historical co-completion with a task already on the list. */
  coOccurrencePerPair: 5,
  coOccurrenceCap: 5,

  /** Per 10 minutes the list would run past PIN_BUDGET_MINUTES, floored so
   *  overflow can shape the pick order without vetoing a task outright. */
  overflowPer10Min: 1,
  overflowFloor: -30,
} as const;

/**
 * Everything the scorer needs to know about "now" and the user's settings.
 * Passed in rather than read inside the scoring functions so the weights can
 * be tested against a fixed clock without mocking three stores.
 */
export interface PinContext {
  /** Start of the current logical day (respects dayResetTime). */
  todayStart: Date;
  /** Time-of-day segment currently in progress. */
  currentSegment: TimeOfDay;
  /** Names of categories the user has opted out of suggested pins. */
  excludedCategories: Set<string>;
  /** Co-completion counts keyed by `coKey(titleA, titleB)`. */
  coOccurrence: Map<string, number>;
}

/** Stable key for an unordered pair of task titles. */
function coKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x} ↔ ${y}`;
}

/**
 * Count how often each pair of task titles was completed inside the same
 * session. Titles rather than ids because a recurring task is a new row every
 * occurrence — the id changes, the title is what persists across them.
 */
export function buildCoOccurrenceIndex(completedTasks: Task[]): Map<string, number> {
  const recent = completedTasks
    .filter(t => t.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    .slice(0, MAX_COMPLETED_HISTORY)
    .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

  const freq = new Map<string, number>();
  for (let i = 0; i < recent.length; i++) {
    const ti = new Date(recent[i].completedAt!).getTime();
    for (let j = i + 1; j < recent.length; j++) {
      const tj = new Date(recent[j].completedAt!).getTime();
      if (tj - ti > CO_COMPLETION_WINDOW_MS) break;
      // A task never pairs with another occurrence of itself; that's a streak,
      // not evidence that two different things get done together.
      if (recent[i].title.toLowerCase() === recent[j].title.toLowerCase()) continue;
      const key = coKey(recent[i].title, recent[j].title);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  return freq;
}

/** Which time-of-day segment the given moment falls in. */
export function currentTimeSegment(now: Date = new Date()): TimeOfDay {
  const { morningStart, afternoonStart, eveningStart, nightStart } = useSettingsStore.getState();
  const order: [TimeOfDay, string][] = [
    ['morning', morningStart],
    ['afternoon', afternoonStart],
    ['evening', eveningStart],
    ['night', nightStart],
  ];

  // Anchored to the logical day for the same reason getTimeOfDayThreshold is:
  // before dayResetTime the wall-clock date has already flipped, and comparing
  // against it would read every segment as still ahead of us.
  let current: TimeOfDay = 'night';
  for (const [segment, hhmm] of order) {
    const [h, m] = hhmm.split(':').map(Number);
    const threshold = getCurrentDayStart();
    threshold.setHours(h, m, 0, 0);
    if (threshold <= now) current = segment;
  }
  // Nothing has started yet on this logical day — we're in the small hours
  // before the first segment, which is night's tail.
  return current;
}

/** Read the current clock and settings into a scoring context. */
export function buildPinContext(completedTasks: Task[] = []): PinContext {
  const excludedCategories = new Set(
    useCategoryStore.getState().categories
      .filter(c => c.excludeFromPinSuggestions)
      .map(c => c.name)
  );

  return {
    todayStart: getLogicalToday(),
    currentSegment: currentTimeSegment(),
    excludedCategories,
    coOccurrence: buildCoOccurrenceIndex(completedTasks),
  };
}

/**
 * Days a task is late by, in calendar days on the logical day boundary.
 * Positive = overdue, 0 = due today, negative = not due yet, null = no date.
 *
 * All local-time arithmetic. The version this replaced compared
 * `new Date().toISOString().split('T')[0]` against `dueDate.split('T')[0]`,
 * which is off by a day everywhere east of UTC+12 — `dueDate` is stored at
 * local noon, so its UTC date is the *next* day there.
 */
export function overdueDays(task: Task, todayStart: Date): number | null {
  if (!task.dueDate) return null;
  return differenceInCalendarDays(todayStart, startOfDay(new Date(task.dueDate)));
}

function dueScore(task: Task, ctx: PinContext): number {
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

function segmentScore(task: Task, ctx: PinContext): number {
  if (task.timeSegments.length === 0) return 0;
  return task.timeSegments.includes(ctx.currentSegment)
    ? WEIGHTS.segmentMatch
    : WEIGHTS.segmentMismatch;
}

/** How much `task` looks like it belongs with one specific listed task. */
function affinity(task: Task, other: Task, ctx: PinContext): number {
  let score = 0;
  if (task.category && task.category === other.category) score += WEIGHTS.sameCategory;
  if (task.projectId && task.projectId === other.projectId) score += WEIGHTS.sameProject;
  if (task.tags.some(tag => other.tags.includes(tag))) score += WEIGHTS.sharedTag;

  const pairs = ctx.coOccurrence.get(coKey(task.title, other.title)) ?? 0;
  // A single shared session is as likely coincidence as habit; two is a
  // pattern. Same threshold the old prompt used before stringifying these.
  if (pairs > 1) {
    score += Math.min(pairs, WEIGHTS.coOccurrenceCap) * WEIGHTS.coOccurrencePerPair;
  }
  return score;
}

function overflowScore(task: Task, listed: Task[]): number {
  const total = sumEstimatedMinutes([...listed, task]);
  if (total <= PIN_BUDGET_MINUTES) return 0;
  const penalty = ((total - PIN_BUDGET_MINUTES) / 10) * WEIGHTS.overflowPer10Min;
  return Math.max(WEIGHTS.overflowFloor, -penalty);
}

/**
 * Score one candidate against the tasks already on the pinned list. Exported
 * for testing and for anything that wants to explain a ranking.
 */
export function scoreTask(task: Task, listed: Task[], ctx: PinContext): number {
  const base =
    task.priority * WEIGHTS.priorityPerLevel +
    dueScore(task, ctx) +
    deadlineScore(task) +
    segmentScore(task, ctx);

  const batch = listed.length === 0
    ? 0
    : Math.max(...listed.map(other => affinity(task, other, ctx)));

  return base + batch + overflowScore(task, listed);
}

/**
 * The tasks eligible to be suggested, in the order ties resolve in.
 *
 * Opted-out categories (Routines, Errands, …) are real work but poor company
 * on a shortlist — dropping them here rather than penalising them keeps the
 * setting meaning what it says. Manual pinning is untouched.
 */
function eligible(tasks: Task[], ctx: PinContext, exclude: Set<string>): Task[] {
  return tasks
    .filter(t =>
      !t.pinned &&
      !exclude.has(t.id) &&
      !(t.category !== null && ctx.excludedCategories.has(t.category))
    )
    // Ties resolve by the user's own ordering, so the same board always
    // produces the same picks — the previous implementation ran at the API's
    // default temperature and could return a different list on a re-tap.
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * The single best task to add to `listed`, ignoring anything in `excludeIds`.
 *
 * This is the greedy step `suggestPins` runs in a loop, exported because the
 * confirmation sheet needs it one pick at a time: swapping a row out means
 * "best candidate that isn't already on screen and hasn't been rejected", with
 * the *other* rows passed as `listed` so the batch terms still score against
 * what the user is keeping. Returns null when the pool is exhausted.
 */
export function nextPinSuggestion(
  tasks: Task[],
  listed: Task[],
  excludeIds: readonly string[],
  ctx: PinContext,
): string | null {
  const pool = eligible(tasks, ctx, new Set(excludeIds));
  if (pool.length === 0) return null;

  let best = pool[0];
  let bestScore = scoreTask(pool[0], listed, ctx);
  for (let i = 1; i < pool.length; i++) {
    const score = scoreTask(pool[i], listed, ctx);
    // Strictly greater, so an exact tie keeps the earlier (lower sortOrder)
    // task — the tie-break `eligible`'s sort already established.
    if (score > bestScore) {
      bestScore = score;
      best = pool[i];
    }
  }
  return best.id;
}

/**
 * Pick up to `MAX_SUGGESTED_PINS` tasks to pin, given what's already pinned.
 *
 * `tasks` should be the tasks in play (the Today list); already-pinned tasks
 * and tasks in an opted-out category are filtered out here, so callers don't
 * have to. Returns ids in the order they were picked.
 */
export function suggestPins(
  tasks: Task[],
  alreadyPinned: Task[],
  ctx: PinContext,
): string[] {
  const needed = MAX_SUGGESTED_PINS - alreadyPinned.length;
  if (needed <= 0) return [];

  const byId = new Map(tasks.map(t => [t.id, t]));
  const listed = [...alreadyPinned];
  const picked: string[] = [];

  while (picked.length < needed) {
    const id = nextPinSuggestion(tasks, listed, picked, ctx);
    if (id === null) break;
    picked.push(id);
    listed.push(byId.get(id)!);
  }

  return picked;
}

/**
 * A short "why this one" for a suggested row — the term that contributed most
 * to its score, phrased for someone who isn't reading the weights.
 *
 * Only the terms a user can act on are named: the batch terms say which task
 * this one goes with, so the sheet can show a swap as a change of company and
 * not just a change of row.
 */
export function pinReason(task: Task, listed: Task[], ctx: PinContext): string | null {
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

  let bestCompanion: { score: number; other: Task } | null = null;
  for (const other of listed) {
    const score = affinity(task, other, ctx);
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

/**
 * Store-reading convenience wrapper: builds the context off the current clock
 * and settings, then runs the scorer. This is what the Today screen calls.
 */
export function suggestPinTasks(
  tasks: Task[],
  alreadyPinned: Task[],
  completedTasks: Task[] = [],
): string[] {
  return suggestPins(tasks, alreadyPinned, buildPinContext(completedTasks));
}
