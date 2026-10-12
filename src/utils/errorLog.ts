import { subDays } from 'date-fns/subDays';
import { dbInsertErrorLog, dbPruneErrorLog, type ErrorLogRow } from '../db/database';
import { generateId } from './id';
import { isDemoModeActive } from './demoState';

/**
 * A short trail of unexpected failures, kept so somebody who isn't holding the
 * phone can read them. The MCP server is a replica and sees only what syncs, so
 * a `console.warn` on the device never reaches it; a row does.
 *
 * What goes in is deliberately small: the error's name, a trimmed message and
 * the top of its stack, plus where it was caught. Never a request body, a
 * recipe's text or a prompt, which is what an error is most likely to be
 * carrying by accident. An API key that turns up in a message is blanked.
 *
 * Capped by count and age rather than kept for good, like the unattended
 * ledger: a diagnostic trail that grows without bound is a table nobody reads
 * and a sync payload everybody pays for.
 */
export const ERROR_LOG_MAX_ROWS = 100;
export const ERROR_LOG_MAX_DAYS = 30;
const MESSAGE_MAX = 300;
const STACK_MAX = 800;
const STACK_LINES = 6;

function scrub(text: string): string {
  return text.replace(/sk-ant-[\w-]+/g, '[key]');
}

/** The row an error becomes. Pure, so what is kept and trimmed can be tested. */
export function buildErrorEntry(source: string, error: unknown, now: Date = new Date()): ErrorLogRow {
  const isError = error instanceof Error;
  const name = isError ? error.name : typeof error;
  const message = isError ? error.message : typeof error === 'string' ? error : '';
  const stack = isError && error.stack
    ? error.stack.split('\n').slice(0, STACK_LINES).join('\n')
    : '';
  return {
    id: generateId(),
    at: now.toISOString(),
    source: source.slice(0, 60),
    name: name.slice(0, 60),
    message: scrub(message).slice(0, MESSAGE_MAX),
    stack: scrub(stack).slice(0, STACK_MAX),
  };
}

/**
 * Records an unexpected failure. Never throws and never waits: it is called
 * from catch blocks, and a logger that can fail inside one is worse than none.
 * Demo mode writes nothing, since its database is thrown away and its rows
 * would never be the person's.
 */
export function logError(source: string, error: unknown): void {
  if (isDemoModeActive()) return;
  try {
    const now = new Date();
    dbInsertErrorLog(buildErrorEntry(source, error, now));
    dbPruneErrorLog(subDays(now, ERROR_LOG_MAX_DAYS).toISOString(), ERROR_LOG_MAX_ROWS);
  } catch {
    // Nothing more can usefully be done with a failure to log a failure.
  }
}
