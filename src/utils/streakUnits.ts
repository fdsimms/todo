import type { Task } from '../types';

/**
 * Whether a task's streak chip is a running total of units logged rather than
 * periods in a row. Opt-in (`Task.streakCountsUnits`) and only for a repeating
 * weekly target, where "the weeks I hit all of it" hides every run done in a
 * week that fell short. Every streak write and read branches on this one test
 * so the five of them (a logged unit, the unit that completes the week, a
 * short week closing, a missed mark, and the display's own gap check) agree.
 *
 * A total has no run to break, so a short or missed week leaves it alone and
 * the gap check never zeroes it.
 */
export function countsUnits(
  task: Pick<Task, 'streakCountsUnits' | 'quotaPeriod' | 'recurrenceType'>,
): boolean {
  return task.streakCountsUnits && task.quotaPeriod === 'week' && task.recurrenceType !== 'none';
}
