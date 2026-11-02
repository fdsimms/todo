/**
 * One stretch of a focus session — either work on a task, or a break.
 *
 * A session is a *plan*: an ordered list of these, built once when the session
 * starts (see `src/utils/focusPlan.ts`) from the tasks' own estimates and the
 * user's rest rules. The plan is stored rather than re-derived, because it's a
 * commitment the user agreed to on the setup sheet — re-deriving it would let
 * an estimate edit reshuffle a session already in progress.
 */
export type FocusStepKind = 'work' | 'rest';

export interface FocusStep {
  kind: FocusStepKind;
  /** Work steps: the task being worked on. Rest steps carry null. */
  taskId: string | null;
  /** How long the stretch runs for. Always positive. */
  minutes: number;
  /**
   * Which slice of its task this is, 1-based, and how many slices that task
   * was cut into. `1 of 1` for a task that fits inside one work step. A task
   * estimated longer than `focusWorkCapMinutes` is split into equal parts so a
   * two-hour estimate becomes several stretches with breaks between them,
   * rather than one two-hour "pomodoro" that is no such thing.
   */
  part: number;
  partCount: number;
  /** Rest steps: the longer break every `focusLongRestEvery` breaks. */
  long: boolean;
}

/**
 * The one focus session in flight, if there is one.
 *
 * At most one row exists at a time (`focus_sessions` holds a single row —
 * starting a session replaces whatever was there, ending one deletes it).
 *
 * **Only the current step carries a clock.** How far through a step we are is
 * derived from `stepStartedAt`/`stepElapsedSeconds` against the wall clock and
 * never stored, exactly as `src/utils/timer.ts` derives a task countdown and
 * for the same reason: a stored "seconds remaining" would need clearing on
 * pause and would go stale the moment the app is backgrounded. What is *not*
 * derived is which step you're on — `stepIndex` moves only when the user
 * advances, so a phone left in a pocket for an hour comes back on the step it
 * was on, over-run, rather than having silently burned through three of them.
 */
export interface FocusSession {
  id: string;
  /** When the session began. Only ever displayed, never used for step math. */
  startedAt: string;
  steps: FocusStep[];
  /** Which step is live. `steps.length` means the plan is finished. */
  stepIndex: number;
  /** ISO while the current step's run segment is in flight; null when paused. */
  stepStartedAt: string | null;
  /** Banked seconds within the *current* step only — reset on every advance. */
  stepElapsedSeconds: number;
  /** Tasks ticked off from inside the session, for its closing summary. */
  completedTaskIds: string[];
  /**
   * What the steps already behind the cursor actually cost, oldest first.
   *
   * The session itself still keeps no per-step clock — `stepElapsedSeconds` is
   * reset on every advance exactly as before, and nothing here is read to
   * decide what is on screen. This is the *record*, banked as each step is
   * left, and it exists because the alternative was logging from each of the
   * four store actions that can retire a step (advance, prune, end, and a
   * start that replaces a session in flight). That shape is the one this
   * codebase has already been bitten by; banking inside the pure plan
   * functions means a step cannot be dropped without a focusPlan test failing.
   *
   * One entry per step *run*, not per step planned: a session ended halfway
   * records the half it did.
   */
  stepLog: FocusStepRecord[];
  /**
   * Hides the countdown clock for this run only — the setup sheet's own
   * override of settings' `focusHideTimers`, same shape as the Breaks toggle
   * beside it. Stamped once at start from whatever Settings said at the time;
   * changing Settings mid-session doesn't reach a session already running,
   * same as every other focus setting (see "the plan is stored, not
   * re-derived" in docs/arch/focus-sessions.md).
   */
  hideTimers: boolean;
}

/**
 * What one step of a session cost, once it's behind the cursor.
 *
 * `plannedMinutes` is copied off the step rather than looked up later because
 * the plan can be pruned after the fact — the honest comparison is against
 * what this stretch was actually given at the time it ran.
 */
export interface FocusStepRecord {
  kind: FocusStepKind;
  taskId: string | null;
  /** What the plan allowed this stretch, in minutes. */
  plannedMinutes: number;
  /** What it actually took, pauses excluded. */
  actualSeconds: number;
  part: number;
  partCount: number;
  long: boolean;
}

/**
 * A finished focus session, kept for Stats. Written once when the session ends
 * and never updated after that.
 *
 * Deliberately not a `FocusSession` with an end date on it: the live session is
 * a cursor into a plan that is still being pruned and re-timed, and the history
 * row is a closed account of what ran. Storing one shape for both would mean
 * every reader of the past having to reason about a plan's unrun tail.
 */
export interface FocusSessionRecord {
  id: string;
  startedAt: string;
  endedAt: string;
  /** Seconds of *work* steps that actually ran, pauses excluded. */
  workedSeconds: number;
  /** Seconds of *rest* steps that actually ran. */
  restedSeconds: number;
  /** What the plan allowed for the work steps that ran, in minutes. */
  plannedWorkMinutes: number;
  /** The steps that ran, oldest first. */
  steps: FocusStepRecord[];
  /** Tasks ticked off from inside the session. */
  completedTaskIds: string[];
}
