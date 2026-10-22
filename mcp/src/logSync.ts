/**
 * Whether the health logs and the journal are being sent to this server.
 *
 * Both travel only while a switch on the phone is on (Settings › Data & reset ›
 * Sync), and the switches themselves never leave the phone. What does is each
 * device's report of them (`SERVER_SHARING_KEY_PREFIX` in syncTracking.ts), one
 * row per device, so this reads every report and says which way they point.
 * Without it an agent could only see what had arrived, and a short history
 * read as the whole of one when the switch had simply been turned off.
 */
import type { ServerSharing } from '../../src/db/syncTracking';
import type { Replica } from './replica';

/**
 * `unknown` when no device has reported (a phone on a build from before the
 * report), `mixed` when one device sends and another doesn't, so what is here
 * is only some of what was logged.
 */
export type LogSyncState = 'on' | 'off' | 'mixed' | 'unknown';

export interface LogSync {
  healthLogs: LogSyncState;
  journal: LogSyncState;
}

export type LogKind = keyof LogSync;

function stateOf(reports: readonly ServerSharing[], kind: LogKind): LogSyncState {
  if (reports.length === 0) return 'unknown';
  const on = reports.filter(r => r[kind]).length;
  if (on === reports.length) return 'on';
  return on === 0 ? 'off' : 'mixed';
}

export function summarizeLogSync(reports: readonly ServerSharing[]): LogSync {
  return { healthLogs: stateOf(reports, 'healthLogs'), journal: stateOf(reports, 'journal') };
}

const SWITCH: Record<LogKind, string> = {
  healthLogs: 'Include health logs',
  journal: 'Include journal and dreams',
};

/**
 * What a result from that log should say about being partial, or undefined
 * when the switch is on or nobody has said. Stated as a fact about what is
 * here, never as how much the person logs.
 */
export function logSyncNote(state: LogSyncState, kind: LogKind): string | undefined {
  const where = `Settings › Data & reset › Sync › ${SWITCH[kind]}`;
  if (state === 'off') {
    return `${where} is off on the phone, so this is only what was sent before it was turned off, not everything the person has written or logged.`;
  }
  if (state === 'mixed') {
    return `${where} is off on at least one of the person's devices, so this is missing whatever was written or logged there.`;
  }
  return undefined;
}

/** A result with the note for its log added as `syncNote`, where there is one. */
export function withLogSyncNote<T extends object>(replica: Replica, kind: LogKind, result: T): T | (T & { syncNote: string }) {
  const note = logSyncNote(summarizeLogSync(replica.serverSharingReports())[kind], kind);
  return note ? { ...result, syncNote: note } : result;
}
