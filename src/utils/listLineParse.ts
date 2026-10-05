import {
  matchPersonMentions,
  parseCategoryAndTagsInput,
  parsePriorityInput,
  parseTaskInput,
  scheduleClockInstant,
  stripRemindPrefix,
  withTrailingSpace,
  type GroupMentionToken,
  type ParsedPriority,
  type ParsedSchedule,
  type ParsedTaskInput,
  type PersonToken,
} from './parseTaskInput';
import type { Priority, TaskDraft } from '../types';

/**
 * Reading a line typed into a list or a checklist section (#2312), by quick
 * add's own policy rather than a second one (`QuickAddModal`):
 *
 * - A `#category`/`#tag` and an `@person` apply on their own when the line is
 *   added. They're markers somebody typed on purpose, so nothing is asked, and
 *   a pasted list gets them line by line. A `#word` that names nothing stays as
 *   text, and a mention stays in the title, exactly as in quick add.
 * - A date or schedule and a `!priority` only ever apply from the keyboard
 *   bar's Confirm. A date phrase is too easy to type as part of an item ("ask
 *   about Friday"), so an unconfirmed one is added as the text it is.
 *
 * A line with none of these is added exactly as typed, which is what a list
 * has always done.
 */

export interface LineParseContext {
  categories: string[];
  tags: string[];
  people: PersonToken[];
  groups: GroupMentionToken[];
}

/** What a line's `#` and `@` markers put on the new item. */
export interface LineMarkerFields {
  title: string;
  category: string | null;
  tags: string[];
  personIds: string[];
}

/** The markers applied at add time. Never creates a category, tag or person. */
export function lineMarkerFields(text: string, ctx: LineParseContext): LineMarkerFields {
  const filed = parseCategoryAndTagsInput(text, ctx.categories, ctx.tags);
  const title = filed?.cleanTitle ?? text.trim();
  const mentions = matchPersonMentions(title, ctx.people, ctx.groups);
  return {
    title,
    category: filed?.category ?? null,
    tags: filed?.tags ?? [],
    personIds: [...new Set(mentions.map(m => m.personId))],
  };
}

/** What the keyboard bar's Confirm would apply to the line as it stands. */
export type LineSuggestion =
  | { kind: 'schedule'; parsed: ParsedTaskInput }
  | { kind: 'priority'; parsed: ParsedPriority };

/**
 * A schedule first and a priority otherwise, the order quick add's tooltip
 * chain puts them in. `now` is the logical now for day words and `clockNow`
 * the real instant for clock times (see the grace-window note in CLAUDE.md).
 */
export function lineSuggestion(text: string, now: Date, clockNow: Date): LineSuggestion | null {
  const parsed = parseTaskInput(text, now, clockNow);
  if (parsed) return { kind: 'schedule', parsed };
  const priority = parsePriorityInput(text);
  if (priority) return { kind: 'priority', parsed: priority };
  return null;
}

/** What Confirm has set on a line so far, held until the line is added. */
export interface LinePending {
  schedule: ParsedSchedule | null;
  /** "remind me to … at 4pm" asked for a reminder at that moment. */
  reminderAt: Date | null;
  priority: Priority | null;
}

export const NO_LINE_PENDING: LinePending = { schedule: null, reminderAt: null, priority: null };

/**
 * Confirm: the line's text with the phrase taken out, and what the phrase set.
 * A "remind me to … at 4pm" line sets the reminder and drops the request from
 * the text, as quick add does; a bare clock time only places the day.
 */
export function confirmLineSuggestion(
  suggestion: LineSuggestion,
  pending: LinePending,
  dayResetTime: string,
): { text: string; pending: LinePending } {
  if (suggestion.kind === 'priority') {
    return {
      text: withTrailingSpace(suggestion.parsed.cleanTitle),
      pending: { ...pending, priority: suggestion.parsed.priority },
    };
  }
  const { schedule, cleanTitle } = suggestion.parsed;
  const remindTitle = schedule.explicitClockTime ? stripRemindPrefix(cleanTitle) : null;
  // On the due day's logical day (scheduleClockInstant), as quick add does.
  const reminderAt = remindTitle !== null ? scheduleClockInstant(schedule, dayResetTime) : null;
  return {
    text: withTrailingSpace(remindTitle ?? cleanTitle),
    pending: { ...pending, schedule, reminderAt },
  };
}

/**
 * The confirmed fields as `addTask` takes them, and the further dates of a
 * set ("on the 10th and the 15th"), which go through `applyTaskDates` once the
 * item exists rather than being dropped.
 */
export function linePendingFields(pending: LinePending): {
  draft: Partial<TaskDraft>;
  seriesDates: Date[] | null;
} {
  const draft: Partial<TaskDraft> = {};
  if (pending.priority !== null) draft.priority = pending.priority;
  const s = pending.schedule;
  if (s) {
    draft.dueDate = s.dueDate.toISOString();
    draft.deadline = s.deadline ? s.deadline.toISOString() : null;
    draft.windowStart = s.windowStart ?? null;
    draft.windowEnd = s.windowEnd ?? null;
    draft.timeSegments = s.timeSegments;
    draft.recurrenceType = s.recurrenceType;
    draft.recurrenceInterval = s.recurrenceInterval;
    draft.recurrenceDays = s.recurrenceDays;
    draft.recurrenceMonthDay = s.recurrenceMonthDay ?? null;
    draft.recurrenceWeekOrdinal = s.recurrenceWeekOrdinal ?? null;
    draft.recurrenceEndDate = s.recurrenceEndDate ?? null;
    draft.recurrenceCount = s.recurrenceCount ?? null;
    draft.recurrenceFromCompletion = s.recurrenceFromCompletion ?? false;
  }
  if (pending.reminderAt) draft.reminderTime = pending.reminderAt.toISOString();
  const seriesDates = s?.extraDates?.length ? [s.dueDate, ...s.extraDates] : null;
  return { draft, seriesDates };
}
