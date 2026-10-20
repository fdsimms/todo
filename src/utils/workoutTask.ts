import type { RotationItem, Task } from '../types';
import { completionTapFor } from './completionTap';
import { asksOnCompletion } from './deliverables';
import { rotationMemberForWorkout, rotationMembers } from './rotation';

/**
 * What finishing a workout does to the task it was started from: whatever
 * that task's own checkbox would do, so a workout is the same action as the
 * tick it stands for.
 *
 * - `complete`: the ordinary tick, through `completeTask` (coins, streak, the
 *   next occurrence).
 * - `log-unit`: a weekly or daily target below its count ("3 a week") logs one
 *   workout rather than closing the lot.
 * - `ask`: a task that asks a question on completion is completed only once it
 *   is answered, the answer-first rule, so workout mode hands it to the
 *   question rather than completing it unanswered.
 * - `locked`: a repeating task that isn't due yet. Its checkbox is locked, so
 *   there is nothing to check off from its row either.
 * - `pick`: a rotation, when the workout is one of its members' (`rotationPickFor`):
 *   log that member, the pick its pill would have made.
 * - `none`: anything the checkbox wouldn't simply tick (already done, a rotation that asks which member, a slip habit), left alone for the
 *   person to answer from its row. The summary says so.
 */
export type WorkoutTaskEffect = 'complete' | 'log-unit' | 'ask' | 'locked' | 'pick' | 'none';

/**
 * The rotation member a finished workout counts for, or null when the task isn't
 * a rotation, the workout isn't one of its members', or the task asks a question
 * on completion (a pick that closes the week would complete it unanswered, so
 * that one is left for the person to log from its row).
 */
export function rotationPickFor(
  task: Task | null,
  session: { routineId?: string | null; programId?: string | null },
  dayStart: Date,
  weekStartsOn: 0 | 1,
): RotationItem | null {
  if (!task || task.archived || task.completed) return null;
  if (completionTapFor(task) !== 'pick' || asksOnCompletion(task)) return null;
  return rotationMemberForWorkout(rotationMembers(task, dayStart, weekStartsOn), session);
}

/** `pickMember` is `rotationPickFor`'s answer; a rotation with none is left alone. */
export function workoutTaskEffect(task: Task | null, pickMember: RotationItem | null = null): WorkoutTaskEffect {
  if (!task || task.archived) return 'none';
  switch (completionTapFor(task)) {
    case 'pick': return pickMember ? 'pick' : 'none';
    case 'complete': return 'complete';
    case 'log-unit': return 'log-unit';
    case 'ask': return 'ask';
    case 'locked': return 'locked';
    default: return 'none';
  }
}

/** What the summary says saving will do to the task the workout is for. */
export function linkedTaskLine(effect: WorkoutTaskEffect, title: string, memberTitle = ''): string {
  if (effect === 'pick') return `Saving logs ${memberTitle || 'it'} on “${title}”.`;
  if (effect === 'complete') return `Saving completes “${title}”.`;
  if (effect === 'log-unit') return `Saving logs one on “${title}”.`;
  if (effect === 'ask') return `Saving asks the question on “${title}”, then completes it.`;
  if (effect === 'locked') return `“${title}” isn’t due yet, so it stays open.`;
  return `Saving leaves “${title}” as it is. Check it off from its row.`;
}
