/**
 * Merge rules — deciding whose copy of a row wins (#1551).
 *
 * The pure half of applying a peer's changes: the payload shape, the
 * validation, and the two comparisons that decide every merge. The SQL that
 * acts on those decisions lives in db/database.ts, so the rules that determine
 * whether data survives can be tested without a device.
 *
 * **Row-level last-writer-wins, on the wall clock.** Both devices are the same
 * person's, both are NTP-synced, and one user does not edit the same task on
 * two devices in the same second — so a timestamp comparison is sufficient
 * here in a way it would not be for a multi-user app. What it costs is
 * ordering precision under clock skew, which for this use case is worth far
 * less than the machinery (vector clocks, HLCs, per-field merges) that
 * removing it would take.
 *
 * The deliberate consequence: an edit made on two devices while apart keeps
 * one of them wholesale, rather than merging field by field. Editing a task's
 * title on the phone and its due date on the Mac while offline loses one of
 * the two. Field-level merge is possible later — the raw rows carry
 * everything it would need — but it is not free, and it is not what a single
 * user hitting one device at a time actually needs.
 */
import type { BackupRow } from './backup';

/** One deleted row, as a peer needs to hear about it. */
export interface SyncDeletion {
  table: string;
  /** The row's primary key; composite keys joined by KEY_SEPARATOR. */
  rowKey: string;
  deletedAt: string;
}

/** Everything that changed in one window, plus the cursor to resume from. */
export interface SyncChangeSet {
  /** The cursor this was read from — null on a first, full read. */
  since: string | null;
  /** The cursor to pass as `since` next time. */
  until: string;
  /** Changed and created rows, exactly as stored, keyed by table. */
  tables: Record<string, BackupRow[]>;
  deletions: SyncDeletion[];
}

/**
 * Bumped only for a change an older build could not read correctly — the same
 * rule BACKUP_FORMAT follows. Adding a table or a column doesn't qualify,
 * since the apply side intersects against the live schema either way.
 */
export const SYNC_FORMAT = 1;

/** A changeset addressed to a peer. */
export interface SyncPayload extends SyncChangeSet {
  format: number;
  /** Which device produced this, so a device can ignore its own echo. */
  deviceId: string;
}

export type ParsedPayload =
  | { ok: true; payload: SyncPayload }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function buildPayload(changes: SyncChangeSet, deviceId: string): SyncPayload {
  return { format: SYNC_FORMAT, deviceId, ...changes };
}

export function serializePayload(payload: SyncPayload): string {
  return JSON.stringify(payload);
}

/**
 * Validates a payload that arrived from outside.
 *
 * Written to the same standard as parseBackup: everything here came off a
 * network and none of it is trusted. A malformed payload has to be a rejected
 * sync, never a half-applied one — so this checks the whole shape up front
 * rather than letting the apply loop discover a bad row halfway through
 * having already written the good ones.
 */
export function parsePayload(text: string): ParsedPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }

  if (!isPlainObject(raw)) return { ok: false, error: 'Not a sync payload.' };

  if (typeof raw.format !== 'number') return { ok: false, error: 'Missing format.' };
  if (raw.format > SYNC_FORMAT) {
    return { ok: false, error: `Written by a newer version of the app (format ${raw.format}).` };
  }
  if (typeof raw.deviceId !== 'string' || raw.deviceId === '') {
    return { ok: false, error: 'Missing device id.' };
  }
  if (typeof raw.until !== 'string' || raw.until === '') {
    return { ok: false, error: 'Missing cursor.' };
  }
  if (raw.since !== null && typeof raw.since !== 'string') {
    return { ok: false, error: 'Malformed cursor.' };
  }
  if (!isPlainObject(raw.tables)) return { ok: false, error: 'Missing tables.' };

  for (const [table, rows] of Object.entries(raw.tables)) {
    if (!Array.isArray(rows)) return { ok: false, error: `Table ${table} is not a list of rows.` };
    for (const row of rows) {
      if (!isPlainObject(row)) return { ok: false, error: `Table ${table} holds a malformed row.` };
      // Without a stamp there is nothing to compare, and defaulting one would
      // silently make a peer's row either always win or always lose.
      if (typeof row.updated_at !== 'string') {
        return { ok: false, error: `Table ${table} holds a row with no timestamp.` };
      }
    }
  }

  if (!Array.isArray(raw.deletions)) return { ok: false, error: 'Missing deletions.' };
  for (const d of raw.deletions) {
    if (!isPlainObject(d)) return { ok: false, error: 'Malformed deletion.' };
    if (typeof d.table !== 'string' || typeof d.rowKey !== 'string' || typeof d.deletedAt !== 'string') {
      return { ok: false, error: 'Malformed deletion.' };
    }
  }

  return { ok: true, payload: raw as unknown as SyncPayload };
}

/**
 * Whether a peer's copy of a row replaces the local one.
 *
 * Ties go to the local copy — not arbitrary. A tie is overwhelmingly the same
 * row already synced and echoed back, where the two copies are identical and
 * writing is pure churn; a genuine same-millisecond edit on two devices is a
 * case this app will not see. Keeping local also makes applying a payload
 * twice a no-op, which is what lets the inclusive cursor in dbSyncChangesSince
 * re-send freely.
 *
 * A local row with no stamp at all loses. That can only be a row written
 * before tracking existed on a device that has somehow not been backfilled;
 * treating "unknown" as oldest is the reading that lets a peer repair it.
 */
export function remoteRowWins(localUpdatedAt: string | null, remoteUpdatedAt: string): boolean {
  if (localUpdatedAt === null) return true;
  return remoteUpdatedAt > localUpdatedAt;
}

/**
 * Whether a peer's deletion removes the local row.
 *
 * The asymmetry with remoteRowWins is deliberate: a deletion applies unless
 * the local row was edited *strictly after* it. Coming back to a task and
 * changing it is a clear statement that it should still exist, so a later edit
 * resurrects it — but a tie goes to the delete, because the alternative is a
 * row the user deleted on one device quietly living on forever on the other,
 * which is the failure people actually notice and can't explain.
 */
export function remoteDeletionWins(localUpdatedAt: string | null, deletedAt: string): boolean {
  if (localUpdatedAt === null) return true;
  return localUpdatedAt <= deletedAt;
}

/** What an apply did, for the sync log and for tests. */
export interface ApplyReport {
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
  /** Deletions ignored because the local row had a later edit. */
  deletionsRefused: number;
}

export function emptyApplyReport(): ApplyReport {
  return { inserted: 0, updated: 0, skipped: 0, deleted: 0, deletionsRefused: 0 };
}

/** One line for the sync log: "12 added, 3 updated, 1 removed". */
export function describeApply(report: ApplyReport): string {
  const parts: string[] = [];
  if (report.inserted) parts.push(`${report.inserted} added`);
  if (report.updated) parts.push(`${report.updated} updated`);
  if (report.deleted) parts.push(`${report.deleted} removed`);
  if (parts.length === 0) return 'Nothing new';
  return parts.join(', ');
}
