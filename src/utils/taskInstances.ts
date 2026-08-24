import type { Task } from '../types';
import { activeChainStep } from './chain';
import { isRealCompletion } from './missed';

export interface InstanceGroup {
  /** Display title (casing taken from the most recent completion). */
  title: string;
  /** Normalized key the group was formed on (lowercased, whitespace-collapsed). */
  key: string;
  /** Number of completed occurrences. */
  count: number;
  /** ISO timestamp of the most recent completion. */
  lastCompletedAt: string;
  /** All completion timestamps, newest first. */
  completions: string[];
}

/**
 * Normalize a title into a grouping key: trimmed, internal whitespace
 * collapsed, lowercased. So "use  BOGO ticket" and "Use BOGO Ticket" group
 * together.
 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Group completed one-off tasks that share a title into "instances" — the
 * ad-hoc equivalent of a recurring task. Recurring tasks are excluded because
 * the Stats screen already tracks those as habits; this surfaces the repeats
 * that recurrence never captured (re-adding "use BOGO ticket" from autosuggest,
 * say). Subtasks, incomplete tasks and misses are ignored.
 *
 * Only groups with at least `minCount` completions are returned (a task done
 * once isn't "repeated"), sorted by count desc then most-recent completion.
 */
export function getRepeatedInstances(tasks: Task[], minCount = 2): InstanceGroup[] {
  const groups = new Map<string, { title: string; titleAt: string; completions: string[] }>();

  for (const task of tasks) {
    if (task.parentId) continue;
    // isRealCompletion, not `completed`: a miss is stored as a completed row
    // (see Task.missedAt), and "I keep failing to do this" is the *other*
    // section of this screen. Every count on Stats is a claim about what the
    // user achieved, so a task marked missed twice is not a repeat.
    if (!isRealCompletion(task) || !task.completedAt) continue;
    if (task.recurrenceType !== 'none') continue;
    // A chain is one routine spread over N rows, all carrying the task's own
    // title (the step title is what displayTitleFor swaps in for display), and
    // each step spawns the next the moment it's ticked — so a two-step
    // cook-then-eat chain run once reported itself here as a task done twice.
    // Skipped outright rather than collapsed to one per run, same call the
    // seriesId line below makes: a chain is already a formalised structure the
    // app models, not the un-modelled repetition this list exists to surface.
    // activeChainStep is the shared "is this row stepping through a chain"
    // rule, so a single-item chain — which reads as a plain task everywhere
    // else in the UI — still counts here.
    if (activeChainStep(task)) continue;
    // A dated series already models "the same thing on several days" — its
    // rows share a title by design, so counting them here would report a
    // deliberate schedule as an ad-hoc repeat the user should formalise.
    if (task.seriesId) continue;

    const key = normalizeTitle(task.title);
    if (!key) continue;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { title: task.title.trim(), titleAt: task.completedAt, completions: [task.completedAt] });
    } else {
      existing.completions.push(task.completedAt);
      // Most recent completion wins the display casing.
      if (task.completedAt > existing.titleAt) {
        existing.title = task.title.trim();
        existing.titleAt = task.completedAt;
      }
    }
  }

  return Array.from(groups.entries())
    .map(([key, { title, completions }]) => {
      const sorted = completions.slice().sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      return { key, title, count: sorted.length, lastCompletedAt: sorted[0], completions: sorted };
    })
    .filter(g => g.count >= minCount)
    .sort((a, b) => (b.count - a.count) || (a.lastCompletedAt < b.lastCompletedAt ? 1 : -1));
}
