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
   * Either wait ends at `readWaitMs`, and the read answers from what is there.
   */
  fresh(): Promise<void>;
  /**
   * After a write: queue a run behind any in flight. Joining that run instead
   * would miss the write, since it read the database before the write existed.
   */
  afterWrite(): Promise<void>;
}

/**
 * How long a read waits for a sync before answering from the database as it
 * stands. A sync that never finished used to hold every read behind it for
 * ever, so one stuck request froze every tool. Writes still queue behind the
 * run in flight, since what they push depends on its order.
 */
export const READ_WAIT_MS = 20_000;

export function createSyncGate(
  sync: () => Promise<unknown>,
  throttleMs: number,
  now: () => number = Date.now,
  onError: (e: unknown) => void = () => {},
  readWaitMs: number = READ_WAIT_MS,
  onSlow: () => void = () => {}
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

  // The run itself carries on; only this read stops waiting for it.
  const atMost = (run: Promise<void>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        onSlow();
        resolve();
      }, readWaitMs);
    });
    return Promise.race([run, gaveUp]).finally(() => clearTimeout(timer));
  };

  return {
    fresh() {
      if (inFlight) return atMost(inFlight);
      if (lastStartedAt !== null && now() - lastStartedAt <= throttleMs) return Promise.resolve();
      return atMost(queue());
    },
    afterWrite: queue,
  };
}
