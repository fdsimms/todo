/**
 * How long recent tool calls took and where the time went, kept in memory so
 * `recent_timings` can hand it to the model.
 *
 * A server's stderr is not something the model can read, and "tool calls feel
 * slow" has three different causes with three different fixes: waiting on the
 * sync before a read, waiting on the push after a write, or the handler itself.
 * Each call records its total and the two waits; the handler's own time is the
 * rest. Per process and not persisted: a restart starts the log empty.
 *
 * Kept out of server.ts so it runs in the repo's jest.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const MAX_TIMINGS = 200;
export const DEFAULT_TIMINGS = 30;

export interface CallTiming {
  tool: string;
  /** ISO time the call started. */
  at: string;
  totalMs: number;
  /** Waiting on the sync before a read answered. */
  syncWaitMs: number;
  /** Waiting on the push after a write. */
  pushWaitMs: number;
  /** Everything else: the refresh and the handler. */
  handlerMs: number;
  failed: boolean;
}

export interface ToolTimingSummary {
  tool: string;
  calls: number;
  avgMs: number;
  maxMs: number;
}

interface Waits {
  syncWaitMs: number;
  pushWaitMs: number;
}

const current = new AsyncLocalStorage<Waits>();

/** Adds to the waits of the call running now, if one is being timed. */
export function noteWait(kind: 'sync' | 'push', ms: number): void {
  const waits = current.getStore();
  if (!waits) return;
  if (kind === 'sync') waits.syncWaitMs += ms;
  else waits.pushWaitMs += ms;
}

export function createTimingLog(max: number = MAX_TIMINGS, now: () => number = Date.now) {
  const samples: CallTiming[] = [];

  const record = (sample: CallTiming) => {
    samples.push(sample);
    if (samples.length > max) samples.shift();
  };

  /** Runs `fn` as one timed call of `tool`, recording it whether it resolves or throws. */
  async function time<T>(tool: string, fn: () => Promise<T>): Promise<T> {
    const waits: Waits = { syncWaitMs: 0, pushWaitMs: 0 };
    const startedAt = now();
    let failed = false;
    try {
      return await current.run(waits, fn);
    } catch (e) {
      failed = true;
      throw e;
    } finally {
      const totalMs = now() - startedAt;
      record({
        tool,
        at: new Date(startedAt).toISOString(),
        totalMs,
        syncWaitMs: waits.syncWaitMs,
        pushWaitMs: waits.pushWaitMs,
        handlerMs: Math.max(0, totalMs - waits.syncWaitMs - waits.pushWaitMs),
        failed,
      });
    }
  }

  function recent(input: { tool?: string; limit?: number } = {}) {
    const matching = input.tool ? samples.filter(s => s.tool === input.tool) : samples;
    const limit = Math.min(input.limit ?? DEFAULT_TIMINGS, MAX_TIMINGS);
    const byTool = new Map<string, CallTiming[]>();
    for (const s of matching) byTool.set(s.tool, [...(byTool.get(s.tool) ?? []), s]);
    const perTool: ToolTimingSummary[] = [...byTool].map(([tool, rows]) => ({
      tool,
      calls: rows.length,
      avgMs: Math.round(rows.reduce((sum, r) => sum + r.totalMs, 0) / rows.length),
      maxMs: Math.max(...rows.map(r => r.totalMs)),
    }));
    perTool.sort((a, b) => b.avgMs - a.avgMs);
    return {
      kept: samples.length,
      calls: [...matching].reverse().slice(0, limit),
      perTool,
      note: 'Since this server last started, newest first. totalMs = syncWaitMs + pushWaitMs + handlerMs. A large syncWaitMs is the sync before a read, a large pushWaitMs is the push after a write, and a large handlerMs is the tool itself.',
    };
  }

  return { time, recent };
}

export type TimingLog = ReturnType<typeof createTimingLog>;
