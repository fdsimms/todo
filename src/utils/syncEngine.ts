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
  buildImagePayload,
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
  /**
   * Rows this transport is never sent. Pushes only: what it hands back is
   * still applied, since a row arriving on this device is already the
   * person's own data on their own device.
   */
  readonly withhold?: SyncWithholding;
  /**
   * False for a transport no recipe photo is sent to. Its rows still carry
   * each photo's path, and a photo it hands back is still written here.
   */
  readonly sendsImages?: boolean;
}

/** Tables, and keys of the `settings` table, held back from a transport. */
export interface SyncWithholding {
  tables: readonly string[];
  settingKeys: readonly string[];
}

/**
 * `changes` without what `withholding` names, deletions included.
 *
 * Applied after the read rather than inside it, so the cursor still covers the
 * whole window: a withheld row is not pending, it is refused. Sending it later
 * is a deliberate rewind of the cursor by whoever lifts the refusal (see
 * `rewindForHealthLogs` in useSyncStore), not something this does by itself.
 */
export function withholdChanges(changes: SyncChangeSet, withholding: SyncWithholding | undefined): SyncChangeSet {
  if (!withholding) return changes;
  const tables = new Set(withholding.tables);
  const keys = new Set(withholding.settingKeys);
  const held = (table: string, key: unknown) =>
    tables.has(table) || (table === 'settings' && typeof key === 'string' && keys.has(key));

  const kept: SyncChangeSet['tables'] = {};
  for (const [name, rows] of Object.entries(changes.tables)) {
    if (tables.has(name)) continue;
    kept[name] = name === 'settings' ? rows.filter(r => !held(name, r.key)) : rows;
  }
  return {
    ...changes,
    tables: kept,
    deletions: changes.deletions.filter(d => !held(d.table, d.rowKey)),
  };
}

/** The setting a transport's outgoing cursor is stored under, by way of `SyncLocal`. */
export function pushCursorKey(transportName: string): string {
  return `${transportName}:push`;
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
  /**
   * `transport` names who the changes are for, so rows and deletions that
   * arrived *from* that transport aren't relayed straight back to it.
   */
  changesSince(cursor: string | null, transport?: string): SyncChangeSet;
  /** `transport` is recorded as where the applied rows came from. */
  apply(payload: SyncPayload, transport?: string): ApplyReport;
  getCursor(key: string): string | null;
  setCursor(key: string, value: string): void;
  /**
   * The recipe photos this device holds, by filename (#2704). Names only, so
   * the list costs a query rather than a read of every file. Optional, like
   * the two below: a local without photos (the MCP replica's tests, an older
   * fake) syncs rows exactly as before.
   */
  imageNames?(): string[];
  /** One photo's bytes as base64, or null when the file isn't here. */
  readImage?(name: string): string | null;
  /** Stores a photo a peer sent. True when a file was written, false when it was already here or couldn't be. */
  writeImage?(name: string, base64: string): boolean;
}

/**
 * How much base64 one photo payload carries before the rest go in another:
 * six to twelve photos at the size `pickRecipeImage` saves. The self-hosted
 * store accepts 32 MB a request (`express.json` in mcp/src/server.ts), and a
 * payload is pulled whole on a phone that may be on cellular, so this stays
 * well under both rather than finding either limit.
 */
export const IMAGE_PAYLOAD_BUDGET_CHARS = 6_000_000;

/** The device-local cursor key holding which photos a transport already has. */
export function imagesSentKey(transportName: string): string {
  return `${transportName}:images`;
}

function readNameList(stored: string | null): Set<string> {
  if (!stored) return new Set();
  try {
    const parsed: unknown = JSON.parse(stored);
    return new Set(Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Pushes every photo this transport hasn't had yet, after the rows, in
 * payloads of at most `IMAGE_PAYLOAD_BUDGET_CHARS` (#2704). Returns how many
 * went.
 *
 * - **Each photo goes to a transport once.** A photo's filename is minted when
 *   it is taken and never reused, so the name is its identity, and the names a
 *   transport already has are kept under a device-local cursor key. That is
 *   what stops a photo being re-sent every time its recipe is edited, and what
 *   lets every photo taken before this existed go on the first sync after it
 *   without a separate pass.
 * - **A photo a transport handed to this device counts as one it has**, the
 *   rule rows follow (`changesSince`'s `transport`), so nothing is echoed back
 *   to the store it came from. It still goes to the other transport.
 * - **Recorded per payload, as each one lands**, so a failure halfway through
 *   re-sends only the photos that didn't go.
 * - **A photo whose file isn't here is skipped, not recorded.** It may arrive
 *   from a peer later, and then it goes on.
 */
async function pushImages(
  transport: SyncTransport,
  local: SyncLocal,
  pushWindow: Pick<SyncChangeSet, 'since' | 'until'>
): Promise<number> {
  if (!local.imageNames || !local.readImage) return 0;
  const key = imagesSentKey(transport.name);
  const held = local.imageNames();
  const heldSet = new Set(held);
  // Names of photos no longer here are dropped as the list is next written,
  // so it tracks the photos that exist rather than every one there ever was.
  const sent = new Set([...readNameList(local.getCursor(key))].filter(n => heldSet.has(n)));
  const pending = held.filter(n => !sent.has(n));
  let count = 0;
  let batch: Record<string, string> = {};
  let batchChars = 0;

  const flush = async () => {
    const names = Object.keys(batch);
    if (names.length === 0) return;
    await transport.push(serializePayload(buildImagePayload(batch, pushWindow, local.deviceId())));
    names.forEach(n => sent.add(n));
    local.setCursor(key, JSON.stringify([...sent]));
    count += names.length;
    batch = {};
    batchChars = 0;
  };

  for (const name of pending) {
    const data = local.readImage(name);
    if (!data) continue;
    if (batchChars > 0 && batchChars + data.length > IMAGE_PAYLOAD_BUDGET_CHARS) await flush();
    batch[name] = data;
    batchChars += data.length;
  }
  await flush();
  return count;
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
  /** Recipe photos pushed to this transport (#2704). */
  imagesSent: number;
  /** Recipe photos written to this device from it. */
  imagesReceived: number;
  /**
   * Set when the rows went but a photo payload didn't. Not a failed run: the
   * rows are the sync, the photos go again next time, and a store that
   * refuses photo payloads outright must not stop this device pulling.
   */
  imageProblem?: string;
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
  into.mealEntryIds.push(...from.mealEntryIds);
  into.removedMealEvents.push(...from.removedMealEvents);
  into.taskIds.push(...from.taskIds);
  into.removedTaskEvents.push(...from.removedTaskEvents);
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
    return {
      status: 'skipped', pushed: false, applied, unreadable: 0, reason: 'Demo mode.',
      imagesSent: 0, imagesReceived: 0,
    };
  }

  const pushKey = pushCursorKey(transport.name);
  const pullKey = `${transport.name}:pull`;
  let pushed = false;
  let unreadable = 0;
  let imagesSent = 0;
  let imagesReceived = 0;
  let imageProblem: string | undefined;
  let pushWindow: Pick<SyncChangeSet, 'since' | 'until'>;

  try {
    const changes = withholdChanges(
      local.changesSince(local.getCursor(pushKey), transport.name),
      transport.withhold
    );
    if (hasChanges(changes)) {
      await transport.push(serializePayload(buildPayload(changes, local.deviceId())));
      pushed = true;
    }
    // Advanced even when nothing was sent: the window was genuinely read and
    // held nothing, so re-reading it next time would only re-scan rows that
    // are already accounted for.
    local.setCursor(pushKey, changes.until);
    pushWindow = { since: changes.since, until: changes.until };
  } catch (e) {
    return {
      status: 'failed',
      pushed: false,
      applied,
      unreadable,
      reason: messageOf(e, 'Could not send changes.'),
      imagesSent,
      imagesReceived,
    };
  }

  // After the rows, so a peer has the recipe before its photo, and outside
  // the row push's own failure: see `imageProblem`.
  try {
    imagesSent = transport.sendsImages === false ? 0 : await pushImages(transport, local, pushWindow);
    if (imagesSent > 0) pushed = true;
  } catch (e) {
    imageProblem = messageOf(e, 'Could not send recipe photos.');
  }

  try {
    const result = await transport.pull(local.getCursor(pullKey));
    const mine = local.deviceId();
    const imageKey = imagesSentKey(transport.name);
    let arrived: Set<string> | null = null;

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

      addReport(applied, local.apply(parsed.payload, transport.name));

      // After the payload's rows, which are none in a photo payload, and only
      // where the local can store a file at all.
      if (parsed.payload.images && local.writeImage) {
        arrived ??= readNameList(local.getCursor(imageKey));
        for (const [name, data] of Object.entries(parsed.payload.images)) {
          if (local.writeImage(name, data)) imagesReceived++;
          // The store has it, so it is never pushed back there (see pushImages).
          arrived.add(name);
        }
      }
    }
    if (arrived) local.setCursor(imageKey, JSON.stringify([...arrived]));

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
      imagesSent,
      imagesReceived,
      ...(imageProblem ? { imageProblem } : {}),
    };
  }

  return {
    status: 'ok', pushed, applied, unreadable, imagesSent, imagesReceived,
    ...(imageProblem ? { imageProblem } : {}),
  };
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** One transport's run, labelled, so a caller with several can say which failed. */
export interface NamedSyncRun {
  transport: string;
  result: SyncRunResult;
}

/**
 * Every configured transport, one after another.
 *
 * **Sequential rather than parallel, and that is not a performance oversight.**
 * The transports share one local database and `changesSince`/`apply` are
 * synchronous SQLite either side of an `await`, so running two at once
 * interleaves them: B's `apply` can land rows in the window between A's push
 * and A's cursor advance, and those rows carry a fresh `updated_at`. A would
 * then push straight back what it had just been handed. The per-transport
 * cursors keep the two from clobbering each other's *positions* (see the two
 * cursor keys in `runSync`), which is what makes a second transport safe to add
 * at all; they do nothing about that interleaving.
 *
 * A transport that fails does not stop the ones after it. They are independent
 * stores and a laptop being off is not a reason to skip iCloud.
 */
export async function runSyncAll(
  transports: readonly SyncTransport[],
  local: SyncLocal
): Promise<NamedSyncRun[]> {
  const runs: NamedSyncRun[] = [];
  for (const transport of transports) {
    runs.push({ transport: transport.name, result: await runSync(transport, local) });
  }
  return runs;
}

/** What several runs come to, for one status line. */
export interface SyncSummary {
  /** True when at least one transport completed. A skip is not a completion. */
  ok: boolean;
  /** Everything applied, across all of them. */
  applied: ApplyReport;
  pushed: boolean;
  unreadable: number;
  /** The first failure, named by transport. Null when nothing failed. */
  problem: string | null;
  /** Recipe photos written to this device, across every transport (#2704). */
  imagesReceived: number;
  /**
   * The first transport whose photos didn't all go, named like `problem`.
   * Null when they did. Kept apart from `problem` because the rows synced.
   */
  imageProblem: string | null;
}

/**
 * Collapse several runs into the one line a settings screen has room for.
 *
 * A failure is named by its transport because with more than one configured,
 * "Sync failed" is unactionable: the user needs to know whether to check their
 * iCloud account or their own server. With a single transport the name is
 * still there, which is a small price for not having two phrasings.
 */
export function summarizeRuns(runs: readonly NamedSyncRun[]): SyncSummary {
  const applied = emptyApplyReport();
  let ok = false;
  let pushed = false;
  let unreadable = 0;
  let problem: string | null = null;
  let imagesReceived = 0;
  let imageProblem: string | null = null;

  for (const { transport, result } of runs) {
    addReport(applied, result.applied);
    unreadable += result.unreadable;
    imagesReceived += result.imagesReceived;
    if (result.imageProblem && imageProblem === null) imageProblem = `${transport}: ${result.imageProblem}`;
    if (result.pushed) pushed = true;
    if (result.status === 'ok') ok = true;
    if (result.status === 'failed' && problem === null) {
      problem = `${transport}: ${result.reason ?? 'Sync failed.'}`;
    }
  }

  return { ok, applied, pushed, unreadable, problem, imagesReceived, imageProblem };
}
