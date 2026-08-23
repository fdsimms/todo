import type { Task, Effort } from '../types';
import { EFFORT_MINUTES } from './effort';

/** A field this screen can walk the task list and fill in, one task at a time. */
export type BackfillFieldId = 'estimate' | 'priority' | 'category';

export interface BackfillFieldDef {
  id: BackfillFieldId;
  label: string;
  /** One line explaining what the field is, shown under its row on the field-picker step. */
  hint: string;
}

// Order matters: the order these render in on the field-picker step.
export const BACKFILL_FIELDS: BackfillFieldDef[] = [
  {
    id: 'estimate',
    label: 'Time estimate',
    hint: 'Roughly how long each task takes, so a day’s list can be sized realistically.',
  },
  {
    id: 'priority',
    label: 'Priority',
    hint: 'How each task ranks against everything else on Today.',
  },
  {
    id: 'category',
    label: 'Category',
    hint: 'Which category each task falls under.',
  },
];

/** Whether `task` still needs a value for `fieldId` — the backfill queue's inclusion test. */
export function isFieldMissing(task: Task, fieldId: BackfillFieldId): boolean {
  switch (fieldId) {
    case 'estimate':
      return task.estimatedMinutes == null;
    case 'priority':
      return task.priority === 0;
    case 'category':
      return task.category == null;
  }
}

/**
 * Whether the user has told the backfill screen not to ask about `fieldId`
 * on this task again — "this one genuinely doesn't need a time estimate",
 * not "not right now" (that's the screen's own session-only `skippedIds`,
 * which never touches the task itself). See `Task.backfillDismissedFields`.
 */
export function isBackfillDismissed(task: Task, fieldId: BackfillFieldId): boolean {
  return task.backfillDismissedFields.includes(fieldId);
}

// Only live, top-level tasks are worth backfilling — a completed or archived
// row is history, not something to fill in, and a subtask's own estimate/
// priority/category rides on fields most lists don't even show it (see
// estimatedMinutesFor's chain-step note and the module-map entry for
// visibilityUtils on why subtasks are excluded from top-level task lists
// throughout the app).
export function backfillCandidates(tasks: Task[], fieldId: BackfillFieldId): Task[] {
  return tasks
    .filter(t =>
      !t.parentId && !t.completed && !t.archived &&
      isFieldMissing(t, fieldId) && !isBackfillDismissed(t, fieldId)
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** How many live tasks are missing each field, for the field-picker step's counts. */
export function backfillFieldCounts(tasks: Task[]): Record<BackfillFieldId, number> {
  const counts = { estimate: 0, priority: 0, category: 0 } as Record<BackfillFieldId, number>;
  for (const t of tasks) {
    if (t.parentId || t.completed || t.archived) continue;
    for (const field of BACKFILL_FIELDS) {
      if (isFieldMissing(t, field.id) && !isBackfillDismissed(t, field.id)) counts[field.id]++;
    }
  }
  return counts;
}

/**
 * The patch that records "leave this field unset" for `task` — appended to
 * whatever else is already dismissed, deduped, so dismissing twice (a
 * double-tap, or dismissing after an unrelated edit) is a no-op rather than
 * growing the array.
 */
export function dismissBackfillField(task: Task, fieldId: BackfillFieldId): Pick<Task, 'backfillDismissedFields'> {
  return {
    backfillDismissedFields: task.backfillDismissedFields.includes(fieldId)
      ? task.backfillDismissedFields
      : [...task.backfillDismissedFields, fieldId],
  };
}

/**
 * The `effort`/`estimatedMinutes` pair to write for a chosen effort bucket —
 * the same pairing `applyEffortPreset` in TaskEditor writes, so a task
 * backfilled here reads identically to one sized in the editor. Bucket 0
 * ("—") is deliberately not offered on the backfill screen: it maps to
 * `estimatedMinutes: null`, which would leave the task exactly as missing as
 * it started.
 */
export function estimatePatchFor(effort: Effort): Pick<Task, 'effort' | 'estimatedMinutes'> {
  return { effort, estimatedMinutes: EFFORT_MINUTES[effort] ?? null };
}
