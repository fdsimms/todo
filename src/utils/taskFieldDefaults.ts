import type { Category, Difficulty, Effort, Priority, Task, TaskFieldDefaults } from '../types';
import { PRIORITY_LABELS } from '../types';
import { EFFORT_MINUTES, formatDuration } from './effort';
import { dismissBackfillField, estimatePatchFor, isFieldMissing, isBackfillDismissed, type BackfillFieldId } from './fieldBackfill';

/**
 * Priority, difficulty and time estimate given once for a group of tasks, so the
 * backfill screen doesn't ask about each one.
 *
 * Two homes feed this: a project's own list (`Project.taskDefaults`, for a wish
 * list or a gift ideas list) and a kind of generated task (Settings'
 * `generatedTaskDefaults`, for "Use up X" or a birthday reminder). Both are the
 * same three questions the backfill screen asks, which is the point: a field a
 * default answers is a field that never reaches that queue.
 *
 * **A default fills a field nobody answered and never overrides one.** That is
 * the contract `newTaskDefaults` already has, and it is why this is read in
 * `newTaskFromDraft` beneath whatever the draft names.
 *
 * **`priority: 0` is an answer.** Everywhere else a priority of 0 reads as "not
 * set" (the backfill queue is exactly the tasks at 0), so "these have no
 * priority" is stored as 0 here and a task created under it is stamped as
 * dismissed for the priority field, the same mark "Leave priority unset" writes.
 *
 * **`effort: 0` is an answer for the same reason.** A task with no estimate is
 * exactly what the estimate backfill asks about, so "these need no estimate" is
 * stored as bucket 0 and a task created under it is stamped as dismissed for the
 * estimate field.
 *
 * **The three yes/no fields work the same way with `false` as the "none".**
 * Streak chip, vacation pause and skip-in-suggestions are each a toggle that is
 * off until someone turns it on, so `false` on a default means "leave it off and
 * don't ask", stamped as dismissed, and `true` turns it on. Streak chip and
 * vacation pause only apply to a repeating task (`isFieldMissing` never queues a
 * one-off for either), so a default `true` for those is written to repeating
 * tasks only and is ignored on a one-off.
 */

export const NO_TASK_FIELD_DEFAULTS: TaskFieldDefaults = {
  priority: null, difficulty: null, effort: null,
  showStreak: null, vacationPause: null, excludeFromSuggestions: null,
};

/**
 * The yes/no answers, with the backfill field each one is asked under and
 * whether it only means something on a repeating task.
 */
const TOGGLE_DEFAULTS = [
  { key: 'showStreak', field: 'streak', repeatingOnly: true, on: 'Streak chip', off: 'No streak chip' },
  { key: 'vacationPause', field: 'vacation', repeatingOnly: true, on: 'Pause on vacation', off: 'No vacation pause' },
  { key: 'excludeFromSuggestions', field: 'suggestions', repeatingOnly: false, on: 'Skip in suggestions', off: 'Allow in suggestions' },
] as const satisfies readonly {
  key: 'showStreak' | 'vacationPause' | 'excludeFromSuggestions';
  field: BackfillFieldId;
  repeatingOnly: boolean;
  on: string;
  off: string;
}[];

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Whether any of the three questions has an answer. */
export function hasTaskFieldDefaults(d: TaskFieldDefaults | null | undefined): d is TaskFieldDefaults {
  return !!d && (
    d.priority !== null || d.difficulty !== null || d.effort !== null ||
    TOGGLE_DEFAULTS.some(t => d[t.key] !== null)
  );
}

/**
 * Reads a stored value back, field by field, so a bad value in one field (a
 * hand-edited database, a peer on a newer build) drops that field rather than
 * the whole object. Null when nothing valid is left, so "no defaults" has one
 * representation.
 */
export function parseTaskFieldDefaults(raw: unknown): TaskFieldDefaults | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const result: TaskFieldDefaults = { ...NO_TASK_FIELD_DEFAULTS };
  if (typeof o.priority === 'number' && Number.isInteger(o.priority) && o.priority >= 0 && o.priority <= 4) {
    result.priority = o.priority as Priority;
  }
  if (DIFFICULTIES.includes(o.difficulty as Difficulty)) result.difficulty = o.difficulty as Difficulty;
  if (typeof o.effort === 'number' && Number.isInteger(o.effort) && o.effort >= 0 && o.effort <= 6) {
    result.effort = o.effort as Effort;
  }
  for (const t of TOGGLE_DEFAULTS) {
    if (typeof o[t.key] === 'boolean') result[t.key] = o[t.key] as boolean;
  }
  return hasTaskFieldDefaults(result) ? result : null;
}

/** The stored form: null (SQL NULL) for no defaults, else the JSON object. */
export function serializeTaskFieldDefaults(d: TaskFieldDefaults | null | undefined): string | null {
  return hasTaskFieldDefaults(d) ? JSON.stringify(d) : null;
}

/**
 * Parses the per-kind record in Settings. Keys are not checked against the
 * current kinds, so a kind this build doesn't know (written by a newer peer)
 * survives a round trip instead of being dropped on the next save.
 */
export function parseGeneratedTaskDefaults(raw: string | null): Record<string, TaskFieldDefaults> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, TaskFieldDefaults> = {};
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      const d = parseTaskFieldDefaults(value);
      if (d) out[kind] = d;
    }
    return out;
  } catch {
    return {};
  }
}

/** The first answer per field, most specific source first. */
export function resolveFieldDefaults(
  ...sources: (TaskFieldDefaults | null | undefined)[]
): TaskFieldDefaults {
  const result: TaskFieldDefaults = { ...NO_TASK_FIELD_DEFAULTS };
  for (const s of sources) {
    if (!s) continue;
    if (result.priority === null) result.priority = s.priority;
    if (result.difficulty === null) result.difficulty = s.difficulty;
    if (result.effort === null) result.effort = s.effort;
    for (const t of TOGGLE_DEFAULTS) {
      if (result[t.key] === null) result[t.key] = s[t.key] ?? null;
    }
  }
  return result;
}

export interface SeededFieldsInput {
  priority?: Priority;
  effort?: Effort;
  estimatedMinutes?: number | null;
  difficulty?: Difficulty | null;
  recurrenceType?: Task['recurrenceType'];
  showStreak?: boolean;
  vacationPause?: boolean;
  excludeFromSuggestions?: boolean;
}

export interface SeededFields {
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null;
  difficulty: Difficulty | null;
  /**
   * Each toggle a group default turned on: `true`, or `undefined` for "the
   * default has nothing to add". Never `false`, so a caller's own fallback (a
   * streak chip is on for an avoid-habit) isn't overwritten by a default that
   * only said "don't ask".
   */
  showStreak: boolean | undefined;
  vacationPause: boolean | undefined;
  excludeFromSuggestions: boolean | undefined;
  backfillDismissedFields: string[];
}

/**
 * The four fields a new task starts with: what the draft named, else the
 * group's default, else Settings' global one.
 *
 * `negative` is an avoid-habit, which earns nothing and so is never rated (the
 * backfill queue excludes it for the same reason), so a default difficulty is
 * not handed to one.
 *
 * An estimate bucket from a default also writes its minutes when the draft has
 * none: the backfill queue asks about `estimatedMinutes`, not the bucket, so a
 * bucket alone would leave the task still reading as unestimated.
 */
export function seedTaskFields(
  draft: SeededFieldsInput,
  group: TaskFieldDefaults,
  global: { priority: Priority | null; effort: Effort | null; difficulty: Difficulty | null },
  negative: boolean,
): SeededFields {
  const priority: Priority = draft.priority ?? group.priority ?? global.priority ?? 0;
  const effort: Effort = draft.effort ?? group.effort ?? global.effort ?? 0;
  const estimatedMinutes =
    draft.estimatedMinutes ??
    (group.effort !== null && effort === group.effort ? EFFORT_MINUTES[group.effort] ?? null : null);
  const difficulty = negative ? (draft.difficulty ?? null) : draft.difficulty ?? group.difficulty ?? global.difficulty ?? null;
  // Only a group's own "none" counts: a priority or estimate of 0 with no group
  // answer behind it is exactly the unanswered state the queue is for.
  const repeating = (draft.recurrenceType ?? 'none') !== 'none';
  const toggles: Record<(typeof TOGGLE_DEFAULTS)[number]['key'], boolean | undefined> = {
    showStreak: undefined, vacationPause: undefined, excludeFromSuggestions: undefined,
  };
  const toggleDismissed: string[] = [];
  for (const t of TOGGLE_DEFAULTS) {
    if (draft[t.key] === true) continue;
    if (group[t.key] === true && (repeating || !t.repeatingOnly)) toggles[t.key] = true;
    else if (group[t.key] === false) toggleDismissed.push(t.field);
  }
  const dismissed = [
    ...(group.priority === 0 && priority === 0 ? ['priority'] : []),
    ...(group.effort === 0 && effort === 0 && estimatedMinutes === null ? ['estimate'] : []),
    ...toggleDismissed,
  ];
  return { priority, effort, estimatedMinutes, difficulty, ...toggles, backfillDismissedFields: dismissed };
}

/**
 * What a new task will start with in priority and effort when nothing answers
 * them: the editor shows this on a row the person hasn't touched, so the label
 * reads off the same `seedTaskFields` the save does and cannot disagree with it.
 *
 * `projectDefaults` is the chosen project's own `taskDefaults`. A generated
 * kind never reaches the editor, so that layer of `newTaskFromDraft` has no
 * counterpart here.
 */
export function previewSeededFields(
  projectDefaults: TaskFieldDefaults | null | undefined,
  global: { priority: Priority | null; effort: Effort | null; difficulty: Difficulty | null },
  negative: boolean,
  recurrenceType: Task['recurrenceType'] = 'none',
): {
  priority: Priority; effort: Effort;
  showStreak: boolean; vacationPause: boolean; excludeFromSuggestions: boolean;
} {
  const seeded = seedTaskFields({ recurrenceType }, resolveFieldDefaults(projectDefaults), global, negative);
  return {
    priority: seeded.priority,
    effort: seeded.effort,
    showStreak: seeded.showStreak === true,
    vacationPause: seeded.vacationPause === true,
    excludeFromSuggestions: seeded.excludeFromSuggestions === true,
  };
}

/**
 * The category a new task lands in when none is chosen: the project's own
 * default, else Settings'. The same two layers, in the same order, as
 * `newTaskFromDraft`.
 */
export function previewCategoryDefault(
  projectDefaultCategory: string | null | undefined,
  globalCategory: string | null | undefined,
): string | null {
  return projectDefaultCategory ?? globalCategory ?? null;
}

/**
 * What to write onto a task that already exists, filling only what is still
 * unanswered. Null when there is nothing to fill. Used by "Apply to existing
 * tasks" on a project and by the backfill screen's whole-group apply.
 *
 * Goes through the backfill queue's own test (`isFieldMissing`, dismissals)
 * rather than a second definition of "unanswered", so a task this skips is
 * exactly a task the queue wasn't going to ask about. `categories` is that
 * test's own input for vacation pause and skip-in-suggestions, which a
 * category can already answer.
 */
export function existingTaskPatch(
  task: Task,
  d: TaskFieldDefaults | null | undefined,
  categories?: Category[],
): Partial<Task> | null {
  if (!hasTaskFieldDefaults(d)) return null;
  let patch: Partial<Task> = {};
  // Read through the patch so two "none" answers add to one dismissed list
  // rather than the second overwriting the first.
  const dismissing = (fieldId: BackfillFieldId) => dismissBackfillField({ ...task, ...patch } as Task, fieldId);
  if (d.priority !== null && isFieldMissing(task, 'priority') && !isBackfillDismissed(task, 'priority')) {
    patch = d.priority === 0
      ? { ...patch, ...dismissing('priority') }
      : { ...patch, priority: d.priority };
  }
  if (d.difficulty !== null && isFieldMissing(task, 'difficulty') && !isBackfillDismissed(task, 'difficulty')) {
    patch = { ...patch, difficulty: d.difficulty };
  }
  if (d.effort !== null && isFieldMissing(task, 'estimate') && !isBackfillDismissed(task, 'estimate')) {
    patch = d.effort === 0
      ? { ...patch, ...dismissing('estimate') }
      : { ...patch, ...estimatePatchFor(d.effort) };
  }
  for (const t of TOGGLE_DEFAULTS) {
    const answer = d[t.key];
    if (answer === null || answer === undefined) continue;
    if (!isFieldMissing(task, t.field, categories) || isBackfillDismissed(task, t.field)) continue;
    patch = answer ? { ...patch, [t.key]: true } : { ...patch, ...dismissing(t.field) };
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The tasks a default would change, for the count on an "Apply to existing" button. */
export function tasksNeedingDefaults(
  tasks: Task[],
  d: TaskFieldDefaults | null | undefined,
  categories?: Category[],
): Task[] {
  return tasks.filter(t => !t.parentId && !t.completed && !t.archived && existingTaskPatch(t, d, categories) !== null);
}

/** "No priority, Easy, 15m" for a row's current-value summary; null with no answers. */
export function describeTaskFieldDefaults(d: TaskFieldDefaults | null | undefined): string | null {
  if (!hasTaskFieldDefaults(d)) return null;
  const parts: string[] = [];
  if (d.priority !== null) parts.push(d.priority === 0 ? 'No priority' : PRIORITY_LABELS[d.priority]);
  if (d.difficulty !== null) parts.push(d.difficulty === 'easy' ? 'Easy' : d.difficulty === 'hard' ? 'Hard' : 'Normal');
  if (d.effort === 0) parts.push('No estimate');
  else if (d.effort !== null) {
    const mins = EFFORT_MINUTES[d.effort];
    if (mins != null) parts.push(formatDuration(mins));
  }
  for (const t of TOGGLE_DEFAULTS) {
    if (d[t.key] === true) parts.push(t.on);
    else if (d[t.key] === false) parts.push(t.off);
  }
  return parts.join(', ');
}

/**
 * The group default a backfill answer implies, for the "also use this for new
 * tasks" offer after a whole-group apply. `patch` is what was written to each
 * task. Leaving priority unset implies "no priority" (0) and leaving an estimate
 * unset implies "no estimate" (0); leaving difficulty unset implies nothing,
 * since it has no "none" answer. The yes/no fields map directly: turning one on
 * implies `true`, leaving it off implies `false`.
 */
export function defaultsFromAnswer(
  fieldId: string,
  patch: Partial<Task>,
  dismissed: boolean,
): Partial<TaskFieldDefaults> | null {
  if (fieldId === 'priority') {
    if (dismissed) return { priority: 0 };
    return patch.priority !== undefined ? { priority: patch.priority } : null;
  }
  if (fieldId === 'estimate' && dismissed) return { effort: 0 };
  const toggle = TOGGLE_DEFAULTS.find(t => t.field === fieldId);
  if (toggle) {
    if (dismissed) return { [toggle.key]: false };
    return patch[toggle.key] === true ? { [toggle.key]: true } : null;
  }
  if (dismissed) return null;
  if (fieldId === 'difficulty') return patch.difficulty ? { difficulty: patch.difficulty } : null;
  if (fieldId === 'estimate') return patch.effort ? { effort: patch.effort } : null;
  return null;
}

/** Whether `answer` would change `current`, so the offer is not made for a default already set. */
export function defaultsDiffer(current: TaskFieldDefaults | null | undefined, answer: Partial<TaskFieldDefaults>): boolean {
  const base = current ?? NO_TASK_FIELD_DEFAULTS;
  return (Object.keys(answer) as (keyof TaskFieldDefaults)[]).some(k => base[k] !== answer[k]);
}
