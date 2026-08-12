import type { Task } from '../types';
import { logicalDayStart, taskDayStart } from './clockTime';

/**
 * "You've pushed this five times — want to just get it over with?"
 *
 * A task that keeps getting moved leaves no trace today: the only thing stored
 * is its current date, which by definition always says "tomorrow" however many
 * tomorrows it has already been. `Task.postponeCount` is that missing memory,
 * and this module owns the one rule that decides when it moves.
 *
 * Deliberately store-free — it imports only the type and clockTime, never
 * dateUtils or visibilityUtils, both of which reach useSettingsStore, which
 * reaches the db, which imports expo-sqlite and throws on sight in Jest's
 * `node` environment (see missed.ts's header for the same trap). That's why
 * dayResetTime and `now` are parameters rather than reads.
 */

/**
 * Which of the three things a write did to a task's schedule.
 *
 * Three states rather than a bare "new count", because "moved to today" and
 * "didn't move at all" must not collapse: TaskEditor's save payload writes
 * dueDate unconditionally on every save, so a two-state rule would zero the
 * count every time the user renamed a task.
 */
export type PostponeOutcome = 'pushed' | 'resolved' | 'unchanged';

/**
 * Pushes before the picker says anything, until the user moves the stepper.
 *
 * Three rather than two because the second push of a task is ordinary — plans
 * change — and rather than five because by the fifth the point has been made
 * without help.
 */
export const DEFAULT_POSTPONE_THRESHOLD = 3;

/** Bounds for the settings stepper. */
export const MIN_POSTPONE_THRESHOLD = 2;
export const MAX_POSTPONE_THRESHOLD = 15;

/**
 * A stored threshold back into a usable number. The settings table is all TEXT,
 * so anything unparseable — a missing row, a value from a future version, the
 * literal "null" — reads back as the default rather than as NaN, which would
 * compare false against every count and silently disable the prompt.
 */
export function parsePostponeThreshold(stored: string | null | undefined): number {
  // The empty check has to come first and be its own branch: Number(null) and
  // Number('') are both 0, not NaN, so a missing row would otherwise clamp to
  // the minimum instead of falling back to the default.
  if (stored === null || stored === undefined || stored.trim() === '') {
    return DEFAULT_POSTPONE_THRESHOLD;
  }
  const n = Number(stored);
  if (!Number.isFinite(n)) return DEFAULT_POSTPONE_THRESHOLD;
  return Math.min(MAX_POSTPONE_THRESHOLD, Math.max(MIN_POSTPONE_THRESHOLD, Math.round(n)));
}

/**
 * The day a task actually reads as — the later of deferUntil and dueDate.
 *
 * The same rule as dateUtils' getEffectiveTaskDate, which is what every
 * user-facing read is built on, restated here because that module can't be
 * imported (see above). Comparing effective days rather than the two fields
 * separately is what makes a defer, a deload move and a recurrence skip each
 * read as one coherent move instead of two contradictory ones — and it's why
 * the five engine paths that write `deferUntil: null` alongside a new dueDate
 * don't register as "moved earlier".
 */
function effectiveDay(
  task: Pick<Task, 'dueDate' | 'deferUntil'>,
  dayResetTime: string,
): Date | null {
  const due = task.dueDate ? taskDayStart(new Date(task.dueDate), dayResetTime) : null;
  const defer = task.deferUntil ? taskDayStart(new Date(task.deferUntil), dayResetTime) : null;
  if (due && defer) return defer > due ? defer : due;
  return defer ?? due;
}

/**
 * What a write did: pushed the task out, pulled it back to today or earlier, or
 * left its schedule where it was.
 *
 * `pushed` deliberately requires the *old* day to be today or earlier. Moving
 * next month's dentist appointment by a day is re-planning, not ducking — only
 * a task that was already on your plate can be avoided.
 *
 * Everything that isn't one of those two is `unchanged`, and that includes
 * clearing a date: unscheduling is neither a push nor a resolution, and
 * treating it as one would let "clear it, then re-date it" launder the history.
 */
export function postponeOutcome(
  before: Pick<Task, 'dueDate' | 'deferUntil'>,
  after: Pick<Task, 'dueDate' | 'deferUntil'>,
  dayResetTime: string,
  now: Date = new Date(),
): PostponeOutcome {
  const from = effectiveDay(before, dayResetTime);
  const to = effectiveDay(after, dayResetTime);
  // First scheduling isn't ducking, and neither is unscheduling. This is also
  // what exempts the project drip and the project pull by construction — both
  // only ever date tasks that had no date at all.
  if (!from || !to) return 'unchanged';

  const today = logicalDayStart(now, dayResetTime);
  // Compared against the *task-anchored* today, since `from`/`to` are anchors.
  const todayAnchor = taskDayStart(today, dayResetTime);

  if (to.getTime() <= todayAnchor.getTime()) {
    // Pulling something in is the opposite signal, so it wipes the slate —
    // which is what lets the banner's "Do it today" reset the count for free.
    return from.getTime() === to.getTime() ? 'unchanged' : 'resolved';
  }
  if (to.getTime() > from.getTime() && from.getTime() <= todayAnchor.getTime()) {
    return 'pushed';
  }
  return 'unchanged';
}

/** pushed → one more · resolved → back to zero · unchanged → left alone. */
export function nextPostponeCount(current: number, outcome: PostponeOutcome): number {
  if (outcome === 'pushed') return current + 1;
  if (outcome === 'resolved') return 0;
  return current;
}

/**
 * Whether the date picker should say something when it opens on this task.
 *
 * `postponeMuted` is the per-task opt-out — some tasks genuinely are blocked on
 * something else, and being asked about them every week is how the whole
 * feature would get turned off.
 */
export function shouldNudgePostpone(
  task: Pick<Task, 'postponeCount' | 'postponeMuted'>,
  enabled: boolean,
  threshold: number,
): boolean {
  return enabled && !task.postponeMuted && task.postponeCount >= threshold;
}
