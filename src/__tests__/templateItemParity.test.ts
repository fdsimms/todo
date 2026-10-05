/**
 * A per-task setting reaches a template only if it is carried through four
 * places, and nothing else ties them together: the `TemplateItem` type, its
 * default in `normalizeTemplateItem`, its copy onto the task in
 * `buildDraftsFromTemplate`, and a control in `TemplateItemEditor`. A field
 * added to `Task` alone compiles and passes every other test, and ships a
 * setting no template can pre-set; one added to the type and the normalizer
 * but not the draft builder ships a control that does nothing.
 *
 * So every `Task` field is either seeded by a template item or named below
 * with the reason it isn't, and every seeded field is checked through the
 * other three places. Adding a field to `Task` fails this suite until you make
 * that call. (`mcp/src/__tests__/templateItemCoverage.test.ts` is the same
 * check one step further out, for what Claude can write.)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildDraftsFromTemplate, normalizeTemplateItem } from '../utils/templateUtils';

const ROOT = join(__dirname, '..', '..');

const NOT_SEEDED: Record<string, string[]> = {
  // What a task records about itself once it exists. A template item is the
  // instruction; these are the history, the same split the medication triple
  // and deliverableKind already make.
  'state a task records as it runs': [
    'completed', 'completedAt', 'missedAt', 'autoScheduledAt', 'createdAt', 'seenAt', 'sortOrder', 'pinned',
    'pinnedOrder', 'backfillDismissedFields', 'progressCount', 'quotaStartedAt', 'rotationLog',
    'rotationPeriodStart', 'rotationLastDone', 'supplyDeclinedAtCount', 'slipCount', 'slipDate', 'penaltyFiredAt',
    'penaltyCreditedAt', 'streakCount', 'streakDate', 'previousStreakCount', 'previousStreakDate', 'priorBestStreak',
    'archived', 'archivedAt', 'timerStartedAt', 'actualMinutes', 'estimateBeforeTiming', 'timerElapsedSeconds',
    'completionTimerStartedAt', 'previousOccurrenceId', 'pendingImport', 'postponeCount', 'postponeMuted',
    'driftingSince', 'bountyPushes', 'deliverableValue', 'deliverableWhy', 'deliverableRevisitIf',
    'followUpTaskTally', 'previousFollowUpTaskTally', 'followUpTaskSourceTitle', 'followUpTaskSourceId',
    'waitingOnPersonSince', 'waitingFollowUpDeclinedAt', 'generatedKind', 'generatedSourceId', 'calendarEventId',
    'calendarEventExternalId', 'completionCalendarEventId', 'completionCalendarEventExternalId', 'timeBlockEventId',
    'timeBlockExternalId', 'reminderUtcOffsetMinutes', 'recurrenceAnchorDay', 'recurrenceAnchorDate',
  ],

  // A template has no calendar date of its own. These are written as offsets
  // from the run's anchors (dueOffsetDays, deferOffsetDays, deadlineOffsetDays,
  // reminderOffsetMinutes), and the draft builder derives the task's dates and
  // its relative deadline and reminder from them.
  'a date, written as an offset from the run\'s anchors': [
    'dueDate', 'deadline', 'deferUntil', 'reminderTime', 'reminderOffsetDays',
    'recurrenceEndDate',
  ],

  // Decided by the run, not the item: the container, the parent task, who the
  // run is for, and the tasks a blocker names (blockedByItemIds, resolved once
  // those items are tasks).
  'placed by the run itself': ['parentId', 'projectId', 'personIds', 'seriesId', 'blockedById', 'blockedByIds', 'waitForSeriesEnd'],

  // A count of something on a shelf. Seeded on every run, it would hand each
  // new task a fresh stock nobody bought.
  'inventory, which a template would duplicate on every run': [
    'supplyCount', 'supplyUnit', 'supplyRefillCount', 'supplyReorderAt', 'supplyLeadDays', 'supplyGroceryItemId',
  ],

  // Names someone or something outside the template that a run can't know.
  'names a person or a date outside the template': ['waitingOnPersonId', 'followUpOn'],

  // Read from and written to Apple Health. Withheld from templates for the
  // reason a medication is withheld over MCP: a template is a way to hand them
  // out unattended (docs/arch/health-data.md).
  'reads or writes Apple Health': [
    'healthMetric', 'healthTarget', 'healthFollowGoal', 'logHealthMetric', 'logHealthAmount', 'followWaterTarget',
  ],

  // Real settings a template could carry, not offered yet. Each needs its own
  // control in TemplateItemEditor; move it out of this list when one is built.
  // quotaIntervalMinutes derives targetCount from the time window, which needs
  // the window and the interval edited together.
  'not offered on a template yet': [
    'showStreak', 'streakRequiresWindow', 'deadlineMonthDay', 'deadlineOnCalendar', 'logCompletionToCalendar',
    'reminderKind', 'reminderTracksVisibility', 'reminderTimeAnchor', 'quotaIntervalMinutes', 'quotaAlwaysVisible',
    'timedMinutes', 'followUpTaskEveryN', 'followUpTaskTitle', 'followUpTaskDraft', 'followUpTaskOneAtATime',
    'followUpTaskAtEnd', 'seriesMonthDays', 'seriesRepeatMonths', 'seriesDefaults',
  ],
};

/**
 * Seeded fields that the run applies rather than the draft builder: `id` is
 * minted per task, `groupId` names a template section (the run turns it into a
 * stack), and `answerGate` points at another item until the run resolves it.
 */
const SET_BY_THE_RUN = ['id', 'groupId', 'answerGate'];

/**
 * TemplateItem fields the item editor deliberately has no control for, each
 * with its own home: identity and structure the template editor owns.
 */
const NOT_IN_ITEM_EDITOR = ['id', 'groupId', 'refTemplateId', 'refTemplateName'];

const ALL_NOT_SEEDED = Object.values(NOT_SEEDED).flat();

function interfaceFields(name: string): string[] {
  const src = readFileSync(join(ROOT, 'src', 'types', 'index.ts'), 'utf8');
  const start = src.indexOf(`export interface ${name} {`);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  return body.split('\n').flatMap(line => {
    const m = line.match(/^ {2}([A-Za-z_]\w*)\??:/);
    return m ? [m[1]] : [];
  });
}

describe('Task fields and template items', () => {
  const taskFields = interfaceFields('Task');
  const itemFields = interfaceFields('TemplateItem');
  const seeded = taskFields.filter(f => itemFields.includes(f));

  it('finds both interfaces', () => {
    expect(taskFields.length).toBeGreaterThan(100);
    expect(itemFields).toContain('dueOffsetDays');
  });

  it('has a decision for every Task field', () => {
    expect(taskFields.filter(f => !itemFields.includes(f) && !ALL_NOT_SEEDED.includes(f))).toEqual([]);
  });

  it('names no field that is seeded after all, none twice, and none that no longer exists', () => {
    expect(ALL_NOT_SEEDED.filter(f => itemFields.includes(f))).toEqual([]);
    expect(ALL_NOT_SEEDED.filter((f, i) => ALL_NOT_SEEDED.indexOf(f) !== i)).toEqual([]);
    expect(ALL_NOT_SEEDED.filter(f => !taskFields.includes(f))).toEqual([]);
  });

  it('gives every TemplateItem field a default in normalizeTemplateItem', () => {
    const normalized = Object.keys(normalizeTemplateItem({}));
    expect(itemFields.filter(f => !normalized.includes(f))).toEqual([]);
  });

  it('copies every seeded field onto the task draft', () => {
    const [draft] = buildDraftsFromTemplate([normalizeTemplateItem({ title: 'x' })], { start: null, end: null });
    const copied = Object.keys(draft);
    expect(seeded.filter(f => !SET_BY_THE_RUN.includes(f) && !copied.includes(f))).toEqual([]);
  });

  it('has a control in TemplateItemEditor for every TemplateItem field', () => {
    const editor = readFileSync(join(ROOT, 'src', 'components', 'TemplateItemEditor.tsx'), 'utf8');
    // The save handler names each field it writes, so a field it never names
    // is one the editor can't set (and would reset on every save).
    expect(itemFields.filter(f => !NOT_IN_ITEM_EDITOR.includes(f) && !new RegExp(`\\b${f}\\b`).test(editor))).toEqual([]);
  });
});
