/**
 * The phone's error log: failures it recorded in `error_log` (utils/errorLog.ts)
 * and synced, because a replica cannot read a device's console.
 *
 * Read-only, and a diagnostic aid rather than a record of the person: each row
 * is where an error was caught, its name, a trimmed message and the top of its
 * stack. Nothing in it is a request body or the person's own text by design,
 * but a message can still quote a little of one, so it is shown only to work out
 * why something failed, never repeated back as the person's data.
 */
import type { Replica } from './replica';

export const DEFAULT_ERRORS = 25;
export const MAX_ERRORS = 100;

export interface ErrorRow {
  id: string;
  at: string;
  /** Where it was caught, e.g. `recipe-component-import`. */
  source: string;
  name: string;
  message: string;
  stack?: string;
}

export interface ErrorList {
  /** How many rows the phone has kept, before `source` and `limit` narrow them. */
  total: number;
  errors: ErrorRow[];
  note: string;
}

export function listErrors(
  replica: Replica,
  input: { source?: string; limit?: number } = {}
): ErrorList {
  const all = replica.errorLog();
  const source = input.source?.trim().toLowerCase();
  const matching = source ? all.filter(e => e.source.toLowerCase() === source) : all;
  const limit = Math.min(input.limit ?? DEFAULT_ERRORS, MAX_ERRORS);
  return {
    total: all.length,
    errors: matching.slice(0, limit).map(e => ({
      id: e.id,
      at: e.at,
      source: e.source,
      name: e.name,
      message: e.message,
      ...(e.stack ? { stack: e.stack } : {}),
    })),
    note: 'Newest first. Only unexpected failures are logged, as the phone caught them, and the log keeps about a month. A fresh sync is needed for a failure the person just hit to appear. Empty means none were recorded, not that nothing went wrong.',
  };
}
