import type { CalendarRequestStatus, Project, UnattendedEntry } from '../types';

/**
 * Whether an agent's write to something that is not a task can be taken back.
 *
 * `agentRevertPlan` (agentRevert.ts) answers this for a task. This is the same
 * rule for the other things an agent writes, and it keeps the part that matters:
 * **an undo is offered only while the record is still how the agent left it.**
 * Where the record has a value to compare (a project's fields, a rule list, a
 * grocery item's tick) the comparison is made. Where it has none (a meal, a
 * log entry), the most that can be said is whether it still exists.
 *
 * What stays record-only, and why:
 * - A recipe, template, stack or project the agent created. Each has contents
 *   the person adds afterward and no edit stamp to tell whether they have, so
 *   an undo would delete work with nothing to say so. A project and a stack
 *   also own other rows.
 * - A grocery item taken off the list. Putting it back would have to rebuild its
 *   quantity, aisle and trolley from nothing.
 * - An automation switch. Each is its own setting with its own setter.
 */

/** The project fields an agent edit can change and a restore can write back. Mirrors `updateProject`'s patch. */
export const PROJECT_REVERT_FIELDS = [
  'title', 'notes', 'deadline', 'eventDate', 'category', 'defaultTaskCategory', 'taskDefaults', 'nudgeCadenceDays', 'autoSchedule',
  'nudgeOptIn', 'weekendSource', 'kind', 'ongoing', 'awayStart', 'awayEnd', 'awayPauses', 'destination', 'pausedUntil',
  'personIds', 'links', 'inOrder', 'showChecked',
] as const;

export type RecordLogSubject = 'meal' | 'food' | 'mood' | 'medication';
export type RuleListName = 'title' | 'weather' | 'event' | 'health' | 'screenTime';

export const RULE_LIST_NAMES: readonly RuleListName[] = ['title', 'weather', 'event', 'health', 'screenTime'];

/** What the plan needs to know about the world, so it can be tested without a store. */
export interface RecordState {
  project(id: string): Project | null;
  /** The item's entry on the list at home, or null when it is not on it. */
  groceryHome(itemId: string): { checked: boolean } | null;
  exists(subject: RecordLogSubject, id: string): boolean;
  ruleList(type: RuleListName): unknown;
  hasNote(text: string): boolean;
  /** Where a calendar request stands, or null when it is gone. */
  calendarRequest(id: string): { status: CalendarRequestStatus } | null;
}

export type AgentRecordPlan =
  | { kind: 'restoreProject'; id: string; patch: Record<string, unknown> }
  | { kind: 'groceryRemove'; itemId: string }
  | { kind: 'groceryCheck'; itemId: string; checked: boolean }
  | { kind: 'removeRecord'; subject: RecordLogSubject; id: string }
  | { kind: 'restoreRules'; type: RuleListName; rules: unknown }
  | { kind: 'noteRemove'; text: string }
  | { kind: 'noteAdd'; text: string }
  | { kind: 'cancelCalendarRequest'; id: string }
  | { kind: 'none'; reason: string | null };

const NONE: AgentRecordPlan = { kind: 'none', reason: null };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isLogSubject(s: string): s is RecordLogSubject {
  return s === 'meal' || s === 'food' || s === 'mood' || s === 'medication';
}

export function agentRecordPlan(entry: UnattendedEntry, state: RecordState): AgentRecordPlan {
  if (entry.actor !== 'agent') return NONE;
  const id = entry.recordId ?? null;

  switch (entry.subject) {
    case 'project': {
      const revert = entry.revert;
      if (entry.action !== 'edited' || !revert || !id) return NONE;
      const project = state.project(id);
      if (!project) return { kind: 'none', reason: 'Since removed' };
      const record = project as unknown as Record<string, unknown>;
      const keys = Object.keys(revert.after);
      if (keys.every(k => same(record[k], revert.before[k]))) return { kind: 'none', reason: 'Undone' };
      if (!keys.every(k => same(record[k], revert.after[k]))) return { kind: 'none', reason: 'Changed since' };
      return { kind: 'restoreProject', id, patch: revert.before };
    }

    case 'grocery': {
      if (!id) return NONE;
      const home = state.groceryHome(id);
      if (entry.action === 'created') {
        if (!home) return { kind: 'none', reason: 'Removed since' };
        if (home.checked) return { kind: 'none', reason: 'Checked off since' };
        return { kind: 'groceryRemove', itemId: id };
      }
      if (entry.action === 'completed') {
        if (!home) return { kind: 'none', reason: 'Removed since' };
        return home.checked ? { kind: 'groceryCheck', itemId: id, checked: false } : { kind: 'none', reason: 'Undone' };
      }
      if (entry.action === 'edited') {
        if (!home) return { kind: 'none', reason: 'Removed since' };
        return home.checked ? { kind: 'none', reason: 'Undone' } : { kind: 'groceryCheck', itemId: id, checked: true };
      }
      return NONE;
    }

    case 'meal':
    case 'food':
    case 'mood':
    case 'medication': {
      if (entry.action !== 'created' || !id || !isLogSubject(entry.subject)) return NONE;
      return state.exists(entry.subject, id)
        ? { kind: 'removeRecord', subject: entry.subject, id }
        : { kind: 'none', reason: 'Removed since' };
    }

    case 'automation': {
      const revert = entry.revert;
      const type = id as RuleListName | null;
      if (!revert || !type || !RULE_LIST_NAMES.includes(type)) return NONE;
      const current = state.ruleList(type);
      if (same(current, revert.before.rules)) return { kind: 'none', reason: 'Undone' };
      if (!same(current, revert.after.rules)) return { kind: 'none', reason: 'Changed since' };
      return { kind: 'restoreRules', type, rules: revert.before.rules };
    }

    case 'note': {
      if (!entry.title) return NONE;
      const has = state.hasNote(entry.title);
      if (entry.action === 'created') return has ? { kind: 'noteRemove', text: entry.title } : { kind: 'none', reason: 'Removed since' };
      if (entry.action === 'cleared') return has ? { kind: 'none', reason: 'Undone' } : { kind: 'noteAdd', text: entry.title };
      return NONE;
    }

    // A request can be taken back only while it is still a request. Once the
    // phone has written the event it is the person's, in their calendar app,
    // which nothing here edits or deletes.
    case 'event': {
      if (entry.action !== 'created' || !id) return NONE;
      const request = state.calendarRequest(id);
      if (!request) return { kind: 'none', reason: 'Removed since' };
      switch (request.status) {
        case 'pending': return { kind: 'cancelCalendarRequest', id };
        case 'written': return { kind: 'none', reason: 'On your calendar' };
        case 'failed': return { kind: 'none', reason: 'Not added' };
        case 'cancelled': return { kind: 'none', reason: 'Undone' };
      }
      return NONE;
    }

    default:
      return NONE;
  }
}

/** The button's label for a plan that can be acted on. */
export function agentRecordLabel(plan: AgentRecordPlan): string | null {
  switch (plan.kind) {
    case 'groceryRemove':
    case 'removeRecord':
    case 'noteRemove':
      return 'Remove';
    case 'restoreProject':
    case 'restoreRules':
    case 'groceryCheck':
    case 'noteAdd':
      return 'Undo';
    // Not "Cancel": the confirmation's own dismiss button already says that.
    case 'cancelCalendarRequest':
      return 'Don’t add';
    case 'none':
      return null;
  }
}
