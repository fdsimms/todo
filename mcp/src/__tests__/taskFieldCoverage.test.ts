/**
 * Every `Task` field is either something the MCP server reads or writes per
 * task, or is named here as deliberately not exposed, with the reason.
 *
 * `Task` and the server are separate interfaces, so a field added to `Task`
 * alone compiles, passes every test and ships a capability Claude can neither
 * see nor set, with nothing to say so. This is the same shape as the
 * `TemplateItem` parity note in CLAUDE.md, and the answer is the same: make
 * the decision a thing the build asks for.
 *
 * A field counts as handled when its name appears in `serialize.ts` (list
 * rows), `tools.ts` (`get_task`'s detail) or `taskFields.ts` (what
 * `create_task` / `update_task` write). Those three only: the name of a
 * `Task` field also turns up on `Person`, on template items and in aggregate
 * tools, and a looser match let `phoneNumber` pass on `Person.phoneNumber`.
 * It is still a word match on source, so a comment can satisfy it; what it
 * reliably catches is a field nobody has looked at. Source rather than types
 * because an interface leaves nothing to enumerate at runtime.
 *
 * Adding a field to `Task` fails this suite until you do one of:
 *   - expose it (`serialize.ts` for a list row, `taskExtras` in `tools.ts` for
 *     get_task, `taskFields.ts` plus `taskFieldsShape` in `server.ts` to write
 *     it; `instructions.ts` too if it changes a rule the model must know);
 *   - add it to a group below, which says "looked at it, and here is why not".
 *     Pick the group that is true. A new group is a real decision: say why.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
/** Where a per-task read or write has to live to count. */
const TASK_SURFACE = ['serialize.ts', 'tools.ts', 'taskFields.ts'];

const NOT_EXPOSED: Record<string, string[]> = {
  // Opt-in, device-level writes (a calendar event, an alarm). Which calendar and
  // whether an event exists is the phone's business, and the ids only name
  // things on that phone.
  'device side effects and the ids that name them': [
    'deadlineOnCalendar', 'logCompletionToCalendar', 'calendarEventId', 'calendarEventExternalId',
    'completionCalendarEventId', 'completionCalendarEventExternalId', 'timeBlockEventId', 'timeBlockExternalId',
    'reminderKind', 'completionTimerMinutes', 'completionTimerNote', 'completionTimerStartedAt',
  ],

  // Bookkeeping the app derives or stamps itself: a snapshot taken so an undo
  // can restore it, a once-only stamp, a running timer's state, a rank.
  'machinery the app maintains': [
    'seenAt', 'sortOrder', 'pinnedOrder', 'backfillDismissedFields', 'recurrenceAnchorDay', 'recurrenceAnchorDate',
    'quotaStartedAt', 'rotationLog', 'rotationPeriodStart', 'rotationLastDone', 'previousStreakCount',
    'previousStreakDate', 'priorBestStreak', 'previousFollowUpTaskTally', 'followUpTaskSourceId',
    'followUpTaskSourceTitle', 'generatedSourceId', 'waitingFollowUpDeclinedAt', 'timerStartedAt',
    'timerElapsedSeconds', 'estimateBeforeTiming', 'seriesDefaults', 'pendingImport', 'reminderTimeAnchor',
    'reminderUtcOffsetMinutes', 'createdAt', 'archivedAt', 'previousOccurrenceId',
  ],

  // Read by an aggregate tool or the replica (review_tasks, completion_history,
  // a project or person page), where the grouping is the answer, not a field on
  // one task.
  'grouping the aggregate tools already answer': [
    'seriesId', 'groupId', 'personIds',
  ],

  // Settings Claude has no reason to read or set per task, or that are only
  // reachable through a template or a rule the editor derives.
  'per-task settings with no MCP use yet': [
    'deadlineOffsetDays', 'deadlineMonthDay', 'reminderOffsetDays', 'reminderTracksVisibility',
    'followWaterTarget', 'supplyGroceryItemId', 'deliverableSetsAway', 'gatesApps', 'streakRequiresWindow',
    'seriesMonthDays', 'seriesRepeatMonths', 'vacationPause', 'excludeFromSuggestions',
  ],
};

const ALL_NOT_EXPOSED = Object.values(NOT_EXPOSED).flat();

function taskFields(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'types', 'index.ts'), 'utf8');
  const open = src.indexOf('{', src.indexOf('export interface Task {'));
  let depth = 0;
  let close = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { close = i; break; }
  }
  const fields: string[] = [];
  for (const line of src.slice(open + 1, close).split('\n')) {
    const m = line.match(/^ {2}([A-Za-z_]\w*)\??:/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

function surfaceSource(): string {
  return TASK_SURFACE.map(f => readFileSync(join(ROOT, 'mcp', 'src', f), 'utf8')).join('\n');
}

const mentioned = (source: string, field: string) => new RegExp(`\\b${field}\\b`).test(source);

describe('Task fields and the MCP server', () => {
  const fields = taskFields();
  const source = surfaceSource();

  it('finds the Task interface', () => {
    // A parse that quietly found nothing would pass everything below.
    expect(fields.length).toBeGreaterThan(100);
    expect(fields).toContain('dueDate');
  });

  it('has a decision for every field', () => {
    const undecided = fields.filter(f => !mentioned(source, f) && !ALL_NOT_EXPOSED.includes(f));
    expect(undecided).toEqual([]);
  });

  it('lists no field twice', () => {
    expect(ALL_NOT_EXPOSED.filter((f, i) => ALL_NOT_EXPOSED.indexOf(f) !== i)).toEqual([]);
  });

  it('keeps the not-exposed list honest', () => {
    const gone = ALL_NOT_EXPOSED.filter(f => !fields.includes(f));
    const nowExposed = ALL_NOT_EXPOSED.filter(f => mentioned(source, f));
    expect({ gone, nowExposed }).toEqual({ gone: [], nowExposed: [] });
  });
});
