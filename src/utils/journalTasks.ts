import type { JournalKind, Task, TimeOfDay } from '../types';
import { generatedSourceOf } from './generatedTasks';

/**
 * The two generators the journal fires — see `docs/arch/journal.md`.
 *
 * `journalLog` is `moodLog`'s shape (`moodTasks.ts`) over the journal: one
 * any-time task a day while `journalLogTimeSegments` is empty, or one per
 * configured segment, only the current one ever live. `dreamLog` is the plain
 * once-a-day form, since a dream is written once, on waking.
 *
 * The source id is `dayKey` or `${dayKey}:${segment}`, the same two forms
 * `moodLogSourceId` writes, so the helpers here split it the same way.
 */

export const JOURNAL_LOG_TITLE = 'Write in your journal';
/**
 * The journal reminder's title while it fires once per part of the day: each
 * one asks for a snippet of the same day's page rather than a fresh entry.
 */
export const JOURNAL_SNIPPET_TITLE = "Add to today's journal";
export const DREAM_LOG_TITLE = 'Write down your dream';

/** The journal reminder's title for a given set of parts of the day. */
export function journalLogTitle(segments: readonly TimeOfDay[]): string {
  return segments.length > 0 ? JOURNAL_SNIPPET_TITLE : JOURNAL_LOG_TITLE;
}

/** The generated kind that asks for each journal kind. */
export const JOURNAL_TASK_KIND = { journal: 'journalLog', dream: 'dreamLog' } as const;

/** The deep link a task's row opens, to the sheet that answers it. */
export function journalLogUrl(kind: JournalKind): string {
  return kind === 'dream' ? 'dundundun://dreams?log=1' : 'dundundun://journal?log=1';
}

/** The sourceId for one task, given the day and (journal only) its segment. */
export function journalTaskSourceId(dayKey: string, segment: TimeOfDay | null): string {
  return segment === null ? dayKey : `${dayKey}:${segment}`;
}

/** The day key a journal or dream task is asking about, or null for any other task. */
export function journalTaskDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  kind: JournalKind,
): string | null {
  const source = generatedSourceOf(task, JOURNAL_TASK_KIND[kind]);
  if (source === null) return null;
  const sep = source.indexOf(':');
  return sep === -1 ? source : source.slice(0, sep);
}
