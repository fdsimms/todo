/**
 * A generation counter for a store that fills itself from something slow.
 *
 * Four stores here read from outside the app — the calendar, the weather,
 * Apple Health, the Screen Time extension — and all four are shaped the same
 * way: a `refresh` that awaits a device read and then writes what came back
 * into state. An await is a gap, and two things can happen in it.
 *
 * The first is a second refresh. The settings subscription, the foreground
 * listener and the initial mount all fire a refresh, and they routinely fire
 * together — so two reads can be in flight over different windows, and whichever
 * resolves *last* wins rather than whichever *started* last. That can leave a
 * window's start, its events and its per-source status coming from different
 * passes.
 *
 * The second is worse and is the reason this is a shared piece rather than a
 * flag in each store: the user switching the feature off. Every one of those
 * stores is driven by `enabled ? refresh() : clear()`, so a toggle during the
 * gap runs `clear()` and then the awaited read resolves and writes the data
 * straight back. For Health and the calendar that breaks the rule those
 * features are built on — that revoked access shows as *no* data rather than
 * as the last data — which is the one thing they say they must never do.
 *
 * Both are the same bug: a result is only good if nothing has happened since it
 * was asked for. So a read takes a token before it starts and checks the token
 * still stands before it writes; `clear` (or anything else that invalidates
 * what is in flight) moves the counter on and the stale result is dropped.
 *
 * One guard per independent read, not one per store: a store whose history and
 * today's reading are fetched separately needs a guard each, or one read cancels
 * the other for no reason.
 */
export interface RefreshGuard {
  /** Claims the next generation. Call immediately before the first await. */
  begin: () => number;
  /** Whether `token` is still the current generation — check before every write. */
  isCurrent: (token: number) => boolean;
  /** Moves the generation on, so every read now in flight is stale. */
  invalidate: () => void;
}

export function createRefreshGuard(): RefreshGuard {
  let generation = 0;
  return {
    begin: () => (generation += 1),
    isCurrent: (token: number) => token === generation,
    invalidate: () => {
      generation += 1;
    },
  };
}
