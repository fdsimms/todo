/**
 * Multi-level undo/redo, shared by the four stores that keep a history
 * (tasks, groceries, meal plan, leftovers).
 *
 * **Four stacks, one history.** Each store owns its own `undoStack` /
 * `redoStack` rather than there being a single shared one, which is the shape
 * that was already there for the single-slot `lastAction` it replaces — a
 * store can't reach into another store's state without a cycle, and three of
 * these four already import each other one way. What makes them read as one
 * ordered history is `freshest()`: every entry is stamped with when it landed
 * on the stack it's sitting on, so popping the freshest across all four
 * replays the user's actual sequence, whichever store each step came from.
 * That's why the stamp is *landed-on-this-stack* rather than when the action
 * originally happened — an entry moved from one stack to the other by an undo
 * or a redo is re-stamped, so the next step across all four still resolves in
 * the right order. Read `at` as "when this became the top of its stack".
 *
 * **`lastAction` is the top of the undo stack, not a separate field.** Every
 * store keeps mirroring it because the whole app reads it: the two consumers
 * (`useShakeToUndo`, `UndoBar`), the batch actions inside the stores that
 * capture a child action's undo (`bulkDeleteGroups`, `clearLogbook`, and the
 * rest), and `TitleRulesSheet`, which compares it by identity to decide
 * whether its own Undo affordance is still the one on offer.
 *
 * **Registration is suppressed while replaying, and the flag is global.** An
 * undo closure is free to reach a public store action to do its work
 * (`undo: () => get().updateTask(id, before)`), and those actions register
 * undo entries of their own — so without this, undoing would push a fresh
 * entry describing the undo itself and the stack would never drain. It has to
 * be module-global rather than per-store because the closures cross stores:
 * completing a task can un-cook a meal, so undoing it reaches
 * `useMealPlanStore`. Single-level undo had the same problem and solved it by
 * clearing `lastAction` after running the closure, which a stack can't do.
 */

export interface UndoableAction {
  label: string;
  undo: () => void;
  /**
   * Re-performs the action, for the redo half. Optional, and the actions that
   * carry one are the ones worth offering back: the destructive set the
   * UndoBar already singles out, plus completions and reschedules. For most
   * of them it is a one-liner calling the same store action again — every
   * undo in this app restores rows under their original ids, so the forward
   * action still finds what it needs.
   *
   * An entry without one is honest rather than broken: undoing it clears the
   * redo stack, because there is no way back across that step and offering to
   * redo what sits under it would replay history out of order.
   */
  redo?: () => void;
  /**
   * When this entry landed on the stack it is currently on. Stamped centrally
   * by the store — call sites never pass it. See the note above on why an
   * entry is re-stamped as it moves between the two stacks.
   */
  at?: number;
  /**
   * Marks an action irreversible-feeling enough to warrant the transient
   * UndoBar (src/components/UndoBar.tsx), not just the shake gesture — a
   * delete or a clear, not an add or a reschedule. See UndoBar's own doc
   * comment for the full rule; this flag is the only thing it reads.
   */
  destructive?: boolean;
}

/** The two stacks, as every store that has a history holds them. */
export interface UndoHistory {
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];
}

/**
 * How many steps back each store keeps. Deep enough to cover a run of edits
 * someone wants to walk back one at a time, shallow enough that the closures
 * (which capture whole row snapshots) can't grow without bound over a long
 * session. Per store rather than across all four, so a burst of grocery
 * checks can't push a task delete out of reach.
 */
export const UNDO_STACK_LIMIT = 25;

/** The entry an undo would run next, or null when there's nothing to undo. */
export function topOf(stack: UndoableAction[]): UndoableAction | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Pushes an entry, stamped with `now`, dropping the oldest once the stack is
 * at its limit.
 */
export function pushEntry(
  stack: UndoableAction[],
  action: UndoableAction,
  now: number
): UndoableAction[] {
  const next = [...stack, { ...action, at: now }];
  return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
}

/** Drops the top entry. Safe on an empty stack. */
export function popEntry(stack: UndoableAction[]): UndoableAction[] {
  return stack.slice(0, -1);
}

/**
 * Picks whichever candidate carries the newest `at`, which is how four
 * independent stacks resolve into one ordered history. Null when nothing
 * qualifies. `at` of an entry that was somehow never stamped sorts oldest.
 */
export function freshest<T>(candidates: T[], at: (c: T) => number | undefined): T | null {
  return candidates.reduce<T | null>((best, c) => {
    if (at(c) === undefined) return best;
    if (best === null || (at(c) ?? 0) > (at(best) ?? 0)) return c;
    return best;
  }, null);
}

/**
 * Whether a redo entry is still the next step forward, given the top undo
 * entry of every store.
 *
 * Performing a new action discards the redo branch, the way it does in any
 * undo history. Within one store that falls out of the push itself, which
 * clears that store's redo stack. Across stores it can't: deleting a task
 * knows nothing about a grocery clear waiting to be redone. Rather than
 * broadcasting a clear to the other three on every action, the stamps answer
 * it directly — a redo is still current exactly while nothing has been done
 * since it was undone.
 */
export function redoIsCurrent(
  redo: UndoableAction | null,
  topUndos: (UndoableAction | null)[]
): boolean {
  if (!redo) return false;
  const redoAt = redo.at ?? 0;
  return topUndos.every(u => (u?.at ?? 0) <= redoAt);
}

/** The four actions every store with a history exposes. */
export interface UndoHistoryActions {
  /**
   * `replacing` is for an action built out of other actions — `bulkDeleteGroups`
   * calling `deleteGroup` per id, then filing one entry for the batch. Pass the
   * undo stack as it was before the children ran (`get().undoStack`, read at the
   * top of the action) and this entry lands in place of everything they
   * registered, rather than on top of it.
   *
   * It has to be said out loud now that there's a stack: with the single slot
   * this replaces, each child overwrote the last and the parent overwrote them
   * all, so one entry per batch fell out for free. Left alone, undoing the
   * batch would strand its children underneath it, each still offering to undo
   * what the batch already put back.
   */
  setLastAction: (action: UndoableAction | null, opts?: { replacing?: UndoableAction[] }) => void;
  undoLastAction: () => void;
  redoLastUndone: () => void;
  clearUndoHistory: () => void;
}

/** What a store must already hold for `undoHistoryActions` to drive it. */
export interface UndoHistoryState extends UndoHistory {
  lastAction: UndoableAction | null;
}

/**
 * Builds the four actions from a store's own `set`/`get`, so the stack rules
 * live here once rather than in four hand-copied blocks that drift.
 *
 * Two of the rules are worth stating outright, because they're the ones that
 * differ from the single slot this replaces:
 *
 * - **`setLastAction(null)` clears the whole history, not just the top.** It
 *   is how a store says "there is nothing safe to undo here" (see
 *   `useMealPlanStore.deleteEntriesForRecipe`), and that verdict covers what
 *   sits under it too: undoing the step below while this one stands would
 *   replay history out of order.
 * - **Registering an action discards the redo branch**, as in any undo
 *   history. That covers this store; `redoIsCurrent` covers the other three.
 */
export function undoHistoryActions<S extends UndoHistoryState>(
  set: (partial: Partial<S>) => void,
  get: () => S
): UndoHistoryActions {
  const commit = (undoStack: UndoableAction[], redoStack: UndoableAction[]) => {
    set({ lastAction: topOf(undoStack), undoStack, redoStack } as Partial<S>);
  };

  return {
    setLastAction(action, opts) {
      if (isReplaying()) return;
      if (!action) {
        commit([], []);
        return;
      }
      // A redo is the one write that registers without discarding the redo
      // branch: it is walking forward through that branch, not starting a new
      // one, so the steps above it stay redoable.
      const redoStack = isRedoing() ? get().redoStack : [];
      commit(pushEntry(opts?.replacing ?? get().undoStack, action, Date.now()), redoStack);
    },

    undoLastAction() {
      const entry = topOf(get().undoStack);
      if (!entry) return;
      try {
        withReplay(() => entry.undo());
      } catch (e) {
        console.error('undoLastAction failed', e);
      }
      // Read the stacks back rather than closing over them: the closure ran
      // arbitrary store code in between, and a store that cleared its own
      // history in the process meant it.
      const undoStack = popEntry(get().undoStack);
      commit(undoStack, entry.redo ? pushEntry(get().redoStack, entry, Date.now()) : []);
    },

    /**
     * **The entry that lands back on the undo stack is the one the redo just
     * registered, not the one we were holding.** A redo re-performs the
     * action, and some actions build new rows to do it: redoing the completion
     * of a recurring task spawns a fresh successor with a fresh id. The
     * closure we had captured the *previous* successor, so putting it back
     * would restore a row that no longer exists and orphan the one that does.
     * The forward action registers an accurate closure on its way through, so
     * that is the one to keep — carrying over the label, `destructive` and
     * `redo` of the entry the user actually asked to redo, since the action
     * may describe itself differently (`clearLogbook` files its own delete as
     * "N tasks deleted").
     *
     * Only one entry survives, however many the action registered: taking the
     * top and rebuilding from the stack as it was collapses a nested
     * registration (`clearLogbook` → `bulkDeleteTasks`) back into the single
     * step the user sees, which is what the forward path does by hand anyway.
     */
    redoLastUndone() {
      const entry = topOf(get().redoStack);
      if (!entry?.redo) return;
      const redo = entry.redo;
      const before = get().undoStack;
      const previousTop = topOf(before);
      try {
        withRedo(() => redo());
      } catch (e) {
        console.error('redoLastUndone failed', e);
      }
      const registered = topOf(get().undoStack);
      const restored = registered && registered !== previousTop
        ? { ...registered, label: entry.label, destructive: entry.destructive, redo: entry.redo }
        : entry;
      commit(pushEntry(before, restored, Date.now()), popEntry(get().redoStack));
    },

    clearUndoHistory() {
      commit([], []);
    },
  };
}

let undoDepth = 0;
let redoDepth = 0;

/**
 * True while an *undo* closure is running, which is when registration is
 * suppressed. A redo deliberately does not count: it re-performs the action,
 * and the closure the action registers on its way through is the accurate one
 * to keep (see `redoLastUndone`).
 */
export function isReplaying(): boolean {
  return undoDepth > 0;
}

/** True while a redo closure is running. */
export function isRedoing(): boolean {
  return redoDepth > 0;
}

/**
 * Runs an undo closure with registration suppressed. Nested because a closure
 * may cascade into another store's undo path; the count is what makes the
 * inner one restore the guard rather than lift it. Errors are the caller's to
 * handle — the guard is released either way, or one failed undo would silence
 * every registration for the rest of the session.
 */
export function withReplay(fn: () => void): void {
  undoDepth += 1;
  try {
    fn();
  } finally {
    undoDepth -= 1;
  }
}

/**
 * Runs a redo closure. Registration stays on, so the action files an undo
 * entry describing the rows it just built; what this suppresses instead is the
 * redo stack being discarded by that registration.
 */
export function withRedo(fn: () => void): void {
  redoDepth += 1;
  try {
    fn();
  } finally {
    redoDepth -= 1;
  }
}

/** Test seam: drops both guards if a test threw out of a replay. */
export function resetReplayForTests(): void {
  undoDepth = 0;
  redoDepth = 0;
}
