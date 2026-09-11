import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Task } from '../types';
import { getEffectiveTaskDate, getTaskDayStart } from './dateUtils';
import {
  SOFT_DELOAD_BLOCKERS,
  deloadBlockerFor,
  isDateAnchored,
  scheduleMoveUpdates,
  type DeloadBlocker,
} from './taskMoves';

/**
 * "The trip moved. Do these move with it?"
 *
 * A trip's dates change more often than a trip is planned — the flight shifts,
 * the booking is a day out, the whole thing slips a week — and until this
 * existed the app had no answer at all. Nothing anywhere shifts a set of tasks
 * by a delta: `deloadPlan` spreads one day across nearby days, `lookAhead`
 * pushes a window past a return, the bulk bar defers. So a trip that moved two
 * days meant editing every prepared task by hand.
 *
 * Three things worth not re-deriving:
 *
 * - **It is a uniform delta, not a stored per-task offset.** A template run
 *   resolves its offsets into real dates and forgets them (`resolveOffsetDate`),
 *   so the link to the anchor is gone the moment the run lands. Storing the
 *   offset on the task was the exact alternative and is refused in
 *   `docs/arch/away-dates.md`: it costs a new `Task` field plus the four-site
 *   `TemplateItem` parity obligation, and it would only ever help the tasks a
 *   template created, never the ones typed into the trip by hand. The proposal
 *   sheet does the work the stored offset would have, for a wider set of rows.
 * - **It proposes; it never shifts.** Deload, look-ahead and the project pull
 *   all derive and offer, and this has more reason than any of them: "Renew
 *   passport" is anchored to the trip and "Buy a suitcase" is not, and only the
 *   person who typed them knows which.
 * - **A recurring member is offered but never pulled backwards blindly** — that
 *   is `scheduleMoveUpdates`' business, and the whole reason its pull arm had to
 *   come out of `TaskItem` and into the leaf.
 */

/** One member of the trip, and where the shift would put it. */
export interface AwayShiftProposal {
  task: Task;
  /** The day it sits on now, by `getEffectiveTaskDate` — what the user sees. */
  from: Date;
  /** Where the delta lands it. Null when nothing can move it there. */
  destination: Date | null;
  /** Ticked to begin with. A blocked row is offered unticked, never hidden. */
  selected: boolean;
  blocker: DeloadBlocker | null;
  blockerLabel: string | null;
}

export interface AwayShiftPlan {
  /** Calendar days the departure moved. Negative when the trip came forward. */
  deltaDays: number;
  proposals: AwayShiftProposal[];
}

/**
 * A row this plan will not touch at all, as opposed to one it offers unticked.
 *
 * Completed and archived rows are history: a task finished before the dates
 * changed happened on the day it happened. Subtasks ride their parent, the
 * same cut every other planner here makes.
 */
function isShiftable(task: Task): boolean {
  return !task.parentId && !task.completed && !task.archived;
}

/**
 * Propose moving a trip's tasks by the same number of days its departure moved.
 *
 * `from`/`to` are the old and new departure, and only their calendar-day
 * difference is read — a trip that got longer at the far end has not moved
 * anything that was scheduled against its start, which is why the return date
 * is not a parameter.
 *
 * An undated task is skipped rather than offered: with no date there is
 * nothing to add a delta to, and inventing one out of the trip's own dates
 * would be scheduling work the user deliberately left unscheduled (the same
 * reading `hasNoDateSignal` protects in `projectPull`).
 */
export function buildAwayShiftPlan(
  tasks: readonly Task[],
  from: Date,
  to: Date,
  dayResetTime?: string,
): AwayShiftPlan {
  const deltaDays = differenceInCalendarDays(
    getTaskDayStart(to, dayResetTime),
    getTaskDayStart(from, dayResetTime),
  );
  if (deltaDays === 0) return { deltaDays: 0, proposals: [] };

  const proposals: AwayShiftProposal[] = [];
  for (const task of tasks) {
    if (!isShiftable(task)) continue;
    const current = getEffectiveTaskDate(task);
    if (!current) continue;

    const fromDay = getTaskDayStart(new Date(current), dayResetTime);
    const destination = addDays(fromDay, deltaDays);
    // Midday, like every other date this app places, so a shift can't land a
    // task on the wrong side of a logical-day boundary.
    destination.setHours(12, 0, 0, 0);

    const found = deloadBlockerFor(task);
    const hard = found !== null && !SOFT_DELOAD_BLOCKERS.has(found.blocker);
    proposals.push({
      task,
      from: fromDay,
      destination: hard ? null : destination,
      selected: found === null,
      blocker: found?.blocker ?? null,
      blockerLabel: found?.label ?? null,
    });
  }

  // Furthest out first, matching buildPushPlan's own ordering instinct: the
  // rows nearest the trip are the ones a reader scans for.
  proposals.sort((a, b) => b.from.getTime() - a.from.getTime());
  return { deltaDays, proposals };
}

/**
 * The field updates one accepted proposal writes.
 *
 * Goes through `scheduleMoveUpdates` rather than writing `dueDate` directly,
 * so a recurring member moved backwards keeps its own grid anchor and one
 * moved forwards is deferred rather than rebased. That is the whole reason the
 * rule was lifted out of `TaskItem`.
 */
export function awayShiftUpdates(
  proposal: AwayShiftProposal,
  dayResetTime?: string,
): Partial<Task> | null {
  if (!proposal.destination) return null;
  return scheduleMoveUpdates(proposal.task, proposal.destination, dayResetTime);
}

/** "7 tasks move 2 days later" — the sheet's one headline. */
export function describeAwayShift(plan: AwayShiftPlan): string {
  const count = plan.proposals.filter(p => p.destination !== null).length;
  const days = Math.abs(plan.deltaDays);
  const dayPart = days === 1 ? '1 day' : `${days} days`;
  const direction = plan.deltaDays > 0 ? 'later' : 'earlier';
  const taskPart = count === 1 ? '1 task' : `${count} tasks`;
  return `${taskPart} ${count === 1 ? 'moves' : 'move'} ${dayPart} ${direction}`;
}

/** Whether a recurring member is in the plan, since those move differently. */
export function hasAnchoredMember(plan: AwayShiftPlan): boolean {
  return plan.proposals.some(p => p.destination !== null && isDateAnchored(p.task));
}
