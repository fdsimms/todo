/**
 * The sync loop — push what changed, pull what didn't, apply it (#1551).
 *
 * Deliberately knows nothing about CloudKit, or about SQLite. A transport
 * supplies two functions and the local database supplies six, so the parts
 * that are expensive to get right — cursor advancement, echo filtering, what
 * happens when half a batch fails — are ordinary TypeScript that runs in jest
 * rather than Swift that needs a device and a build cycle.
 *
 * That split is the whole point of doing this before the native module. The
 * hardest thing to debug in a sync system is not the network call; it is a
 * cursor that advanced past something that never landed. None of that
 * reasoning should live behind a rebuild.
 *
 * **Two cursors, not one.** Outgoing progress is a timestamp from this
 * device's own clock (`dbSyncChangesSince`'s `until`). Incoming progress is an
 * opaque token the transport defines — CloudKit hands back a change token,
 * a file store might hand back a name or a date — and it is stored verbatim
 * and never interpreted. Collapsing them into one value would force every
 * transport to speak in timestamps, which CloudKit's does not.
 */
import {
  buildPayload,
  emptyApplyReport,
  parsePayload,
  serializePayload,
  type ApplyReport,
  type SyncChangeSet,
  type SyncPayload,
} from './syncMerge';

/** What a payload store has to be able to do. CloudKit fills this in. */
export interface SyncTransport {
  /** Stable name, used to key this transport's cursors. */
  readonly name: string;
  /** Publish this device's changes. Resolves once they are durably stored. */
  push(payload: string): Promise<void>;
  /** Everything other devices have published since `since`. */
  pull(since: string | null): Promise<PullResult>;
}

export interface PullResult {
  payloads: string[];
  /**
   * Opaque, transport-defined, stored verbatim. Null means "no new position",
   * and leaves the stored cursor alone.
   */
  cursor: string | null;
}

/** What the local database has to be able to do. */
export interface SyncLocal {
  deviceId(): string;
  /** False for the demo database, whose contents are seeded fiction. */
  isSyncable(): boolean;
  changesSince(cursor: string | null): SyncChangeSet;
  apply(payload: SyncPayload): ApplyReport;
  getCursor(key: string): string | null;
  setCursor(key: string, value: string): void;
}

export type SyncStatus = 'ok' | 'skipped' | 'failed';

export interface SyncRunResult {
  status: SyncStatus;
  /** Whether this device had anything to send. */
  pushed: boolean;
  applied: ApplyReport;
  /**
   * Payloads that could not be read — almost always a peer on a newer format.
   * Counted rather than thrown, because one unreadable payload must not wedge
   * sync forever while the peer keeps writing more of them.
   */
  unreadable: number;
  /** Set when status is 'failed' or 'skipped'. */
  reason?: string;
}

export function hasChanges(changes: SyncChangeSet): boolean {
  if (changes.deletions.length > 0) return true;
  return Object.values(changes.tables).some(rows => rows.length > 0);
}

function addReport(into: ApplyReport, from: ApplyReport): void {
  into.inserted += from.inserted;
  into.updated += from.updated;
  into.skipped += from.skipped;
  into.deleted += from.deleted;
  into.deletionsRefused += from.deletionsRefused;
}

/**
 * One full exchange: push, then pull and apply.
 *
 * Push first so that a failure while applying still leaves this device's work
 * published. The reverse order would mean a device that crashes on a peer's
 * bad payload never gets its own changes out at all.
 *
 * Every cursor advances only after the work it covers has actually succeeded,
 * which is the one invariant here worth defending: an advanced cursor is a
 * promise that everything before it landed, and nothing re-reads that window
 * again. Applying is idempotent (see remoteRowWins' tie rule), so retrying a
 * window costs a little bandwidth and nothing else — while skipping one loses
 * an edit permanently.
 */
export async function runSync(
  transport: SyncTransport,
  local: SyncLocal
): Promise<SyncRunResult> {
  const applied = emptyApplyReport();

  if (!local.isSyncable()) {
    return { status: 'skipped', pushed: false, applied, unreadable: 0, reason: 'Demo mode.' };
  }

  const pushKey = `${transport.name}:push`;
  const pullKey = `${transport.name}:pull`;
  let pushed = false;
  let unreadable = 0;

  try {
    const changes = local.changesSince(local.getCursor(pushKey));
    if (hasChanges(changes)) {
      await transport.push(serializePayload(buildPayload(changes, local.deviceId())));
      pushed = true;
    }
    // Advanced even when nothing was sent: the window was genuinely read and
    // held nothing, so re-reading it next time would only re-scan rows that
    // are already accounted for.
    local.setCursor(pushKey, changes.until);
  } catch (e) {
    return {
      status: 'failed',
      pushed: false,
      applied,
      unreadable,
      reason: messageOf(e, 'Could not send changes.'),
    };
  }

  try {
    const result = await transport.pull(local.getCursor(pullKey));
    const mine = local.deviceId();

    for (const raw of result.payloads) {
      const parsed = parsePayload(raw);
      if (!parsed.ok) {
        unreadable++;
        continue;
      }
      // A transport that stores everything hands back this device's own
      // records too. Applying them would be harmless but not free, and it
      // would make the sync log report work that never happened.
      if (parsed.payload.deviceId === mine) continue;

      addReport(applied, local.apply(parsed.payload));
    }

    // Only after every payload in the batch applied. A throw above leaves the
    // cursor where it was, so the whole batch is retried — the ones that
    // already landed apply again as no-ops.
    if (result.cursor !== null) local.setCursor(pullKey, result.cursor);
  } catch (e) {
    return {
      status: 'failed',
      pushed,
      applied,
      unreadable,
      reason: messageOf(e, 'Could not receive changes.'),
    };
  }

  return { status: 'ok', pushed, applied, unreadable };
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
