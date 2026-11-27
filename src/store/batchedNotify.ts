import type { StoreApi } from 'zustand';

type Listener<T> = (state: T, prev: T) => void;

/**
 * Lets a store action that writes several times tell its subscribers once.
 *
 * A zustand `set` calls every subscriber before it returns, and every mounted
 * selector is one. An action that sets twice (the change, then its undo entry)
 * ran all of them twice, the second time for a write almost none of them read.
 * Inside the returned `batch`, writes land in the store as usual, so the action
 * and anything it calls read them straight back, and the subscribers hear once,
 * when the outermost batch ends, with the state as it was before the first
 * write as their `prev`. An action that throws still tells them what it wrote.
 *
 * It takes over `api.subscribe`, so it has to be set up inside the store's
 * initializer, before anything has subscribed.
 */
export function batchNotifications<T>(api: StoreApi<T>): <R>(fn: () => R) => R {
  const listeners = new Set<Listener<T>>();
  let depth = 0;
  let held: { prev: T } | null = null;
  const tell = (state: T, prev: T) => listeners.forEach(listener => listener(state, prev));

  api.subscribe((state, prev) => {
    if (depth === 0) tell(state, prev);
    else if (!held) held = { prev };
  });
  api.subscribe = listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  return fn => {
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      if (depth === 0 && held) {
        const { prev } = held;
        held = null;
        tell(api.getState(), prev);
      }
    }
  };
}

/** `state` with each named action run inside one `batchNotifications` batch. */
export function withBatchedActions<T extends object>(api: StoreApi<T>, names: readonly (keyof T)[], state: T): T {
  const batch = batchNotifications(api);
  const actions = state as Record<keyof T, unknown>;
  for (const name of names) {
    const action = actions[name] as (...args: unknown[]) => unknown;
    actions[name] = (...args: unknown[]) => batch(() => action(...args));
  }
  return state;
}
