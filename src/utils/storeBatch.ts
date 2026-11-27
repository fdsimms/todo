/**
 * Holding a store's notifications while one action makes many writes.
 *
 * A zustand store tells every subscriber about every `set`, and each one runs
 * every selector mounted on that store. An action that loops over other
 * actions (adding a recipe's twelve ingredients, a pasted list of thirty)
 * makes two to four `set`s per row, so one tap was dozens of notifications,
 * each of them every selector on screen plus whatever follows the store
 * outside React, with only the last one showing anything new.
 *
 * `installNotificationBatch` wraps the store's `subscribe` once, as the store
 * is created, and hands back `batch`. Inside `batch(fn)` the state changes as
 * usual and `get()` sees every write, but subscribers hear nothing until `fn`
 * returns, and then hear once: the state as it now stands, and the state as
 * it stood when the batch began as its `prev`. Batches nest, and a throw
 * still tells subscribers about whatever was written before it.
 *
 * It must be installed inside the store's creator (it takes the creator's
 * third argument), because the React hook subscribes through that object and
 * not through the hook's own copy of `subscribe`.
 */

type Listener<S> = (state: S, prev: S) => void;

interface BatchableApi<S> {
  subscribe: (listener: Listener<S>) => () => void;
  getState: () => S;
}

export function installNotificationBatch<S>(api: BatchableApi<S>): <T>(fn: () => T) => T {
  const subscribe = api.subscribe;
  const listeners = new Set<Listener<S>>();
  let depth = 0;
  let heldSince: { state: S } | null = null;

  api.subscribe = listener => {
    listeners.add(listener);
    const unsubscribe = subscribe((state, prev) => {
      if (depth > 0) {
        heldSince ??= { state: prev };
        return;
      }
      listener(state, prev);
    });
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  };

  return fn => {
    depth += 1;
    try {
      return fn();
    } finally {
      depth -= 1;
      if (depth === 0 && heldSince) {
        const prev = heldSince.state;
        heldSince = null;
        const state = api.getState();
        // Snapshotted: a listener that unsubscribes as it is told would
        // otherwise change the set being walked.
        for (const listener of [...listeners]) {
          if (listeners.has(listener)) listener(state, prev);
        }
      }
    }
  };
}

/**
 * `state` with each named action run inside one batch, for a store whose
 * multi-write actions are whole taps (the change, then its undo entry) and
 * not loops that call `batch` themselves.
 *
 * `around` runs each action inside something else as well, which is how a
 * store makes one of these a single commit: it passes `dbTransaction`. It is
 * handed in because this file knows nothing of the database.
 */
export function withBatchedActions<S extends object>(
  api: BatchableApi<S>,
  names: readonly (keyof S)[],
  state: S,
  around: (fn: () => void) => void = fn => fn(),
): S {
  const batch = installNotificationBatch(api);
  const actions = state as Record<keyof S, unknown>;
  for (const name of names) {
    const action = actions[name] as (...args: unknown[]) => unknown;
    actions[name] = (...args: unknown[]) => batch(() => {
      let result: unknown;
      around(() => { result = action(...args); });
      return result;
    });
  }
  return state;
}
