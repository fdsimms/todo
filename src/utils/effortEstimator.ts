import type { Task } from '../types';
import { normalizeTitle } from './taskInstances';

export interface EffortEstimate {
  minutes: number | null; // null = not enough measured history to estimate
  reason: string;
}

// Every tier requires at least this many measured samples before it's trusted —
// one or two timed tasks is noise, not signal.
const MIN_SAMPLES = 3;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'with',
  'my', 'your', 'this', 'that', 'from', 'up', 'out', 'about',
]);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/** Walk the previousOccurrenceId chain backward, collecting measured minutes from every prior occurrence. */
function seriesActuals(previousOccurrenceId: string | null, tasks: Task[]): number[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const values: number[] = [];
  const seen = new Set<string>();
  let id = previousOccurrenceId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const prev = byId.get(id);
    if (!prev) break;
    if (prev.actualMinutes != null) values.push(prev.actualMinutes);
    id = prev.previousOccurrenceId;
  }
  return values;
}

export interface EstimateEffortOptions {
  notes?: string;
  category?: string | null;
  tags?: string[];
  /** The task being edited's own previousOccurrenceId, to walk its recurrence series. */
  previousOccurrenceId?: string | null;
  /** Excluded from every tier — the task being estimated for, if it already exists. */
  excludeTaskId?: string | null;
}

/**
 * Estimate a task's effort from the user's own timer history rather than
 * asking a model to guess from a title. Tiered lookup, first tier with
 * enough samples (n >= 3) wins; abstains (minutes: null) rather than guess.
 */
export function estimateEffort(
  title: string,
  options: EstimateEffortOptions,
  tasks: Task[],
): EffortEstimate {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { minutes: null, reason: 'Add a title first.' };

  const pool = tasks.filter(t => t.id !== options.excludeTaskId && t.actualMinutes != null);

  const seriesValues = seriesActuals(options.previousOccurrenceId ?? null, tasks);
  if (seriesValues.length >= MIN_SAMPLES) {
    return {
      minutes: median(seriesValues),
      reason: `Based on ${seriesValues.length} past occurrences of this task.`,
    };
  }

  const key = normalizeTitle(trimmedTitle);
  const exactValues = pool.filter(t => normalizeTitle(t.title) === key).map(t => t.actualMinutes!);
  if (exactValues.length >= MIN_SAMPLES) {
    return {
      minutes: median(exactValues),
      reason: `Based on ${exactValues.length} past tasks titled "${trimmedTitle}".`,
    };
  }

  let bestToken: { token: string; values: number[] } | null = null;
  for (const token of titleTokens(trimmedTitle)) {
    const values = pool.filter(t => titleTokens(t.title).includes(token)).map(t => t.actualMinutes!);
    if (values.length >= MIN_SAMPLES && (!bestToken || values.length > bestToken.values.length)) {
      bestToken = { token, values };
    }
  }
  if (bestToken) {
    return {
      minutes: median(bestToken.values),
      reason: `Based on ${bestToken.values.length} past tasks containing "${bestToken.token}".`,
    };
  }

  const category = options.category ?? null;
  const tags = options.tags ?? [];
  const categoryTagValues = pool
    .filter(t => (category != null && t.category === category) || t.tags.some(tag => tags.includes(tag)))
    .map(t => t.actualMinutes!);
  if (categoryTagValues.length >= MIN_SAMPLES) {
    return {
      minutes: median(categoryTagValues),
      reason: `Based on ${categoryTagValues.length} past tasks with a similar category or tag.`,
    };
  }

  const globalValues = pool.map(t => t.actualMinutes!);
  if (globalValues.length >= MIN_SAMPLES) {
    return {
      minutes: median(globalValues),
      reason: `Based on the median of ${globalValues.length} timed tasks.`,
    };
  }

  return { minutes: null, reason: 'Not enough timer history yet to estimate — time a few tasks first.' };
}
