/**
 * Every `Task` field is either something the MCP server reads or writes, or
 * is named here as deliberately not exposed.
 *
 * `Task` and the server are separate interfaces, so a field added to `Task`
 * alone compiles, passes every test and ships a capability Claude can neither
 * see nor set, with nothing to say so. This is the same shape as the
 * `TemplateItem` parity note in CLAUDE.md, and the answer is the same: make
 * the decision a thing the build asks for.
 *
 * A field counts as handled when its name appears in any non-test file under
 * `mcp/src` (the serializer, a tool's input, `taskFields.ts`). That is a
 * word match on source, not a proof, so it can be satisfied by a comment;
 * what it reliably catches is a field nobody has looked at. Reading source
 * rather than types is deliberate: an interface leaves nothing to enumerate
 * at runtime.
 *
 * Adding a field to `Task` fails this suite until you do one of:
 *   - expose it (`serialize.ts` to read it, `taskFields.ts` or a tool input to
 *     write it; `instructions.ts` too if it changes a rule the model must know);
 *   - add it to NOT_EXPOSED below, which says "looked at it, Claude doesn't
 *     need it" (machinery, sync bookkeeping, counters the app derives from).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** Decided not to expose. Machinery, bookkeeping, and state the app derives. */
const NOT_EXPOSED = [
  'missedAt', 'autoScheduledAt', 'seenAt', 'deadlineMonthDay', 'deadlineOnCalendar',
  'logCompletionToCalendar', 'logHealthMetric', 'logHealthAmount', 'medicationName',
  'medicationAmount', 'medicationUnit', 'logMealSlot', 'recurrenceAnchorDay',
  'quotaStartedAt', 'followWaterTarget', 'rotationEnabled', 'rotationItems', 'rotationLog',
  'rotationPeriodStart', 'rotationLastDone', 'supplyCount', 'supplyUnit', 'supplyRefillCount',
  'supplyReorderAt', 'supplyLeadDays', 'supplyGroceryItemId', 'pinnedOrder',
  'backfillDismissedFields', 'reminderKind', 'reminderOffsetDays', 'reminderTracksVisibility',
  'reminderTimeAnchor', 'reminderUtcOffsetMinutes', 'emailAddress', 'waitingOnPersonId',
  'waitingOnPersonSince', 'waitingFollowUpDeclinedAt', 'followUpOn', 'deliverableSetsAway',
  'generatedKind', 'generatedSourceId', 'calendarEventId', 'calendarEventExternalId',
  'completionCalendarEventId', 'completionCalendarEventExternalId', 'timeBlockEventId',
  'timeBlockExternalId', 'slipCount', 'slipDate', 'penaltyMinutes', 'penaltyCutoffTime',
  'penaltyFiredAt', 'penaltyCreditedAt', 'previousStreakCount', 'previousStreakDate',
  'streakRequiresWindow', 'seriesMonthDays', 'seriesRepeatMonths', 'previousFollowUpTaskTally',
  'followUpTaskSourceTitle', 'followUpTaskSourceId', 'pinEachOccurrence', 'timerStartedAt',
  'actualMinutes', 'estimateBeforeTiming', 'timedMinutes', 'timerElapsedSeconds',
  'healthMetric', 'healthTarget', 'healthFollowGoal', 'completionTimerNote',
  'completionTimerStartedAt', 'seriesDefaults', 'pendingImport', 'postponeCount',
  'postponeMuted', 'driftingSince', 'bountyPushes',
];

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

function mcpSource(dir = join(ROOT, 'mcp', 'src')): string {
  let text = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') text += mcpSource(full);
    } else if (entry.name.endsWith('.ts')) text += readFileSync(full, 'utf8') + '\n';
  }
  return text;
}

const mentioned = (source: string, field: string) => new RegExp(`\\b${field}\\b`).test(source);

describe('Task fields and the MCP server', () => {
  const fields = taskFields();
  const source = mcpSource();

  it('finds the Task interface', () => {
    // A parse that quietly found nothing would pass everything below.
    expect(fields.length).toBeGreaterThan(100);
    expect(fields).toContain('dueDate');
  });

  it('has a decision for every field', () => {
    const undecided = fields.filter(f => !mentioned(source, f) && !NOT_EXPOSED.includes(f));
    expect(undecided).toEqual([]);
  });

  it('keeps the not-exposed list honest', () => {
    const gone = NOT_EXPOSED.filter(f => !fields.includes(f));
    const nowExposed = NOT_EXPOSED.filter(f => mentioned(source, f));
    expect({ gone, nowExposed }).toEqual({ gone: [], nowExposed: [] });
  });
});
