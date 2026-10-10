import type { Task, Effort, Category } from '../types';
import { EFFORT_MINUTES } from './effort';
import { activeChainStep } from './chain';
import { featureHidden, type SimpleFeatureId } from './simpleMode';

/** A field this screen can walk the task list and fill in, one task at a time. */
export type BackfillFieldId = 'estimate' | 'priority' | 'difficulty' | 'category' | 'streak' | 'vacation' | 'holidays' | 'reminder' | 'suggestions';

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
    hint: 'How long each task takes, so a day’s list can be sized realistically.',
  },
  {
    id: 'priority',
    label: 'Priority',
    hint: 'How each task ranks against everything else on Today.',
  },
  {
    id: 'difficulty',
    label: 'Difficulty',
    hint: 'How hard each task is to make yourself do, apart from how long it takes. Sets how many coins it earns.',
  },
  {
    id: 'category',
    label: 'Category',
    hint: 'Which category each task falls under.',
  },
  {
    id: 'streak',
    label: 'Streak chip',
    hint: 'Whether a repeating task’s streak count also shows as a chip on its row.',
  },
  {
    id: 'vacation',
    label: 'Vacation pause',
    hint: 'Whether a repeating task hides while vacation mode is on. Its streak is kept.',
  },
  {
    id: 'holidays',
    label: 'On a holiday',
    hint: 'What a repeating task does when it lands on a holiday: skip that day, or move to the next one.',
  },
  {
    id: 'reminder',
    label: 'Reminder',
    hint: 'Whether a task with a due date sends a notification before it’s due.',
  },
  {
    id: 'suggestions',
    label: 'Skip in suggestions',
    hint: 'Keeps this task out of suggested pins and focus sessions.',
  },
];

/**
 * The simplified-mode capability a field configures, for the three that
 * configure one.
 *
 * Written as a map for the reason `featureHidden` takes an id rather than
 * being a bare `if (simpleMode)`: "what does simplified mode do to effort" has
 * to be one search, and this screen was the one place the answer was "nothing"
 * while `TaskEditor` and `QuickAddModal` both gated on it.
 *
 * The other four fields configure nothing the mode touches. `category`,
 * `priority` and `reminder` are the ordinary form the mode never takes away,
 * and `suggestions` is about suggested pins and focus sessions, which have
 * their own ids the mode reaches through their own surfaces.
 */
const FIELD_SIMPLE_FEATURE: Partial<Record<BackfillFieldId, SimpleFeatureId>> = {
  estimate: 'effortRating',
  streak: 'streakOptions',
  vacation: 'vacationPause',
};

/**
 * The fields worth offering, given whether simplified mode is on.
 *
 * Hidden outright rather than through `featureShown`'s "a feature already in
 * use is never taken away" escape hatch, and that is not an oversight: every
 * one of these three queues on a task *not* using the feature (`estimate` on a
 * null estimate, `streak` on `!showStreak`, `vacation` on `!vacationPause`), so
 * rule 2 is vacuously false for every candidate the field could ever hold.
 * A row kept for it would be a row promising work that does not exist.
 *
 * Only the rows go. Nothing already set is touched, and turning the mode back
 * off brings the field back with its queue exactly as it was — the same call
 * `aiFeaturesFor` makes for the AI switches.
 */
export function backfillFieldsFor(
  simpleMode: boolean,
  rewardsEnabled = false,
  holidaysConfigured = true,
): BackfillFieldDef[] {
  return BACKFILL_FIELDS.filter(f => {
    // With no holidays set up in Settings the rule has nothing to act on, so the
    // card would ask a question whose answer changes nothing (the repeat picker
    // says the same under its own "On a holiday" group).
    if (f.id === 'holidays' && !holidaysConfigured) return false;
    // Only the coin rules read a difficulty, so with rewards off this field
    // asks a question whose answer changes nothing: the editor hides its row
    // on the same terms.
    if (f.id === 'difficulty' && !rewardsEnabled) return false;
    const feature = FIELD_SIMPLE_FEATURE[f.id];
    return !feature || !featureHidden(feature, simpleMode);
  });
}

export interface BackfillCandidatesOptions {
  /**
   * Redo-from-scratch mode: include every live task for the field, not just
   * ones missing a value or previously dismissed. A task's value is only
   * ever touched when the user actually sets a new one for it in the
   * screen's review loop, so turning this on doesn't clear anything by
   * itself — it just widens which tasks get walked.
   */
  fromScratch?: boolean;
  /**
   * Live categories, needed only by the `vacation` field — see
   * `isFieldMissing`'s `vacation` case for why. Omit for any other field.
   */
  categories?: Category[];
}

/**
 * Whether `task` still needs a value for `fieldId` — the backfill queue's
 * inclusion test. Also doubles as "is this task even worth asking about" for
 * `estimate`: a task the wizard has no honest way to size (see the
 * `groceryUseUp`/`leftoverUseUp` case below) reads as not-missing rather than
 * as a question with no good answer.
 */
export function isFieldMissing(task: Task, fieldId: BackfillFieldId, categories?: Category[]): boolean {
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
      // a recipe-backed "Make X" step gets one from the recipe (see
      // mealSlotChain), and a meal-slot "Choose"/"Eat" step gets one from
      // mealSlotStepEstimates once the user has sized that step-type once.
      // Reading task.estimatedMinutes alone would flag both as missing
      // even though the app already knows the answer. Goes through
      // activeChainStep() rather than indexing chainItems[chainIndex]
      // directly, since a chain whose steps were edited down can leave
      // chainIndex out of range — the raw index would then read undefined
      // and wrongly flag the task as missing an estimate the active step
      // (found via the modulo activeChainStep applies) already has.
      // An avoid-habit is never completed, so there is no time to size. The same
      // reasoning keeps `difficulty` from asking about one.
      if (task.polarity === 'negative') return false;
      return (activeChainStep(task)?.estimatedMinutes ?? task.estimatedMinutes) == null;
    case 'priority':
      return task.priority === 0;
    case 'difficulty':
      // Null is "never rated"; an explicit 'normal' is an answer. An
      // avoid-habit earns nothing, so its rating would change nothing (and
      // the editor doesn't offer one).
      return task.difficulty == null && task.polarity !== 'negative';
    case 'category':
      return task.category == null;
    case 'streak':
      return task.recurrenceType !== 'none' && !task.showStreak;
    case 'vacation':
      if (task.recurrenceType === 'none' || task.vacationPause) return false;
      // A task in a category that's already set to hide on vacation is
      // already covered — isHiddenForVacation (visibilityUtils) treats the
      // two as equivalent, so pausing it individually too would be asking
      // for a value that changes nothing.
      if (task.category && categories?.some(c => c.name === task.category && c.hideOnVacation)) return false;
      return true;
    case 'holidays':
      // Null is "As usual", which is also what an unanswered task reads as, so
      // a person who wants it left that way says so with the dismissal.
      return repeatsOnDates(task) && task.recurrenceHolidays == null;
    case 'reminder':
      // A reminder is an absolute instant, and the only instant this wizard
      // has to offer one against is the task's own due date — a task with no
      // dueDate has nothing to schedule the notification relative to (the
      // same reason WhenPicker's "before due date" mode is gated on one).
      return task.dueDate != null && task.reminderTime == null;
    case 'suggestions':
      if (task.excludeFromSuggestions) return false;
      // Same gate the 'vacation' case above uses: a task in a category
      // already flagged excludeFromSuggestions is already out of the
      // suggesters (pinSuggest/focusSuggest check both flags), so asking to
      // set this one too would be asking for a value that changes nothing.
      if (task.category && categories?.some(c => c.name === task.category && c.excludeFromSuggestions)) return false;
      return true;
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

/**
 * Whether the task repeats on dates a holiday can land on. `hours` is left out
 * for the reason the repeat picker leaves its holiday group out: a task every N
 * hours has no day to skip.
 */
function repeatsOnDates(task: Task): boolean {
  return task.recurrenceType !== 'none' && task.recurrenceType !== 'hours';
}

/**
 * Whether the field is a question for this task at all, set or not. It is what
 * a redo walks, so a one-off is never offered a holiday rule. Only `holidays`
 * has a gate that is about the task rather than the value.
 */
function fieldApplies(task: Task, fieldId: BackfillFieldId): boolean {
  return fieldId !== 'holidays' || repeatsOnDates(task);
}

/**
 * The fields a task given several dates is asked about **per date**, not once.
 * A reminder is an absolute instant measured against its own row's due date, so
 * the 10th's answer is not the 15th's.
 */
const PER_DATE_FIELDS: readonly BackfillFieldId[] = ['reminder'];

// Only live, top-level tasks are worth backfilling — a completed or archived
// row is history, not something to fill in, and a subtask's own estimate/
// priority/category rides on fields most lists don't even show it (see
// estimatedMinutesFor's chain-step note and the module-map entry for
// visibilityUtils on why subtasks are excluded from top-level task lists
// throughout the app).
function isQueued(task: Task, fieldId: BackfillFieldId, opts: BackfillCandidatesOptions): boolean {
  if (task.parentId || task.completed || task.archived) return false;
  return opts.fromScratch
    ? fieldApplies(task, fieldId)
    : isFieldMissing(task, fieldId, opts.categories) && !isBackfillDismissed(task, fieldId);
}

/** Earliest due date first, rows with no date last, then by id so the pick is stable. */
function bySeriesOrder(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Keeps one row per series, the earliest. A task given several dates is N real
 * rows sharing a `seriesId` (see Series in CLAUDE.md), but it is one task to the
 * person answering, so it gets one card and `backfillSeriesPeers` carries the
 * answer to the rest. Without this a three-date series was asked about three
 * times for every field.
 */
function onePerSeries(rows: Task[], fieldId: BackfillFieldId): Task[] {
  if (PER_DATE_FIELDS.includes(fieldId)) return rows;
  const first = new Map<string, Task>();
  for (const t of rows) {
    if (!t.seriesId) continue;
    const seen = first.get(t.seriesId);
    if (!seen || bySeriesOrder(t, seen) < 0) first.set(t.seriesId, t);
  }
  return rows.filter(t => !t.seriesId || first.get(t.seriesId) === t);
}

function queuedRows(tasks: Task[], fieldId: BackfillFieldId, opts: BackfillCandidatesOptions): Task[] {
  return onePerSeries(tasks.filter(t => isQueued(t, fieldId, opts)), fieldId);
}

export function backfillCandidates(
  tasks: Task[],
  fieldId: BackfillFieldId,
  opts: BackfillCandidatesOptions = {}
): Task[] {
  return queuedRows(tasks, fieldId, opts).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The other dates of `task`'s series that an answer to this card should reach:
 * the rows the field would have queued separately had the series not been
 * collapsed. A date that already has its own answer (or was told never to be
 * asked) is left as the person set it, the same rule a batch follows for the
 * cards that are not in its queue.
 */
export function backfillSeriesPeers(
  task: Task,
  tasks: Task[],
  fieldId: BackfillFieldId,
  opts: BackfillCandidatesOptions = {}
): Task[] {
  if (!task.seriesId || PER_DATE_FIELDS.includes(fieldId)) return [];
  return tasks.filter(t =>
    t.id !== task.id && t.seriesId === task.seriesId && isQueued(t, fieldId, opts)
  );
}

/** How many live tasks are missing each field, for the field-picker step's counts. */
export function backfillFieldCounts(tasks: Task[], categories: Category[] = []): Record<BackfillFieldId, number> {
  const counts = {} as Record<BackfillFieldId, number>;
  for (const field of BACKFILL_FIELDS) {
    counts[field.id] = queuedRows(tasks, field.id, { categories }).length;
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
 * The effort buckets this screen offers for `estimate`, in the order they
 * render. Bucket 0 ("—") is left off for the reason `estimatePatchFor`
 * gives below.
 *
 * Exported rather than kept local to the screen because the AI suggestion for
 * this field picks from exactly this set (see `backfillSuggest.ts`) — a
 * suggested value is one of the pills already on the card, highlighted, rather
 * than a number from somewhere else. Two copies of the list would be two places
 * for that to stop being true.
 */
export const ESTIMATE_EFFORTS: readonly Effort[] = [1, 2, 3, 4, 5, 6];

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
