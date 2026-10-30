import type { EventTaskRule, Task } from '../types';
import { parseEventTaskSourceId } from './eventTasks';
import { liveGeneratedTasksOfKind } from './generatedTasks';
import { travelSourceOf } from './travelTasks';

/**
 * Tasks that must be done before leaving: the event-rule tasks marked
 * `beforeLeaving`, read against the "Leave for X" row of the same event.
 *
 * **The link is the occurrence key, not a field.** An event task's source id is
 * `${occurrenceKey}#${ruleId}` and a travel task's is `${occurrenceKey}`, both
 * built by `eventOccurrenceKey`, so "which prep belongs to this Leave row" is
 * derivable from rows that already exist. A column on `Task` would be a second
 * copy that has to be kept in step with the event moving, and would owe a
 * `TemplateItem` parity decision for a relationship only generated rows have.
 *
 * **It informs and asks; it never blocks.** The Leave row names what is still
 * open (on the row, in its notes and so in its reminder) and a tick on it asks
 * first (`confirmLeaveWithOpenPrep`). Nothing in the app may require an answer,
 * and a hard stop is wrong for someone already wearing the glasses.
 *
 * A pair keyed differently (a row written before the calendar server's id was
 * read has the local-id key) simply isn't linked. That fails quiet, the same
 * way an unmatched rule does, and the key converges as rows are rewritten.
 */

/** The rule ids that tie their task to leaving. */
export function beforeLeavingRuleIds(rules: readonly EventTaskRule[]): Set<string> {
  // `?? []` because a test double of the settings store may not carry the list.
  return new Set((rules ?? []).filter(rule => rule.beforeLeaving && !rule.afterEvent).map(rule => rule.id));
}

/**
 * The unfinished prep tasks for a "Leave for X" row, in the order they were
 * written. Empty for any other task.
 */
export function openLeavePrep(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  tasks: readonly Task[],
  rules: readonly EventTaskRule[],
): Task[] {
  const occurrenceKey = travelSourceOf(task);
  if (!occurrenceKey) return [];
  const ruleIds = beforeLeavingRuleIds(rules);
  if (ruleIds.size === 0) return [];
  return liveGeneratedTasksOfKind(tasks, 'eventTask').filter(prep => {
    const parsed = parseEventTaskSourceId(prep.generatedSourceId ?? null);
    return parsed !== null && parsed.occurrenceKey === occurrenceKey && ruleIds.has(parsed.ruleId);
  });
}

/** "Still open: Bring glasses, Insurance card", or null when nothing is. */
export function leavePrepLine(open: readonly Pick<Task, 'title'>[]): string | null {
  if (open.length === 0) return null;
  return `Still open: ${open.map(prep => prep.title).join(', ')}`;
}

/**
 * Which prep tasks are open across every Leave row, as a string that changes
 * exactly when one is checked off, added or removed. `useTravelTaskSync`
 * watches it to re-run the travel sweep, so the Leave row's notes and reminder
 * follow a tick on the prep task without every task write running the sweep.
 */
export function leavePrepSignature(tasks: readonly Task[], rules: readonly EventTaskRule[]): string {
  const ruleIds = beforeLeavingRuleIds(rules);
  if (ruleIds.size === 0) return '';
  return liveGeneratedTasksOfKind(tasks, 'eventTask')
    .filter(prep => {
      const ruleId = parseEventTaskSourceId(prep.generatedSourceId ?? null)?.ruleId;
      return ruleId !== undefined && ruleIds.has(ruleId);
    })
    .map(prep => prep.id)
    .sort()
    .join(',');
}

/** The alert for ticking a Leave row with prep open: what happened, then what to do. */
export function leavePrepAlert(open: readonly Pick<Task, 'title'>[]): { title: string; message: string } {
  if (open.length === 1) {
    return {
      title: 'Leave without it?',
      message: `“${open[0].title}” isn’t checked off yet.`,
    };
  }
  return {
    title: `Leave with ${open.length} tasks open?`,
    message: open.map(prep => `• ${prep.title}`).join('\n'),
  };
}
