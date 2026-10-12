/**
 * The daily step goal, a number the person types in, and the only thing the
 * steps row on Today is ever measured against.
 *
 * **Null means no goal, and it is the default.** Apple Health keeps no step
 * goal for an app to read (the Fitness rings are calories, minutes and hours),
 * so nothing here can be inferred or borrowed: with no goal the row stays a
 * plain count and draws no bar. A goal is the same kind of thing the weight
 * goal is, a target somebody states, which is why it is allowed to be compared
 * against a reading at all (`docs/arch/health-data.md`).
 */

export const STEP_GOAL_MIN = 1000;
export const STEP_GOAL_MAX = 50000;
export const STEP_GOAL_STEP = 500;
/** Where the stepper starts when somebody first turns a goal on. */
export const STEP_GOAL_DEFAULT = 10000;

/** Snaps to the step and clamps to the range. */
export function clampStepGoal(goal: number): number {
  if (!Number.isFinite(goal)) return STEP_GOAL_DEFAULT;
  const snapped = Math.round(goal / STEP_GOAL_STEP) * STEP_GOAL_STEP;
  return Math.min(STEP_GOAL_MAX, Math.max(STEP_GOAL_MIN, snapped));
}

/** Reads the stored value: empty or unreadable is no goal, not the default. */
export function parseStepGoal(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? clampStepGoal(n) : null;
}
