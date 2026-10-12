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
  /**
   * Recipe photos, as base64 JPEG keyed by the filename `Recipe.imagePath`
   * ends in (#2704). A row carries only the path, which names a file on the
   * device that took the photo, so the bytes travel here, in payloads of
   * their own that `runSync` pushes after the rows (`buildImagePayload`).
   * Absent on every other payload.
   *
   * Optional rather than a format bump, for the reason `SYNC_FORMAT` gives: a
   * build from before this reads the payload, finds no tables and no
   * deletions in it, and applies nothing, which is the right answer for a
   * device that has nowhere to put the bytes anyway.
   */
  images?: Record<string, string>;
}

/**
 * The longest base64 string one photo may arrive as: about 7.5 MB of JPEG.
 * `pickRecipeImage` saves at most 2000px at 0.7 quality, which lands well
 * under a megabyte, so anything this size is not a photo the app took, and is
 * refused rather than written to disk.
 */
export const MAX_SYNC_IMAGE_CHARS = 10_000_000;

/**
 * A photo's name as it may arrive off the wire: a bare filename, the shape
 * `pickRecipeImage` mints (`<id>.jpg`). Anything with a path separator, a
 * leading dot or a character outside that set is refused, since the name
 * becomes a file written into this device's own recipe-images directory.
 */
export function isSyncImageName(name: unknown): name is string {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 128
    && !name.startsWith('.')
    && /^[A-Za-z0-9._-]+$/.test(name);
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

/**
 * A payload carrying photos and no rows (#2704). It covers the same window as
 * the rows pushed just before it, so a store that orders or prunes by it
 * treats the two alike, and it has no tables and no deletions, so applying it
 * writes nothing to the database on any build.
 */
export function buildImagePayload(
  images: Record<string, string>,
  window: Pick<SyncChangeSet, 'since' | 'until'>,
  deviceId: string
): SyncPayload {
  return { format: SYNC_FORMAT, deviceId, since: window.since, until: window.until, tables: {}, deletions: [], images };
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
    return { ok: false, error: "That update isn’t valid JSON, so dundundun didn’t write it." };
  }

  if (!isPlainObject(raw)) return { ok: false, error: "That doesn’t look like an update from another device." };

  if (typeof raw.format !== 'number') return { ok: false, error: "That update doesn’t look right. It has no format version." };
  if (raw.format > SYNC_FORMAT) {
    return { ok: false, error: `That update came from a newer version of the app (format ${raw.format}), so this device can’t read it yet.` };
  }
  if (typeof raw.deviceId !== 'string' || raw.deviceId === '') {
    return { ok: false, error: "That update doesn’t say which device it came from." };
  }
  if (typeof raw.until !== 'string' || raw.until === '') {
    return { ok: false, error: "That update doesn’t say what period it covers." };
  }
  if (raw.since !== null && typeof raw.since !== 'string') {
    return { ok: false, error: "That update’s dates are damaged." };
  }
  if (!isPlainObject(raw.tables)) return { ok: false, error: 'That update is missing its data.' };

  for (const [table, rows] of Object.entries(raw.tables)) {
    if (!Array.isArray(rows)) return { ok: false, error: `That update’s “${table}” data is damaged.` };
    for (const row of rows) {
      if (!isPlainObject(row)) return { ok: false, error: `That update’s “${table}” data is damaged.` };
      // Without a stamp there is nothing to compare, and defaulting one would
      // silently make a peer's row either always win or always lose.
      if (typeof row.updated_at !== 'string') {
        return { ok: false, error: `That update’s “${table}” data has an entry with no timestamp.` };
      }
    }
  }

  if (!Array.isArray(raw.deletions)) return { ok: false, error: "That update is missing its list of deleted items." };
  for (const d of raw.deletions) {
    if (!isPlainObject(d)) return { ok: false, error: "That update’s list of deleted items is damaged." };
    if (typeof d.table !== 'string' || typeof d.rowKey !== 'string' || typeof d.deletedAt !== 'string') {
      return { ok: false, error: "That update’s list of deleted items is damaged." };
    }
  }

  // Held to the same standard as the rows: a photo is a file this device will
  // write, named by the sender, so a bad name or a value that isn't a string
  // rejects the payload rather than being skipped past.
  if (raw.images !== undefined) {
    if (!isPlainObject(raw.images)) return { ok: false, error: "That update’s photos are damaged." };
    for (const [name, data] of Object.entries(raw.images)) {
      if (!isSyncImageName(name) || typeof data !== 'string' || data === '' || data.length > MAX_SYNC_IMAGE_CHARS) {
        return { ok: false, error: "That update’s photos are damaged." };
      }
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

/**
 * A planned meal an apply deleted that held a calendar event on this device,
 * read off the row before the delete.
 */
export interface RemovedMealEvent {
  eventId: string;
  /**
   * The calendar server's id beside it, or null when the row had none, so the
   * delete can still find the event when the local id names nothing here (a
   * backup restored on a new phone). See `deleteLinkedEvent`.
   */
  externalId: string | null;
  /** The meal's day key, which is how the reconcile tells a removal from the horizon purge. */
  date: string;
}

/** A deadline event read off a task row an apply deleted. `RemovedMealEvent` without the day. */
export interface RemovedTaskEvent {
  eventId: string;
  /** The calendar server's id beside it, or null when the row had none. */
  externalId: string | null;
}

/** What an apply did, for the sync log and for tests. */
export interface ApplyReport {
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
  /** Deletions ignored because the local row had a later edit. */
  deletionsRefused: number;
  /**
   * Every planned meal the apply wrote (inserted or updated), by id, for the
   * meal calendar reconcile that runs after a sync (#2950). A meal's event
   * belongs to the device that wrote it (`SYNC_DEVICE_LOCAL_COLUMNS`), so a
   * peer's move or rename reaches that event only through this.
   */
  mealEntryIds: string[];
  /**
   * The events of the planned meals the apply deleted. The event id is a
   * device-local column, so once the row is gone nothing else holds it: read
   * here, before the delete, or the event stays on the calendar for good.
   */
  removedMealEvents: RemovedMealEvent[];
  /**
   * Every task the apply wrote (inserted or updated), by id, for the same kind
   * of reconcile. A task's deadline event, time block and completion event are
   * this device's too (`SYNC_DEVICE_LOCAL_COLUMNS`), so a peer's rename, new
   * deadline, completion or uncomplete reaches them only through this.
   */
  taskIds: string[];
  /**
   * The deadline events of the tasks the apply deleted, read before the delete
   * for the reason `removedMealEvents` is. Only the deadline event: the app
   * never deletes a time block (`Task.timeBlockEventId`), and a completion
   * event is a record of what happened rather than a mirror of the row.
   */
  removedTaskEvents: RemovedTaskEvent[];
}

export function emptyApplyReport(): ApplyReport {
  return {
    inserted: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    deletionsRefused: 0,
    mealEntryIds: [],
    removedMealEvents: [],
    taskIds: [],
    removedTaskEvents: [],
  };
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
