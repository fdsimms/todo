/**
 * Fasts: the spans with no food the person starts and ends on the Food log
 * (src/utils/fasting.ts). Read-only here. A fast is started from the phone,
 * where the timer and its notification live, so nothing an agent wrote could
 * ring.
 */
import type { Fast } from '../../src/types';
import type { Replica } from './replica';
import { activeFast, describeFastLength, fastElapsedMs, fastGoalAt } from '../../src/utils/fasting';

export interface FastRow {
  startedAt: string;
  /** Absent while the fast is running. */
  endedAt?: string;
  goalHours: number;
  /** How long it ran, or has run so far, in words. */
  length: string;
  /** When the goal is (or was) reached. */
  goalAt: string;
}

export const DEFAULT_FAST_LIMIT = 14;
export const MAX_FAST_LIMIT = 100;

function row(fast: Fast, now: Date): FastRow {
  return {
    startedAt: fast.startedAt,
    ...(fast.endedAt ? { endedAt: fast.endedAt } : {}),
    goalHours: fast.goalHours,
    length: describeFastLength(fastElapsedMs(fast, now)),
    goalAt: fastGoalAt(fast).toISOString(),
  };
}

export function listFasts(
  replica: Replica,
  input: { limit?: number },
  now: Date = new Date()
): { running: FastRow | null; recent: FastRow[] } {
  const fasts = replica.fasts();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_FAST_LIMIT, 1), MAX_FAST_LIMIT);
  const running = activeFast(fasts);
  const recent = fasts
    .filter(f => f.endedAt !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
    .map(f => row(f, now));
  return { running: running ? row(running, now) : null, recent };
}
