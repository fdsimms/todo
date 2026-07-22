import type { Task } from '../types';

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
 * say). Subtasks and incomplete tasks are ignored.
 *
 * Only groups with at least `minCount` completions are returned (a task done
 * once isn't "repeated"), sorted by count desc then most-recent completion.
 */
export function getRepeatedInstances(tasks: Task[], minCount = 2): InstanceGroup[] {
  const groups = new Map<string, { title: string; titleAt: string; completions: string[] }>();

  for (const task of tasks) {
    if (task.parentId) continue;
    if (!task.completed || !task.completedAt) continue;
    if (task.recurrenceType !== 'none') continue;

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
