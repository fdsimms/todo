import type { Alarm, SavedFocusFilter, SavedFocusSession, Task } from '../types';
import { suggestFocusTasks, type FocusContext } from './focusSuggest';
import { FOCUS_WINDOW_MAX, FOCUS_WINDOW_MIN } from './focusSettings';

/**
 * Saved focus sessions: a name, a rule for which tasks it draws from, and a
 * time window, kept to start when an alarm is turned off.
 *
 * **It stores a rule, not tasks.** The queue is picked when the alarm is
 * turned off, through the same `suggestFocusTasks` the setup sheet uses, so a
 * task finished yesterday is never in it and a repeating morning alarm doesn't
 * run out of tasks. Breaks come from the Focus settings, not from here.
 *
 * Device-local, in a setting beside the alarms that point at them (alarms are
 * never synced, so a link to a synced session would dangle on every other
 * device anyway).
 */
export const SAVED_FOCUS_SETTING = 'savedFocusSessions';

/** The most a person can keep. A list past this is a list nobody picks from. */
export const MAX_SAVED_FOCUS = 12;

const FILTER_KINDS = ['category', 'project', 'tag'] as const;

function normalizeFilter(raw: unknown): SavedFocusFilter {
  if (typeof raw !== 'object' || raw === null) return { kind: 'all' };
  const { kind, value } = raw as { kind?: unknown; value?: unknown };
  const kindOk = FILTER_KINDS.find(k => k === kind);
  if (kindOk && typeof value === 'string' && value.trim() !== '') return { kind: kindOk, value: value.trim() };
  return { kind: 'all' };
}

/** A window clamped to the setup sheet's own bounds, or null for no limit. */
export function normalizeWindow(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(FOCUS_WINDOW_MAX, Math.max(FOCUS_WINDOW_MIN, Math.round(raw)));
}

/** The stored form of one session, or null for anything with no id or name. */
export function normalizeSavedFocus(raw: unknown): SavedFocusSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name, filter, windowMinutes } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name.trim() === '') return null;
  return { id, name: name.trim(), filter: normalizeFilter(filter), windowMinutes: normalizeWindow(windowMinutes) };
}

/** Reads the setting back, dropping what is malformed rather than failing on it. */
export function parseSavedFocusSessions(raw: string | null | undefined): SavedFocusSession[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: SavedFocusSession[] = [];
    for (const item of parsed) {
      const s = normalizeSavedFocus(item);
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
    return out.slice(0, MAX_SAVED_FOCUS);
  } catch {
    return [];
  }
}

/** Whether `a` and `b` name the same session, the way a name-taken check should compare. */
export function savedFocusNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether `name` is already another session's, for the editor's inline refusal. */
export function savedFocusNameTaken(name: string, sessions: readonly SavedFocusSession[], exceptId?: string): boolean {
  const key = savedFocusNameKey(name);
  return key !== '' && sessions.some(s => s.id !== exceptId && savedFocusNameKey(s.name) === key);
}

/** "Project: Thesis", "Any task". */
export function describeFilter(filter: SavedFocusFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'Any task';
    case 'category':
      return `Category: ${filter.value}`;
    case 'project':
      return `Project: ${filter.value}`;
    case 'tag':
      return `Tag: ${filter.value}`;
  }
}

/** Whether `task` matches the rule. A project filter holds the project's id. */
export function matchesFilter(task: Pick<Task, 'category' | 'projectId' | 'tags'>, filter: SavedFocusFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'category':
      return task.category === filter.value;
    case 'project':
      return task.projectId === filter.value;
    case 'tag':
      return task.tags.includes(filter.value);
  }
}

/**
 * The task ids a saved session would start with: the tasks its rule matches,
 * ranked and fitted to its window by the suggester. `ctx` carries the clock
 * and the rest rules (`buildFocusContext`), so the caller decides what "now"
 * is; the saved window replaces the one the context was built with.
 */
export function savedFocusQueue(
  saved: Pick<SavedFocusSession, 'filter' | 'windowMinutes'>,
  tasks: readonly Task[],
  ctx: FocusContext,
): string[] {
  const pool = tasks.filter(t => matchesFilter(t, saved.filter));
  return suggestFocusTasks(pool, { ...ctx, windowMinutes: saved.windowMinutes });
}

/**
 * The saved session an alarm that was just turned off should offer, or null:
 * none linked, or the one it names was deleted.
 */
export function focusOfferFor(
  alarm: Pick<Alarm, 'savedFocusId'> | undefined,
  sessions: readonly SavedFocusSession[],
): SavedFocusSession | null {
  if (!alarm?.savedFocusId) return null;
  return sessions.find(s => s.id === alarm.savedFocusId) ?? null;
}

/** The alarms that start `sessionId`, for the editor's "Used by" row. */
export function alarmsUsing(sessionId: string, alarms: readonly Pick<Alarm, 'id' | 'savedFocusId'>[]): string[] {
  return alarms.filter(a => a.savedFocusId === sessionId).map(a => a.id);
}
