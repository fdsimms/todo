import type { JournalEntry, MoodLog, Task } from '../types';
import { journalLogUrl, journalMicUrl, journalTaskDayKey } from './journalTasks';
import { hasLogOnDay, hasLoggedSince } from './moodLog';
import { MOOD_LOG_LINK_URL, moodLogDayKey } from './moodTasks';
import { timeSegmentThreshold } from './visibilityUtils';
import { WEIGH_IN_LINK_URL, weighInDayKey } from './weightTasks';
import { BLOOD_PRESSURE_LINK_URL, bloodPressureDayKey } from './bloodPressureTasks';

/**
 * The generated tasks that ask for a record, and are answered by the record.
 *
 * "Log how you're feeling", "Write in your journal", "Write down your dream" and
 * "Record your weight" and "Record your blood pressure" each have a sheet, and saving an entry for today
 * makes its row read ready and completes it (`autoCompleteRecordTasks`); an
 * entry that arrives any other way leaves the tick to the person. So
 * the app already knows whether the thing was done, and a checkbox that
 * completes the task regardless can only disagree with that: it marks the
 * question answered with no answer recorded.
 *
 * So the tick is gated on the record, the way `health.ts`'s readings gate a
 * health task: until `isRecordAnswered` says there is an entry, the checkbox
 * opens the sheet (`'open-log'` in `completionTap.ts`) and `completeTask`
 * refuses; once there is one, the row reads *ready* and the tick completes it.
 * Nothing in this file completes a task. A missed mark claims nothing, so it
 * is never gated.
 */
const RECORD_KINDS: ReadonlySet<string> = new Set(['moodLog', 'journalLog', 'dreamLog', 'weighIn', 'bloodPressureLog']);

/** Whether this task is one a record answers, so its checkbox never completes it. */
export function isAnsweredByRecord(task: Pick<Task, 'generatedKind'>): boolean {
  return task.generatedKind !== null && task.generatedKind !== undefined && RECORD_KINDS.has(task.generatedKind);
}

/**
 * The sheet that records this task's answer, or null for any other task.
 *
 * Read from the kind rather than from `Task.linkUrl`, so a row written before
 * the generators set a link (or one whose link was cleared in the editor) still
 * has somewhere to send the tap.
 */
export function recordLogUrl(task: Pick<Task, 'generatedKind'>): string | null {
  switch (task.generatedKind) {
    case 'moodLog': return MOOD_LOG_LINK_URL;
    case 'journalLog': return journalLogUrl('journal');
    case 'dreamLog': return journalLogUrl('dream');
    case 'weighIn': return WEIGH_IN_LINK_URL;
    case 'bloodPressureLog': return BLOOD_PRESSURE_LINK_URL;
    default: return null;
  }
}

/**
 * The link that opens a journal or dream task's sheet already listening, or
 * null for any other task. Only these two have a microphone: mood and weight
 * are answered with a tap on a scale, not with words.
 */
export function recordMicUrl(task: Pick<Task, 'generatedKind'>): string | null {
  switch (task.generatedKind) {
    case 'journalLog': return journalMicUrl('journal');
    case 'dreamLog': return journalMicUrl('dream');
    default: return null;
  }
}

/** What `isRecordAnswered` reads, gathered by the caller so the rule needs no store. */
export interface RecordContext {
  moodLogs: readonly Pick<MoodLog, 'dayKey' | 'loggedAt'>[];
  journalEntries: readonly Pick<JournalEntry, 'kind' | 'dayKey' | 'loggedAt'>[];
  /** The day a weigh-in request was last found answered by a reading, or null. */
  weighInAnsweredOn: string | null;
  /** The same for a blood pressure request. */
  bloodPressureAnsweredOn: string | null;
}

/** The part of the day a check-in or journal reminder was raised for, off its source id. */
function segmentOfSource(task: Pick<Task, 'generatedSourceId'>): Parameters<typeof timeSegmentThreshold>[0] | null {
  const source = task.generatedSourceId ?? '';
  const sep = source.indexOf(':');
  return sep === -1 ? null : (source.slice(sep + 1) as Parameters<typeof timeSegmentThreshold>[0]);
}

/**
 * Whether the entry this task asks for exists, which is what makes its row ready.
 *
 * The same question the generating pass asks before writing the task, read
 * back: an any-time reminder is answered by an entry on its day, one raised for
 * a part of the day by an entry since that part began. A weigh-in or a blood
 * pressure request is answered by a reading in its window, which only Health can say, so the pass records the
 * answer (`weighInAnsweredOn`) rather than the row reading Health on every render.
 */
export function isRecordAnswered(task: Task, ctx: RecordContext): boolean {
  switch (task.generatedKind) {
    case 'moodLog': {
      const day = moodLogDayKey(task);
      if (day === null) return false;
      const segment = segmentOfSource(task);
      return segment ? hasLoggedSince(ctx.moodLogs, timeSegmentThreshold(segment).toISOString()) : hasLogOnDay(ctx.moodLogs, day);
    }
    case 'journalLog':
    case 'dreamLog': {
      const kind = task.generatedKind === 'dreamLog' ? 'dream' : 'journal';
      const day = journalTaskDayKey(task, kind);
      if (day === null) return false;
      const written = ctx.journalEntries.filter(e => e.kind === kind);
      const segment = segmentOfSource(task);
      return segment ? hasLoggedSince(written, timeSegmentThreshold(segment).toISOString()) : hasLogOnDay(written, day);
    }
    case 'weighIn': {
      const day = weighInDayKey(task);
      return day !== null && ctx.weighInAnsweredOn === day;
    }
    case 'bloodPressureLog': {
      const day = bloodPressureDayKey(task);
      return day !== null && ctx.bloodPressureAnsweredOn === day;
    }
    default:
      return false;
  }
}
