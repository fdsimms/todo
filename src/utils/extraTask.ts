import type { Effort, ExtraTaskDraft, Priority, Task, TimeOfDay } from '../types';
import { ordinal } from './ordinal';
import { EFFORT_LABELS, PRIORITY_LABELS } from '../types';

/**
 * "Extra task" — every Nth completion of a task adds a separate one-off task.
 *
 * See the field notes on `Task.extraTaskEveryN`. This module owns the rule
 * (when does it fire, what does the added task get called) and its wording, so
 * the editor's caption, the row's value and the store all say the same thing
 * about the same numbers.
 *
 * Pure and parameterised like the other utils here — the store passes the task
 * in rather than this reaching for it.
 */

/**
 * Floor of 2. "Every 1st completion" is every completion, which is a chain
 * with one step, not this — and offering it invites the reading that 1 means
 * "off" when null already does.
 */
export const MIN_EXTRA_TASK_EVERY_N = 2;
/** Same ceiling `CountStepper` gets everywhere else a small integer is picked. */
export const MAX_EXTRA_TASK_EVERY_N = 99;

export interface ExtraTaskRule {
  everyN: number;
  title: string;
  /** What else the added task looks like, or null for "just the title". */
  draft: ExtraTaskDraft | null;
}

/**
 * The rule this task actually has, or null.
 *
 * Both halves are required: a count with no title would add a task with no
 * name, which is a row nobody can act on. Asking here rather than testing the
 * two fields at each call site is what keeps the editor, the store and the
 * caption agreeing on when the rule is live.
 */
export function extraTaskRule(
  task: Pick<Task, 'extraTaskEveryN' | 'extraTaskTitle'> & Partial<Pick<Task, 'extraTaskDraft'>>
): ExtraTaskRule | null {
  const everyN = task.extraTaskEveryN;
  const title = task.extraTaskTitle?.trim();
  if (everyN === null || everyN < MIN_EXTRA_TASK_EVERY_N) return null;
  if (!title) return null;
  return { everyN, title, draft: task.extraTaskDraft ?? null };
}

/**
 * The tally after this completion, and whether it fires.
 *
 * Resets to 0 on the completion that fires rather than counting up forever and
 * testing a modulo: the stored number then reads as "completions since the
 * last extra task", which is what the caption promises and what survives the
 * user changing N. A modulo against a lifetime count would silently move the
 * next one when N changed.
 *
 * A tally already at or past N fires too (`>=`, not `===`) — lowering N on a
 * task that has been running should take effect on the next completion rather
 * than waiting for the count to wrap all the way round again.
 */
export function advanceExtraTaskTally(tally: number, everyN: number): { tally: number; spawns: boolean } {
  const next = Math.max(0, tally) + 1;
  return next >= everyN ? { tally: 0, spawns: true } : { tally: next, spawns: false };
}

/**
 * How many completions are left before the next one, for the editor's caption.
 * Clamped at 1 — a tally that has somehow outrun N still means "the next one".
 */
export function completionsUntilExtraTask(tally: number, everyN: number): number {
  return Math.max(1, everyN - Math.max(0, tally));
}

/** The editor row's value, and the only place the count is shown on its own. */
export function extraTaskSummary(everyN: number | null): string | undefined {
  if (everyN === null || everyN < MIN_EXTRA_TASK_EVERY_N) return undefined;
  return `Every ${ordinal(everyN)}`;
}

/**
 * The caption under the stepper — the one thing the controls don't already say.
 *
 * Where the added task lands, and nothing else. It used to read the whole rule
 * back ("Adds “X” every 4th completion, due with the next one"), which
 * quoted the title out of the field directly above it and repeated the count
 * out of the stepper beside it, and took two lines at 390pt to do it. The
 * editor now spells the frequency out around the stepper itself ("Every [4th]
 * completion"), so all that's left for a caption is the half nobody can infer:
 * it's due with the *next* occurrence, not stacked onto the completion that
 * triggered it. A task that doesn't repeat has no next occurrence, so it lands
 * on the day it's added.
 */
export function describeExtraTaskRule(
  everyN: number | null,
  title: string | null,
  repeats: boolean
): string {
  if (everyN === null || everyN < MIN_EXTRA_TASK_EVERY_N) return 'No extra task';
  if (!title?.trim()) return 'Name the task to add';
  return repeats ? 'Due with the next occurrence' : "Due on the day it's added";
}

/**
 * The draft a newly-opened sheet starts from — every field at "say nothing".
 *
 * Null category and project are the load-bearing pair: they mean "the same as
 * the task that spawns this", so saving a draft that only sets, say, a note
 * still files the added task exactly where it was filed before.
 */
export function emptyExtraTaskDraft(): ExtraTaskDraft {
  return {
    notes: '',
    category: null,
    projectId: null,
    tags: [],
    priority: 0,
    effort: 0,
    estimatedMinutes: null,
    timeSegments: [],
    subtasks: [],
  };
}

/**
 * Read a stored draft back off its JSON column, field by field.
 *
 * Defaults every field the same way `parseChainItems` does rather than
 * trusting the blob, so a draft written by an older build — or by a restored
 * backup — comes back complete instead of half-undefined. A blob that isn't
 * an object at all is no draft, which reads as "just the title" and is the
 * behaviour every rule had before drafts existed.
 */
export function parseExtraTaskDraft(raw: string | null | undefined): ExtraTaskDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const d = parsed as Partial<ExtraTaskDraft>;
  const base = emptyExtraTaskDraft();
  return {
    notes: typeof d.notes === 'string' ? d.notes : base.notes,
    category: typeof d.category === 'string' ? d.category : null,
    projectId: typeof d.projectId === 'string' ? d.projectId : null,
    tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
    priority: isPriority(d.priority) ? d.priority : base.priority,
    effort: isEffort(d.effort) ? d.effort : base.effort,
    estimatedMinutes: typeof d.estimatedMinutes === 'number' ? d.estimatedMinutes : null,
    timeSegments: Array.isArray(d.timeSegments)
      ? d.timeSegments.filter((t): t is TimeOfDay => TIME_SEGMENTS.includes(t as TimeOfDay))
      : [],
    subtasks: Array.isArray(d.subtasks)
      ? d.subtasks
          .filter((sub): sub is { id: string; title: string } =>
            !!sub && typeof sub === 'object'
            && typeof (sub as { id?: unknown }).id === 'string'
            && typeof (sub as { title?: unknown }).title === 'string')
          .map(sub => ({ id: sub.id, title: sub.title }))
      : [],
  };
}

const TIME_SEGMENTS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

function isPriority(v: unknown): v is Priority {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

function isEffort(v: unknown): v is Effort {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
}

/**
 * Whether a draft says anything at all beyond the title.
 *
 * What decides whether one is *stored*: an untouched draft is written back as
 * null so the row keeps reading as "just the title", rather than as a rule
 * carrying a blob of defaults that would then have to be told apart from a
 * real answer.
 */
export function extraTaskDraftIsEmpty(draft: ExtraTaskDraft | null): boolean {
  if (!draft) return true;
  return draft.notes.trim() === ''
    && draft.category === null
    && draft.projectId === null
    && draft.tags.length === 0
    && draft.priority === 0
    && draft.effort === 0
    && draft.estimatedMinutes === null
    && draft.timeSegments.length === 0
    && draft.subtasks.length === 0;
}

/** How many things past the title a draft names, for the count fallback below. */
const DRAFT_NAME_LIMIT = 2;

/**
 * The Details row's value — what the added task will look like, in one line.
 *
 * Names up to two of them and then falls back to a count, the same call
 * `describeSubstitutes` makes and for the same reason: the row renders
 * `numberOfLines={1}`, so a third name truncates mid-word at 390pt.
 *
 * Category and project arrive already resolved to their display names — this
 * module is pure and holds no store, and the emoji on a category label lives
 * on the category row rather than on the id the draft stores.
 */
export function describeExtraTaskDraft(
  draft: ExtraTaskDraft | null,
  categoryName: string | null,
  projectName: string | null,
): string | undefined {
  if (!draft || extraTaskDraftIsEmpty(draft)) return undefined;
  const parts: string[] = [];
  if (draft.category && categoryName) parts.push(categoryName);
  if (draft.projectId && projectName) parts.push(projectName);
  if (draft.priority > 0) parts.push(PRIORITY_LABELS[draft.priority]);
  if (draft.estimatedMinutes !== null) parts.push(`${draft.estimatedMinutes} min`);
  else if (draft.effort > 0) parts.push(EFFORT_LABELS[draft.effort]);
  if (draft.tags.length > 0) parts.push(draft.tags.length === 1 ? '1 tag' : `${draft.tags.length} tags`);
  if (draft.subtasks.length > 0) {
    parts.push(draft.subtasks.length === 1 ? '1 subtask' : `${draft.subtasks.length} subtasks`);
  }
  if (draft.timeSegments.length > 0) parts.push(capitalize(draft.timeSegments[0]));
  if (draft.notes.trim()) parts.push('Notes');
  if (parts.length === 0) return undefined;
  if (parts.length <= DRAFT_NAME_LIMIT) return parts.join(' · ');
  return `${parts.length} details`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
