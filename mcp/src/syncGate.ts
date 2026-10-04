/**
 * When the replica syncs with the payload store, and that it never does so
 * twice at once.
 *
 * Every tool call refreshes the replica before it answers, throttled, so a
 * question asked after the phone changed something gets the new answer (see
 * `fresh`). Writes push straight after they land (see `afterWrite`). Both go
 * through one queue, because two runs at once is the race `runSyncAll` runs
 * its transports in sequence to avoid: one run's apply lands between the
 * other's push and its cursor advance, and that change is pushed straight
 * back. A catch-up longer than the throttle (a first sync, a backlog of recipe
 * photos) used to let the next tool call start a second run beside it.
 *
 * Kept out of server.ts so it runs in the repo's jest: that file imports the
 * MCP SDK and is the one place in mcp/ that can hold no logic.
 */

export interface SyncGate {
  /**
   * Before a read: wait out a run already going, which is the freshness the
   * read wants, or start one if the last began longer ago than the throttle.
   */
  fresh(): Promise<void>;
  /**
   * After a write: queue a run behind any in flight. Joining that run instead
   * would miss the write, since it read the database before the write existed.
   */
  afterWrite(): Promise<void>;
}

export function createSyncGate(
  sync: () => Promise<unknown>,
  throttleMs: number,
  now: () => number = Date.now,
  onError: (e: unknown) => void = () => {}
): SyncGate {
  let lastStartedAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  const queue = (): Promise<void> => {
    const run = (inFlight ?? Promise.resolve()).then(async () => {
      lastStartedAt = now();
      try {
        await sync();
      } catch (e) {
        // Swallowed on purpose: a store that is down should mean slightly
        // stale answers, not no answers.
        onError(e);
      }
    });
    inFlight = run;
    void run.then(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  };

  return {
    fresh() {
      if (inFlight) return inFlight;
      if (lastStartedAt !== null && now() - lastStartedAt <= throttleMs) return Promise.resolve();
      return queue();
    },
    afterWrite: queue,
  };
}
