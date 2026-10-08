/**
 * Every write is shown before it happens.
 *
 * A write tool called without `apply: true` does not write. It runs the real
 * write inside a transaction that is rolled back (`replica.dryRun`), collects
 * the Activity entries the write would have made, and answers with those in
 * plain words and a one-time `confirmToken`. Only a second call with that token
 * writes. The description comes from the server rather than from the model's
 * summary of it, and the confirming call has to repeat it (`willDo`), because
 * a client's approval prompt shows a call's arguments and nothing else. The
 * preview itself is the read-only `preview_change` tool, so only the write
 * asks for approval.
 *
 * Why a dry run rather than a description each tool writes for itself: the
 * effect of a write is not predictable from its request (a reschedule may move
 * `deferUntil` and not the due date, a completion spawns the next occurrence, a
 * title rule refiles a new task). Running it and reading back what changed is
 * the only description that cannot disagree with the write.
 *
 * **The token binds the exact request.** It is issued for one tool and one set
 * of arguments, used once, and expires; a confirm with anything changed is
 * refused, so what runs is what was shown.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AgentLedgerEntry } from './agentLedger';

/** How long a preview stays confirmable. Long enough to ask a person; short enough not to act on stale state. */
export const CONFIRM_TTL_MS = 15 * 60_000;

/** Arguments in a fixed key order, so the same request hashes the same however it was written. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map(k => [k, stable((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export function requestHash(tool: string, args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([tool, stable(args)])).digest('hex');
}

export interface ConfirmTokens {
  issue(tool: string, args: Record<string, unknown>, summary: string[]): string;
  /**
   * The summary the token was issued with, or the reason it cannot be used.
   * Spends the token, except when `echoed` is given and differs from the
   * summary: that is refused without spending it, so the caller can repeat the
   * call with the right lines.
   */
  redeem(token: string, tool: string, args: Record<string, unknown>, echoed?: readonly string[]): { ok: true; summary: string[] } | { ok: false; reason: string };
}

export function createConfirmTokens(now: () => number = Date.now): ConfirmTokens {
  const issued = new Map<string, { hash: string; tool: string; expires: number; summary: string[] }>();
  const sweep = () => {
    const t = now();
    for (const [k, v] of issued) if (v.expires < t) issued.delete(k);
  };
  return {
    issue(tool, args, summary) {
      sweep();
      const token = randomBytes(9).toString('base64url');
      issued.set(token, { hash: requestHash(tool, args), tool, expires: now() + CONFIRM_TTL_MS, summary });
      return token;
    },
    redeem(token, tool, args, echoed) {
      sweep();
      const entry = issued.get(token);
      if (!entry) return { ok: false, reason: 'That confirmToken has expired or was already used. Preview again with preview_change.' };
      if (entry.tool !== tool || entry.hash !== requestHash(tool, args)) {
        return { ok: false, reason: 'That confirmToken was issued for a different request. Preview this exact request first, show it, then confirm it unchanged.' };
      }
      if (echoed !== undefined && JSON.stringify(echoed) !== JSON.stringify(entry.summary)) {
        return { ok: false, reason: `willDo must repeat the preview's lines exactly, so the approval prompt shows what will happen. Nothing was changed and the confirmToken still works. The lines are: ${JSON.stringify(entry.summary)}` };
      }
      issued.delete(token);
      return { ok: true, summary: entry.summary };
    },
  };
}

// ---------------------------------------------------------------------------
// Plain words for an effect
// ---------------------------------------------------------------------------

/** Fields a person set and would recognise, by the name the app shows them under. */
const FIELD_NAMES: Record<string, string> = {
  title: 'title', notes: 'notes', category: 'category', tags: 'tags', projectId: 'project', dueDate: 'date',
  deferUntil: 'hidden until', deadline: 'deadline', reminderTime: 'reminder', timeSegments: 'time of day',
  priority: 'priority', effort: 'effort', difficulty: 'difficulty', estimatedMinutes: 'estimate', pinned: 'pinned',
  archived: 'archived', recurrenceType: 'repeat', recurrenceInterval: 'repeat interval', recurrenceDays: 'repeat days',
  windowStart: 'shown from', windowEnd: 'shown until', targetCount: 'daily target', deliverableKind: 'question on completion',
  polarity: 'habit type', blockedById: 'waits on', blockedByIds: 'waits on', waitForSeriesEnd: 'waits for the series to end', chainItems: 'steps',
  timedMinutes: 'countdown', rotationEnabled: 'rotation', rotationItems: 'rotation members',
  healthMetric: 'health target', healthTarget: 'health goal', healthFollowGoal: 'follows Fitness goal',
  supplyCount: 'supply left', supplyUnit: 'supply unit', supplyRefillCount: 'refill amount',
  supplyReorderAt: 'reorder at', supplyLeadDays: 'delivery days',
  deliverableValue: 'answer', deliverableWhy: 'reason for the answer', deliverableRevisitIf: 'revisit if',
  weatherWait: 'waits for weather', linkUrl: 'link', phoneNumber: 'phone number', emailAddress: 'email', location: 'location',
  personIds: 'people', deadlineTime: 'deadline time', vacationPause: 'hidden on vacation', pinEachOccurrence: 'pin each occurrence',
  slipAllowance: 'slips allowed', targetUnit: 'target unit', allowOvershoot: 'allow going over the target', quotaPeriod: 'target period',
  recurrenceEndDate: 'repeat ends on', recurrenceCount: 'repeat count', recurrenceMonthDay: 'repeat day of month',
  recurrenceWeekOrdinal: 'repeat week of month', recurrenceFromCompletion: 'repeat from completion', groupId: 'stack',
  answerGate: 'only if answered', followUpOn: 'follow-up date', medicationName: 'medication', completedAt: 'completed on',
};

/** Words for the ids a field holds, so a line never prints an opaque id. */
export interface NameLookup {
  project(id: string): string | undefined;
  task(id: string): string | undefined;
  stack(id: string): string | undefined;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function show(value: unknown, dayOf: (iso: string) => string, key = '', names?: NameLookup): string {
  if (value === null || value === undefined || value === '') return 'nothing';
  const named = (id: unknown, find?: (id: string) => string | undefined) =>
    (typeof id === 'string' ? find?.(id) : undefined) ?? 'another item';
  if (key === 'projectId') return `"${named(value, names?.project)}"`;
  if (key === 'groupId') return `"${named(value, names?.stack)}"`;
  if (key === 'blockedById') return `"${named(value, names?.task)}"`;
  if (key === 'blockedByIds' && Array.isArray(value)) return value.length === 0 ? 'none' : value.map(v => `"${named(v, names?.task)}"`).join(', ');
  if (key === 'recurrenceDays' && Array.isArray(value)) return value.length === 0 ? 'none' : value.map(d => WEEKDAYS[Number(d)] ?? String(d)).join(', ');
  if (key === 'priority' && typeof value === 'number') return `${value} of 4`;
  if (key === 'effort' && typeof value === 'number') return `${value} of 6`;
  if (typeof value === 'string') {
    // The day is the one the replica names for it, never the UTC date in the string.
    // A reminder is an instant, so it keeps its clock time; other dates are days.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return key === 'reminderTime' ? `${dayOf(value)} at ${clock(value)}` : dayOf(value);
    return `"${value}"`;
  }
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  return String(value);
}

function fieldChanges(entry: AgentLedgerEntry, dayOf: (iso: string) => string, names?: NameLookup): string[] {
  const revert = entry.revert;
  if (!revert) return [];
  return Object.keys(revert.after)
    .filter(k => FIELD_NAMES[k])
    .map(k => `${FIELD_NAMES[k]} from ${show(revert.before[k], dayOf, k, names)} to ${show(revert.after[k], dayOf, k, names)}`);
}

/**
 * Identical lines read as one with a count. A batch that does the same thing
 * to many rows (clearing a habit's history) would otherwise repeat a line the
 * confirming call must repeat verbatim; the count keeps every effect visible.
 */
function collapse(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].map(([l, n]) => (n > 1 ? `${l} (${n} times)` : l));
}

const SUBJECT_NOUN: Record<string, string> = {
  task: 'task', project: 'project', template: 'template', recipe: 'recipe', meal: 'meal',
  milestone: 'milestone', journal: 'journal entry', view: 'saved view', setting: 'setting',
};

/**
 * One line per effect, in the order they would happen. `dayOf` is the day a
 * person would name for an ISO instant (`Replica.dayKeyOf`).
 */
export function describeEffects(effects: readonly AgentLedgerEntry[], dayOf: (iso: string) => string, names?: NameLookup): string[] {
  return collapse(effects.map(e => describeOne(e, dayOf, names) + (e.suffix ?? '')));
}

function describeOne(e: AgentLedgerEntry, dayOf: (iso: string) => string, names?: NameLookup): string {
  {
    if (e.note) return e.note;
    const t = `"${e.title}"`;
    switch (e.subject) {
      case 'grocery':
        return e.action === 'created' ? `Put ${t} on the grocery list`
          : e.action === 'completed' ? `Check off ${t} on the grocery list`
          : e.action === 'cleared' ? `Take ${t} off the grocery list`
          : `Uncheck ${t} on the grocery list`;
      case 'food': return `Log ${t} in the food log, marked as estimated`;
      case 'mood': return 'Record a mood check-in';
      case 'medication': return 'Record a medication dose';
      case 'person': return `Add ${t} to someone's history`;
      case 'automation': return `Change automations: ${e.title}`;
      case 'category': return `Delete the category ${t}. It cannot be restored from here.`;
      case 'note': return e.action === 'cleared' ? `Forget the note ${t}` : `Remember the note ${t}`;
      case 'meal': return `Plan ${t} on the meal plan`;
      case 'event': return `Ask the phone to add ${t} to the calendar the next time it syncs`;
      case 'template':
        if (e.action === 'cleared') return `Delete the template ${t}. It cannot be restored from here.`;
        if (e.action === 'moved') return `Reorder ${t}`;
        break;
      default: break;
    }
    const noun = SUBJECT_NOUN[e.subject] ?? e.subject;
    const changes = fieldChanges(e, dayOf, names);
    switch (e.action) {
      case 'created': {
        const steps = (e.count ?? 1) - 1;
        return e.subject === 'project' && steps > 0
          ? `Create the project ${t} with ${steps} ${steps === 1 ? 'task' : 'tasks'}`
          : `Create the ${noun} ${t}`;
      }
      case 'completed': return `Complete the ${noun} ${t}`;
      case 'missed': return `Mark ${t} missed`;
      case 'moved': return `Move ${t}${changes.length ? `: ${changes.join('; ')}` : ''}`;
      case 'cleared': return `Archive ${t}`;
      case 'edited': return changes.length ? `Change ${t}: ${changes.join('; ')}` : `Change the ${noun} ${t}`;
      default: return `${e.action} ${t}`;
    }
  }
}
