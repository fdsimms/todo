import type { Task, Effort } from '../types';
import { EFFORT_MINUTES } from './effort';

/** A field this screen can walk the task list and fill in, one task at a time. */
export type BackfillFieldId = 'estimate' | 'priority' | 'category' | 'streak' | 'vacation';

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
  {
    id: 'streak',
    label: 'Streak chip',
    hint: 'Whether a recurring task’s streak count also shows as a chip on the row, not just in its editor.',
  },
  {
    id: 'vacation',
    label: 'Vacation pause',
    hint: 'Whether a recurring task hides (and keeps its streak safe) while vacation mode is on.',
  },
];

export interface BackfillCandidatesOptions {
  /**
   * Redo-from-scratch mode: include every live task for the field, not just
   * ones missing a value or previously dismissed. A task's value is only
   * ever touched when the user actually sets a new one for it in the
   * screen's review loop, so turning this on doesn't clear anything by
   * itself — it just widens which tasks get walked.
   */
  fromScratch?: boolean;
}

/**
 * Whether `task` still needs a value for `fieldId` — the backfill queue's
 * inclusion test. Also doubles as "is this task even worth asking about" for
 * `estimate`: a task the wizard has no honest way to size (see the
 * `groceryUseUp`/`leftoverUseUp` case below) reads as not-missing rather than
 * as a question with no good answer.
 */
export function isFieldMissing(task: Task, fieldId: BackfillFieldId): boolean {
  switch (fieldId) {
    case 'estimate':
      // "Use up X" tasks (grocery expiry, leftovers) don't share a step-type
      // the way meal-slot chain steps do — every one names a different food
      // with its own prep time, so there's nothing sensible to remember a
      // duration against, and no recipe to read one from either. Asking
      // per-item forever would be exactly the flood the meal-slot fix was
      // for, so these are excluded outright rather than asked at all.
      if (task.generatedKind === 'groceryUseUp' || task.generatedKind === 'leftoverUseUp') return false;
      // The step currently showing may already carry its own duration —
      // a recipe-backed "Cook X" step gets one from the recipe (see
      // mealSlotChain), and a meal-slot "Choose"/"Eat" step gets one from
      // mealSlotStepEstimates once the user has sized that step-type once.
      // Reading task.estimatedMinutes alone would flag both as missing
      // even though the app already knows the answer.
      return (task.chainItems[task.chainIndex]?.estimatedMinutes ?? task.estimatedMinutes) == null;
    case 'priority':
      return task.priority === 0;
    case 'category':
      return task.category == null;
    case 'streak':
      return task.recurrenceType !== 'none' && !task.showStreak;
    case 'vacation':
      return task.recurrenceType !== 'none' && !task.vacationPause;
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
export function backfillCandidates(
  tasks: Task[],
  fieldId: BackfillFieldId,
  opts: BackfillCandidatesOptions = {}
): Task[] {
  return tasks
    .filter(t =>
      !t.parentId && !t.completed && !t.archived &&
      (opts.fromScratch || (isFieldMissing(t, fieldId) && !isBackfillDismissed(t, fieldId)))
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** How many live tasks are missing each field, for the field-picker step's counts. */
export function backfillFieldCounts(tasks: Task[]): Record<BackfillFieldId, number> {
  const counts = { estimate: 0, priority: 0, category: 0, streak: 0, vacation: 0 } as Record<BackfillFieldId, number>;
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
