/**
 * Every write is shown before it happens.
 *
 * A write tool called without `apply: true` does not write. It runs the real
 * write inside a transaction that is rolled back (`replica.dryRun`), collects
 * the Activity entries the write would have made, and answers with those in
 * plain words and a one-time `confirmToken`. Only a second call with that token
 * writes, and where the client can show a dialog the server then asks the
 * person directly (elicitation, server.ts), so the description comes from the
 * server rather than from the model's summary of it.
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
  /** The summary the token was issued with, or the reason it cannot be used. Spends the token. */
  redeem(token: string, tool: string, args: Record<string, unknown>): { ok: true; summary: string[] } | { ok: false; reason: string };
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
    redeem(token, tool, args) {
      sweep();
      const entry = issued.get(token);
      if (!entry) return { ok: false, reason: 'That confirmToken has expired or was already used. Call without apply to preview again.' };
      if (entry.tool !== tool || entry.hash !== requestHash(tool, args)) {
        return { ok: false, reason: 'That confirmToken was issued for a different request. Preview this exact request first, show it, then confirm it unchanged.' };
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
  polarity: 'habit type', blockedById: 'waits on', blockedByIds: 'waits on', chainItems: 'steps',
  timedMinutes: 'countdown', rotationEnabled: 'rotation', rotationItems: 'rotation members',
  healthMetric: 'health target', healthTarget: 'health goal', healthFollowGoal: 'follows Fitness goal',
  supplyCount: 'supply left', supplyUnit: 'supply unit', supplyRefillCount: 'refill amount',
  supplyReorderAt: 'reorder at', supplyLeadDays: 'delivery days',
  deliverableValue: 'answer', deliverableWhy: 'reason for the answer', deliverableRevisitIf: 'revisit if',
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'nothing';
  if (typeof value === 'string') {
    // An ISO instant reads as its day: the time part is machinery here.
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : `"${value}"`;
  }
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  return String(value);
}

function fieldChanges(entry: AgentLedgerEntry): string[] {
  const revert = entry.revert;
  if (!revert) return [];
  return Object.keys(revert.after)
    .filter(k => FIELD_NAMES[k])
    .map(k => `${FIELD_NAMES[k]} from ${show(revert.before[k])} to ${show(revert.after[k])}`);
}

const SUBJECT_NOUN: Record<string, string> = {
  task: 'task', project: 'project', template: 'template', recipe: 'recipe', meal: 'meal',
};

/** One line per effect, in the order they would happen. */
export function describeEffects(effects: readonly AgentLedgerEntry[]): string[] {
  return effects.map(e => {
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
      case 'note': return e.action === 'cleared' ? `Forget the note ${t}` : `Remember the note ${t}`;
      case 'meal': return `Plan ${t} on the meal plan`;
      case 'template':
        if (e.action === 'cleared') return `Delete the template ${t}. It cannot be restored from here.`;
        if (e.action === 'moved') return `Reorder ${t}`;
        break;
      default: break;
    }
    const noun = SUBJECT_NOUN[e.subject] ?? e.subject;
    const changes = fieldChanges(e);
    switch (e.action) {
      case 'created': {
        const steps = (e.count ?? 1) - 1;
        return e.subject === 'project' && steps > 0
          ? `Create the project ${t} with ${steps} ${steps === 1 ? 'task' : 'tasks'}`
          : `Create the ${noun} ${t}`;
      }
      case 'completed': return `Complete the ${noun} ${t}`;
      case 'moved': return `Move ${t}${changes.length ? `: ${changes.join('; ')}` : ''}`;
      case 'cleared': return `Archive ${t}`;
      case 'edited': return changes.length ? `Change ${t}: ${changes.join('; ')}` : `Change the ${noun} ${t}`;
      default: return `${e.action} ${t}`;
    }
  });
}
