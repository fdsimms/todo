import type { Task, TaskDraft } from '../types';
import {
  generatedTaskCountOf,
  generatorPausedForVacation,
  hasAnyGeneratedTask,
  liveGeneratedTask,
  liveUseUpTaskCount,
  type GeneratedKind,
} from '../utils/generatedTasks';
import { derivedId, spawnSeed } from '../utils/syncIds';
import { useSettingsStore } from './useSettingsStore';
import { useTaskStore } from './useTaskStore';

/**
 * The write half of the generated-task mechanism — the reconcile every
 * generator used to keep its own copy of.
 *
 * `src/utils/generatedTasks.ts` holds the pure half (the kinds, the registry,
 * the opt-out precedence, the "is there one already" lookups) and stays
 * testable without a store. This module is what actually creates, updates and
 * deletes rows, so it lives in `src/store/` next to the three stores that call
 * it — `useMealPlanStore`, `useGroceryStore` and `useLeftoverStore`, each of
 * which had a `reconcile*Task` / `drop*Task` pair that differed only in which
 * field it read and which settings it looked up.
 *
 * The shape all three had, and the one written here once:
 *
 * 1. Not wanted → delete the live task if there is one, quietly, and stop.
 * 2. Wanted, one exists → rewrite the source-owned fields, but only if they
 *    have actually drifted.
 * 3. Wanted, none exists → create it.
 *
 * The caller supplies the parts that are genuinely its own: whether the source
 * wants a task at all, which fields the source owns, and the draft to create.
 * Nothing about a meal, a grocery item or a leftover is known here.
 */

/**
 * Deleting a generated task without arming shake-to-undo.
 *
 * `deleteTask` records an undoable action, which is right when a person deletes
 * a task and wrong here: this delete is a consequence of a meal being moved or
 * a leftover being eaten, and there is no undo in the kitchen for it to belong
 * to. A delete the user didn't just perform, sitting under their next shake, is
 * the same failure the completed-task purge avoids by not going through
 * `bulkDeleteTasks`.
 *
 * It also means the opt-out block in `deleteTask` still runs, which is exactly
 * what's wanted — see the note on `reconcileGeneratedTask` below.
 */
export function deleteGeneratedTaskQuietly(
  taskId: string,
  opts: { skipOptOut?: boolean } = {}
): void {
  const store = useTaskStore.getState();
  store.deleteTask(taskId, { skipGeneratedOptOut: opts.skipOptOut });
  store.setLastAction(null);
}

export interface ReconcileGeneratedOptions {
  kind: GeneratedKind;
  /** The row this task is projected from; null for a generator with no source. */
  sourceId: string | null;
  /** The caller's answer to "should this source have a task", already decided. */
  wanted: boolean;
  /**
   * The fields the source owns, for an existing task that has drifted — or
   * null when nothing has changed, which is how a caller says "leave it alone".
   *
   * Passing null rather than writing unconditionally is worth the awkwardness:
   * a reconcile runs on every mutation of its source, several of which (a
   * recipe scale change, a re-sort within a slot, a rename the task doesn't
   * chase) change nothing the task shows. A no-op write would still hit SQLite,
   * still replace the object in the store, and still re-render every list
   * holding it.
   */
  drift: (existing: Task) => Partial<Task> | null;
  /** The full draft for a task that doesn't exist yet, back-pointer included. */
  draft: () => Partial<TaskDraft>;
  /**
   * Whether a *finished* task for this source blocks a new one.
   *
   * `true` for cook tasks and false for the rest, and the difference is the
   * generator's meaning rather than an inconsistency to iron out — see
   * `hasAnyGeneratedTask`. A meal is one event; a grocery item and a leftover
   * are rows that come round again.
   */
  blocksOnFinished?: boolean;
  /**
   * The shared ceiling grocery and leftover use-up tasks draw from (#1675) —
   * omitted by `mealCook` and `mealPlanNudge`, which have no flooding problem
   * of their own (see `isUseUpKind`). `null`/omitted is unlimited.
   *
   * A source declined a slot here isn't suppressed the way `wanted: false`
   * is — it still qualifies, and the next reconcile that finds room (the
   * source's own next mutation, or the leftover foreground sweep) creates it.
   * This deliberately never evicts an existing task to free a slot for a more
   * urgent one: once a task is showing, it stays showing, so the cap only
   * ever decides who claims a slot that's genuinely open. A caller that wants
   * its most urgent sources to win a scarce slot has to reconcile them in
   * urgency order itself (see `reconcileAllLeftoverTasks`, which already
   * iterates leftovers soonest-`keepUntil`-first).
   */
  useUpCap?: number | null;
}

/**
 * Bring this source's generated task into line with the source.
 *
 * **A delete here writes the source's opt-out**, because it goes through
 * `useTaskStore.deleteTask`, which stamps `false` on whatever the task was
 * generated from. That is right for a delete the *user* performs and wrong for
 * one a reconcile performs — so step 1 below is reached only when the source
 * has already said no (the setting is off, the date was cleared, the leftover
 * was eaten), and writing "no" onto a row that already means no is a no-op the
 * store's own equality guard drops. The one path that must not write it is a
 * source being deleted outright, which is why `dropGeneratedTask` exists
 * separately and why its callers run it *after* the source row is gone.
 */
export function reconcileGeneratedTask(options: ReconcileGeneratedOptions): void {
  const { kind, sourceId, wanted, drift, draft, blocksOnFinished = false, useUpCap = null } = options;
  const { tasks, addTask, updateTask } = useTaskStore.getState();
  const existing = liveGeneratedTask(tasks, kind, sourceId);

  if (!wanted) {
    // Only the live one goes. A completed generated task is a record of a thing
    // that was done, and the source changing its mind is not a claim it wasn't.
    if (existing) deleteGeneratedTaskQuietly(existing.id);
    return;
  }

  if (existing) {
    const updates = drift(existing);
    // skipPostponeCount: this row's date is the source's date, not a schedule
    // the user picked for the task — dragging Tuesday's dinner to Friday moves
    // this row with it, and a fresher bag moving a use-by date out is not the
    // user ducking anything. See utils/postpone.ts.
    if (updates) updateTask(existing.id, updates, { skipPostponeCount: true });
    return;
  }

  // Nothing new while vacation mode is on, for the kinds that answer yes to it
  // (see GeneratedKindSpec.pausedOnVacation). Deliberately here rather than at
  // the top: the two branches above still run, so an existing row still drifts
  // with its source and still goes when the source stops wanting it. Only
  // *creating* stops, which is what "don't invent work while I'm away" means —
  // gating the whole function would instead freeze rows the source has already
  // finished with, and gating `wanted` would delete a row on the way into
  // vacation and write it again on the way out.
  //
  // The pass-level guards in useTaskStore are not made redundant by this: they
  // also stop a pass recording the period key for a day it declined, which is
  // what lets the trigger fire for real once vacation ends.
  if (generatorPausedForVacation(kind, useSettingsStore.getState().vacationMode)) return;
  if (blocksOnFinished && hasAnyGeneratedTask(tasks, kind, sourceId)) return;
  if (useUpCap !== null && liveUseUpTaskCount(tasks) >= useUpCap) return;
  // Derived rather than random for a sourced generator (#1751): two devices
  // that each reconcile the same source before ever syncing must land on the
  // same id, or the ordinary merge keeps both as separate rows instead of
  // collapsing them into one. An unsourced generator (none exist yet) has
  // nothing to derive from, so it falls back to addTask's own random id.
  const id = sourceId !== null
    ? derivedId(spawnSeed.generated(kind, sourceId, generatedTaskCountOf(tasks, kind, sourceId)))
    : undefined;
  // skipCategoryDefault: this draft's category is the source's own dedicated
  // setting, already resolved and possibly deliberately null — not an
  // unanswered field that should fall back to the unrelated
  // newTaskDefaults.category the way a fresh editor draft's null would (#1724).
  //
  // skipTitleRules, for the same reason one step further: "Use up spinach" is
  // a title the app wrote, so a rule matching a word in it would be filing a
  // task against a phrase nobody typed — and each generator already has its
  // own "File them under" setting saying where its tasks go.
  addTask(draft(), id, { skipCategoryDefault: true, skipTitleRules: true });
}

/**
 * Drop this source's live generated task, without deciding anything.
 *
 * Separate from `reconcileGeneratedTask` because the callers are answering a
 * different question: the source is *gone* (a meal removed, a grocery item
 * deleted, a leftover eaten), so there is nothing to reconcile against and a
 * live "Use up spinach" pointing at a row the user has just forgotten is a
 * chore about nothing.
 *
 * **It writes no opt-out, which is what "without deciding anything" means.**
 * For the original callers that was true by accident rather than by
 * construction — they run after the source row is gone, so the write landed on
 * a row that no longer existed and did nothing. `projectReview` is the first
 * caller whose source outlives its task (a project stops being quiet, the task
 * goes, the project stays), and there the accident stops holding: the write
 * would stamp the project as declined for the day on the strength of the app's
 * own tidying up, and suppress tomorrow's offer. Only a delete the *user*
 * performs is an instruction to the source.
 */
export function dropGeneratedTask(kind: GeneratedKind, sourceId: string | null): void {
  const existing = liveGeneratedTask(useTaskStore.getState().tasks, kind, sourceId);
  if (existing) deleteGeneratedTaskQuietly(existing.id, { skipOptOut: true });
}
