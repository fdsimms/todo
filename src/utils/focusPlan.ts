import type { FocusSession, FocusSessionRecord, FocusStep, FocusStepKind, FocusStepRecord } from '../types';
import { estimatedMinutesFor, type EstimateSource } from './effort';

/**
 * Building and reading a focus session's plan — the ordered run of work
 * stretches and breaks that "focus on these, one at a time" turns into.
 *
 * Two halves, and the split is the design:
 *
 * - **The plan is built once and stored.** `buildFocusPlan` runs when the user
 *   confirms the setup sheet, and the result is what the session commits to.
 *   It is deliberately not re-derived on read: an estimate edited mid-session,
 *   or a settings change, would otherwise reshuffle a run already in progress
 *   and move the finish line under someone who agreed to a specific one.
 * - **Position inside the current step is derived, never stored.** Everything
 *   below taking a `now` reads the clock against `stepStartedAt` /
 *   `stepElapsedSeconds` — the same call `utils/timer.ts` makes about a task
 *   countdown, for the same reason. A stored "seconds left" needs clearing on
 *   pause and goes stale the instant the app is backgrounded.
 *
 * What is *not* derived is which step you're on. `stepIndex` moves only when
 * the user advances (or completes the task under it), so a phone left face
 * down for an hour comes back on the step it was on, over-run, rather than
 * having silently burned through three of them and a break the user never
 * took. That's the one place this deliberately parts company with a classic
 * pomodoro timer, and it's what makes the numbers on screen true.
 */

/** What the plan builder needs of a task: an estimate, and an id to point at. */
export type FocusPlanTask = EstimateSource & { id: string };

/** The rest rules, straight off the settings store. */
export interface FocusPlanOptions {
  /** Longest a single work stretch may run. A longer task is split. */
  workCapMinutes: number;
  /** Stretch length for a task carrying no estimate at all. */
  defaultWorkMinutes: number;
  /** Break after this many tasks are finished. null/0 = don't count tasks. */
  restAfterTasks: number | null;
  /** Break after this much work has accumulated. null/0 = don't count minutes. */
  restAfterMinutes: number | null;
  restMinutes: number;
  /** Every Nth break is a long one. null/0 = every break is a short one. */
  longRestEvery: number | null;
  longRestMinutes: number;
}

/**
 * What the plan will charge one task: its own estimate, or the default work
 * stretch when it hasn't got one.
 *
 * Exported rather than left inline in the builder because the setup sheet
 * prints this number beside each row, and a row disagreeing with the plan
 * under it would be worse than a row with no number at all — the summary
 * already counts the default, so the task has to be labelled with the same
 * minutes the plan gave it. `assumed` is the half the sheet marks with `~`:
 * the task said nothing, the settings did.
 */
export function plannedTaskMinutes(
  task: FocusPlanTask,
  opts: FocusPlanOptions,
): { minutes: number; assumed: boolean } {
  const estimate = estimatedMinutesFor(task);
  if (estimate != null && estimate > 0) return { minutes: estimate, assumed: false };
  return { minutes: opts.defaultWorkMinutes, assumed: true };
}

/** A rest rule that's off is stored as null or 0; both mean "don't count this". */
function ruleOff(value: number | null): boolean {
  return value == null || value <= 0;
}

/**
 * Cut `total` minutes into equal-ish stretches of at most `cap`.
 *
 * Equal parts rather than cap-sized ones plus a remainder: 60 minutes at a
 * 25-minute cap is three stretches of 20, not 25 + 25 + 10. The stub the
 * greedy version leaves is always the last thing you do on a task, which is
 * where the momentum you spent two stretches building is worth the most, and
 * "10 minutes" reads as an afterthought rather than as a third of the work.
 * The remainder is spread over the earlier parts, so the run tapers at worst
 * by a minute rather than falling off a cliff.
 */
export function splitMinutes(total: number, cap: number): number[] {
  const whole = Math.max(1, Math.round(total));
  if (cap <= 0 || whole <= cap) return [whole];
  const parts = Math.ceil(whole / cap);
  const base = Math.floor(whole / parts);
  let remainder = whole - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

function workStep(taskId: string, minutes: number, part: number, partCount: number): FocusStep {
  return { kind: 'work', taskId, minutes, part, partCount, long: false };
}

function restStep(minutes: number, long: boolean): FocusStep {
  return { kind: 'rest', taskId: null, minutes, part: 1, partCount: 1, long };
}

/**
 * Lay the queued tasks out as work stretches with breaks between them.
 *
 * Both rest triggers run at once and whichever fires first inserts the break,
 * which is what "a break every N tasks or every M minutes" means. The task
 * counter only ticks on a task's *last* stretch — a task split across three
 * stretches is one task finished, not three — so between the parts of one long
 * task only the minute trigger can fire, which is exactly the behaviour that
 * makes a 90-minute task break up sensibly.
 *
 * With both triggers off the plan is a straight run of work with no breaks in
 * it, which is a legitimate thing to ask for and not a broken plan.
 */
export function buildFocusPlan(tasks: readonly FocusPlanTask[], opts: FocusPlanOptions): FocusStep[] {
  const steps: FocusStep[] = [];
  let tasksSinceRest = 0;
  let minutesSinceRest = 0;
  let restsSoFar = 0;

  for (const task of tasks) {
    const parts = splitMinutes(plannedTaskMinutes(task, opts).minutes, opts.workCapMinutes);

    parts.forEach((minutes, i) => {
      steps.push(workStep(task.id, minutes, i + 1, parts.length));
      minutesSinceRest += minutes;
      if (i === parts.length - 1) tasksSinceRest += 1;

      const byTasks = !ruleOff(opts.restAfterTasks) && tasksSinceRest >= (opts.restAfterTasks as number);
      const byMinutes = !ruleOff(opts.restAfterMinutes) && minutesSinceRest >= (opts.restAfterMinutes as number);
      if (!byTasks && !byMinutes) return;

      restsSoFar += 1;
      const long = !ruleOff(opts.longRestEvery) && restsSoFar % (opts.longRestEvery as number) === 0;
      steps.push(restStep(long ? opts.longRestMinutes : opts.restMinutes, long));
      tasksSinceRest = 0;
      minutesSinceRest = 0;
    });
  }

  return normalizePlanTail(steps);
}

/**
 * Tidy a run of steps after something was removed from it: no two breaks back
 * to back, and never a break on the end.
 *
 * Both cases only arise once a task is dropped out of a plan mid-session (see
 * `pruneFocusPlan`) — the builder can't produce either. A trailing break is
 * the important one: a break exists to sit between two pieces of work, so one
 * with nothing after it is just the session refusing to admit it's over.
 * Adjacent breaks keep the longer of the two, since a long break is the one
 * that was earned.
 */
export function normalizePlanTail(steps: readonly FocusStep[]): FocusStep[] {
  const out: FocusStep[] = [];
  for (const step of steps) {
    const previous = out[out.length - 1];
    if (step.kind === 'rest' && previous?.kind === 'rest') {
      if (step.minutes > previous.minutes) out[out.length - 1] = step;
      continue;
    }
    out.push(step);
  }
  while (out.length > 0 && out[out.length - 1].kind === 'rest') out.pop();
  return out;
}

// ==== Reading a session against the clock ====

/** The step the session is on, or null once the plan is finished. */
export function currentFocusStep(session: FocusSession): FocusStep | null {
  return session.steps[session.stepIndex] ?? null;
}

/** Has the plan run out of steps? */
export function isFocusSessionFinished(session: FocusSession): boolean {
  return session.stepIndex >= session.steps.length;
}

/** Is the current step's clock running, as opposed to paused? */
export function isFocusRunning(session: FocusSession): boolean {
  return session.stepStartedAt !== null && !isFocusSessionFinished(session);
}

/** Seconds spent on the current step: banked, plus the segment in flight. */
export function focusStepElapsed(session: FocusSession, now: number = Date.now()): number {
  const banked = Math.max(0, session.stepElapsedSeconds);
  if (session.stepStartedAt === null) return banked;
  const started = new Date(session.stepStartedAt).getTime();
  // Clamped like timerElapsed: a clock that moved backwards (timezone change,
  // manual set) would otherwise hand back a negative segment and rewind the
  // step under the user.
  return banked + Math.max(0, (now - started) / 1000);
}

/**
 * Seconds left on the current step. Goes negative once it has run out — the
 * sign is what `isFocusStepDone` reads, and it's what lets the session show
 * how far past its target a step has run rather than just sitting at zero.
 */
export function focusStepRemaining(session: FocusSession, now: number = Date.now()): number {
  const step = currentFocusStep(session);
  if (!step) return 0;
  return step.minutes * 60 - focusStepElapsed(session, now);
}

/** How far through the current step, 0–1. 1 once it has run out. */
export function focusStepProgress(session: FocusSession, now: number = Date.now()): number {
  const step = currentFocusStep(session);
  if (!step || step.minutes <= 0) return 0;
  return Math.min(1, Math.max(0, focusStepElapsed(session, now) / (step.minutes * 60)));
}

/**
 * Has the current step used up its minutes?
 *
 * This never advances anything by itself — it's what puts the session into its
 * "your move" state, where the chime has gone and the next step is one tap
 * away. See the module note on why running out isn't the same as moving on.
 */
export function isFocusStepDone(session: FocusSession, now: number = Date.now()): boolean {
  const step = currentFocusStep(session);
  return step !== null && focusStepRemaining(session, now) <= 0;
}

/**
 * Minutes actually spent on the current step, for offering back as a
 * corrected estimate when the task under it is marked done.
 *
 * Null, not 0, for a rest step or a split task — callers use this to decide
 * whether there's anything to offer at all. A split task is excluded because
 * the session doesn't keep what its earlier stretches cost (see the module
 * note on "not a timesheet"): a step that's part 2 of 3 can only speak for a
 * third of the task, and summing would need state this store deliberately
 * doesn't keep.
 */
export function focusMeasuredMinutes(session: FocusSession, now: number = Date.now()): number | null {
  const step = currentFocusStep(session);
  if (!step || step.kind !== 'work' || step.partCount !== 1) return null;
  return Math.max(1, Math.round(focusStepElapsed(session, now) / 60));
}

// ==== Totals ====

export interface FocusPlanTotals {
  workMinutes: number;
  restMinutes: number;
  totalMinutes: number;
  /** Distinct tasks in the plan, not stretches — a split task counts once. */
  taskCount: number;
  restCount: number;
}

export function focusPlanTotals(steps: readonly FocusStep[]): FocusPlanTotals {
  const taskIds = new Set<string>();
  let workMinutes = 0;
  let restMinutes = 0;
  let restCount = 0;

  for (const step of steps) {
    if (step.kind === 'rest') {
      restMinutes += step.minutes;
      restCount += 1;
      continue;
    }
    workMinutes += step.minutes;
    if (step.taskId) taskIds.add(step.taskId);
  }

  return {
    workMinutes,
    restMinutes,
    totalMinutes: workMinutes + restMinutes,
    taskCount: taskIds.size,
    restCount,
  };
}

/**
 * How long a queue would actually take: the plan built from it, breaks and all.
 *
 * The one number a time window has to be measured against. Summing estimates
 * instead is off by every break in the run — an hour of work under the shipped
 * settings is an hour and ten minutes of wall clock — so a queue chosen to fit
 * "I have an hour" by its estimates overruns by exactly the amount of rest it
 * was going to need.
 */
export function planTotalMinutes(
  tasks: readonly FocusPlanTask[],
  options: FocusPlanOptions,
): number {
  return focusPlanTotals(buildFocusPlan(tasks, options)).totalMinutes;
}

/**
 * Minutes left in the session: what's left of the current step, plus every
 * step after it at its full length.
 *
 * The current step is measured against the clock and floored at zero, so a
 * step that has over-run doesn't credit the estimate with time it has already
 * spent — the projected finish stops moving once you're past a step's target
 * rather than running backwards.
 */
export function focusRemainingMinutes(session: FocusSession, now: number = Date.now()): number {
  if (isFocusSessionFinished(session)) return 0;
  const rest = session.steps
    .slice(session.stepIndex + 1)
    .reduce((sum, step) => sum + step.minutes, 0);
  return Math.max(0, focusStepRemaining(session, now)) / 60 + rest;
}

/** When the session is on course to finish, or null once it already has. */
export function focusProjectedEnd(session: FocusSession, now: number = Date.now()): Date | null {
  if (isFocusSessionFinished(session)) return null;
  return new Date(now + focusRemainingMinutes(session, now) * 60_000);
}

/** Work stretches for a given task that haven't been reached yet. */
export function upcomingStepsForTask(session: FocusSession, taskId: string): FocusStep[] {
  return session.steps
    .slice(session.stepIndex)
    .filter(step => step.kind === 'work' && step.taskId === taskId);
}

// ==== Moving through the plan ====

/**
 * What the step under the cursor has cost so far, as a history entry.
 *
 * Null past the end of the plan. A step that accrued nothing still records —
 * a break advanced through in one tap is a real fact about the session, and
 * dropping the zero would make "how often do I skip my breaks" unanswerable.
 */
export function currentStepRecord(session: FocusSession, now: number = Date.now()): FocusStepRecord | null {
  const step = currentFocusStep(session);
  if (!step) return null;
  return {
    kind: step.kind,
    taskId: step.taskId,
    plannedMinutes: step.minutes,
    actualSeconds: focusStepElapsed(session, now),
    part: step.part,
    partCount: step.partCount,
    long: step.long,
  };
}

/**
 * Move to the next step, keeping the session's running/paused state.
 *
 * The step clock resets rather than carrying over: `stepElapsedSeconds` banks
 * the *current* step only, which is what lets a step be paused and resumed
 * without the plan needing a per-step ledger. Nothing on screen reads what a
 * step cost once it's behind you — the session still reports what it planned
 * and what got ticked off, not a timesheet.
 *
 * What the step cost is appended to `stepLog` on the way past, and that is
 * deliberately *here* rather than in the store: four store actions retire a
 * step (advance, prune, end, and a start replacing a session in flight), and a
 * ledger maintained at four call sites is the shape this codebase has been
 * bitten by before. Banking in the pure function means the only way to lose a
 * step is to add a fifth way of moving the cursor, which these tests catch.
 */
export function advanceFocusSession(session: FocusSession, now: number = Date.now()): FocusSession {
  if (isFocusSessionFinished(session)) return session;
  const running = isFocusRunning(session);
  const record = currentStepRecord(session, now);
  return {
    ...session,
    stepIndex: session.stepIndex + 1,
    stepElapsedSeconds: 0,
    stepStartedAt: running ? new Date(now).toISOString() : null,
    stepLog: record ? [...session.stepLog, record] : session.stepLog,
  };
}

/** Bank the segment in flight and stop the clock. A no-op when already paused. */
export function pauseFocusSession(session: FocusSession, now: number = Date.now()): FocusSession {
  if (session.stepStartedAt === null) return session;
  return {
    ...session,
    stepElapsedSeconds: focusStepElapsed(session, now),
    stepStartedAt: null,
  };
}

/** Start the clock again on the current step. A no-op when already running. */
export function resumeFocusSession(session: FocusSession, now: number = Date.now()): FocusSession {
  if (session.stepStartedAt !== null || isFocusSessionFinished(session)) return session;
  return { ...session, stepStartedAt: new Date(now).toISOString() };
}

/**
 * Drop every remaining stretch belonging to a task the session can no longer
 * work on — it was completed (from inside the session or from the task list),
 * or deleted.
 *
 * Steps already behind the cursor are left exactly as they are: they're the
 * record of what the session has done, and rewriting history to match the
 * present would make "step 4 of 9" mean something different every time you
 * looked at it. Only the run from the cursor onwards is filtered, then tidied
 * by `normalizePlanTail` so dropping the work either side of a break doesn't
 * leave the break stranded.
 *
 * Returns the session unchanged (by identity, so a caller can skip the write)
 * when nothing matched.
 */
export function pruneFocusPlan(
  session: FocusSession,
  isGone: (taskId: string) => boolean,
  now: number = Date.now(),
): FocusSession {
  if (isFocusSessionFinished(session)) return session;

  const past = session.steps.slice(0, session.stepIndex);
  const future = session.steps
    .slice(session.stepIndex)
    .filter(step => step.kind === 'rest' || step.taskId === null || !isGone(step.taskId));
  const tidied = normalizePlanTail(future);
  if (tidied.length === session.steps.length - past.length) return session;

  const wasCurrent = session.steps[session.stepIndex];
  // The cursor doesn't move — whatever slid into its place is now the current
  // step. It only gets a fresh clock when it is genuinely a *different* step:
  // pruning a task three stretches ahead must not restart the one you're
  // sitting on.
  const stillCurrent = tidied[0] === wasCurrent;
  // A step the cursor is being moved off is banked exactly as `advance` banks
  // one, and for a reason worth stating: this is the path a task completed
  // from the Today list takes, so the stretch that *did the work* leaves the
  // plan here rather than through `advance`. Not banking it would lose time
  // precisely for the tasks that got finished.
  const record = stillCurrent ? null : currentStepRecord(session, now);
  return {
    ...session,
    steps: [...past, ...tidied],
    stepIndex: past.length,
    stepElapsedSeconds: stillCurrent ? session.stepElapsedSeconds : 0,
    stepStartedAt: stillCurrent
      ? session.stepStartedAt
      : (isFocusRunning(session) && tidied.length > 0 ? new Date(now).toISOString() : null),
    stepLog: record ? [...session.stepLog, record] : session.stepLog,
  };
}

// ==== Closing a session out ====

/**
 * Below this, a session isn't worth a row in the log — a start immediately
 * undone, or a sheet opened and closed. Stats built on those would report a
 * count of taps rather than of sessions.
 */
export const MIN_LOGGED_SESSION_SECONDS = 60;

/**
 * Turn a session that's ending into the row Stats reads, banking whatever the
 * in-flight step accrued on the way.
 *
 * Null when there's nothing worth keeping. Completing something always counts,
 * however short the session was: a minute's work that finished a task is a
 * real session, and the floor is there for the sheet opened by accident.
 */
export function closeFocusSession(
  session: FocusSession,
  endedAt: number = Date.now(),
): FocusSessionRecord | null {
  const inFlight = currentStepRecord(session, endedAt);
  const steps = inFlight ? [...session.stepLog, inFlight] : session.stepLog;

  const secondsOf = (kind: FocusStepKind) => steps
    .filter(s => s.kind === kind)
    .reduce((total, s) => total + s.actualSeconds, 0);

  const workedSeconds = secondsOf('work');
  if (workedSeconds < MIN_LOGGED_SESSION_SECONDS && session.completedTaskIds.length === 0) return null;

  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: new Date(endedAt).toISOString(),
    workedSeconds,
    restedSeconds: secondsOf('rest'),
    plannedWorkMinutes: steps
      .filter(s => s.kind === 'work')
      .reduce((total, s) => total + s.plannedMinutes, 0),
    steps,
    completedTaskIds: session.completedTaskIds,
  };
}
