import type { Task } from '../types';
import { completionTapFor } from './completionTap';

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
 * - `none`: anything the checkbox wouldn't simply tick (already done, not due
 *   yet, a rotation that asks which member, a slip habit), left alone for the
 *   person to answer from its row. The summary says so.
 */
export type WorkoutTaskEffect = 'complete' | 'log-unit' | 'ask' | 'none';

export function workoutTaskEffect(task: Task | null): WorkoutTaskEffect {
  if (!task || task.archived) return 'none';
  switch (completionTapFor(task)) {
    case 'complete': return 'complete';
    case 'log-unit': return 'log-unit';
    case 'ask': return 'ask';
    default: return 'none';
  }
}
