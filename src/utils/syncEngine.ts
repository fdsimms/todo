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
  /**
   * A store that keeps each recipe photo as a file of its own. When present it
   * replaces the base64 photo payloads: the bytes are not inflated a third,
   * the store itself says which photos it holds, and a device fetches only
   * the photos its recipes point at.
   */
  readonly imageStore?: SyncImageStore;
}

/** A transport's per-photo storage, keyed by the photo's filename. */
export interface SyncImageStore {
  /**
   * The photo names added since `since`, and the position to resume from.
   * Opaque and transport-defined, like `PullResult.cursor`; null leaves the
   * stored position alone. A position the store has forgotten answers with
   * every name instead.
   */
  list(since: string | null): Promise<{ names: string[]; removed: string[]; cursor: string | null }>;
  /** Stores a photo's bytes (base64). A name the store already holds is left as it is. */
  put(name: string, base64: string): Promise<void>;
  /** A photo's bytes as base64, or null when the store has nothing under that name. */
  get(name: string): Promise<string | null>;
  /** Deletes a photo. A name the store doesn't hold succeeds. */
  remove(name: string): Promise<void>;
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
  /** Whether a photo's file is already on this device. */
  hasImage?(name: string): boolean;
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

/** The device-local cursor key holding the photo names this device has seen a recipe point at. */
export function imagesKnownKey(transportName: string): string {
  return `${transportName}:imagesKnown`;
}

/** The device-local cursor key holding where this transport's photo listing resumes. */
export function imagesListedKey(transportName: string): string {
  return `${transportName}:imageList`;
}

/**
 * Sends the photos a per-photo store doesn't hold yet. The store is asked what
 * it has rather than this device remembering what it sent, so a photo another
 * device already put there is never uploaded twice, and the same name set
 * (`imagesSentKey`) now means "the store has this".
 *
 * - **The listing is written down before the cursor that covers it**, so a
 *   crash between the two re-lists a window rather than losing one.
 * - **A photo whose file isn't here is skipped, not recorded**, as in
 *   `pushImages`: it may arrive from a peer later.
 */
async function uploadToImageStore(
  transport: SyncTransport,
  store: SyncImageStore,
  local: SyncLocal
): Promise<number> {
  if (!local.imageNames || !local.readImage) return 0;
  const key = imagesSentKey(transport.name);
  const listKey = imagesListedKey(transport.name);
  const has = readNameList(local.getCursor(key));
  const save = () => local.setCursor(key, JSON.stringify([...has]));

  const listed = await store.list(local.getCursor(listKey));
  listed.names.forEach(n => has.add(n));
  // After the names, so a name added and removed in one window ends removed.
  listed.removed.forEach(n => has.delete(n));
  save();
  if (listed.cursor !== null) local.setCursor(listKey, listed.cursor);

  const referenced = new Set(local.imageNames());
  await removeUnreferenced(transport, store, local, referenced, has, save);

  let count = 0;
  for (const name of referenced) {
    if (has.has(name)) continue;
    const data = local.readImage(name);
    if (!data) continue;
    await store.put(name, data);
    has.add(name);
    save();
    count++;
  }
  return count;
}

/**
 * Deletes from the store the photos this device has seen a recipe point at and
 * none does now, and whose file it has already removed.
 *
 * **Only a photo this device itself saw referenced is a candidate.** A name
 * the store holds that no row here points at proves nothing: the row may
 * simply not have arrived yet (a peer pushes its rows and then the photo, and
 * this device can list in between). Deleting on that evidence would take a
 * peer's photo away. A photo seen referenced and then not is one a delete or
 * replacement reached this device, which is what the local file cleanup
 * (`applyWithRecipeImages`) already acts on.
 *
 * **And the file must be gone.** A restored backup can drop rows while their
 * files stay; a photo still on the device is kept in the store.
 */
async function removeUnreferenced(
  transport: SyncTransport,
  store: SyncImageStore,
  local: SyncLocal,
  referenced: ReadonlySet<string>,
  has: Set<string>,
  saveHas: () => void
): Promise<void> {
  if (!local.hasImage) return;
  const knownKey = imagesKnownKey(transport.name);
  const known = readNameList(local.getCursor(knownKey));
  referenced.forEach(n => known.add(n));

  for (const name of [...known]) {
    if (referenced.has(name) || local.hasImage(name)) continue;
    if (has.has(name)) {
      await store.remove(name);
      has.delete(name);
      saveHas();
    }
    known.delete(name);
  }
  local.setCursor(knownKey, JSON.stringify([...known]));
}

/**
 * Fetches the photos the store holds that this device's recipes point at and
 * it doesn't have yet. Run after the rows are applied, so a photo is wanted
 * only once its recipe is here: a recipe a peer deleted leaves a photo nobody
 * downloads.
 */
async function downloadFromImageStore(
  transport: SyncTransport,
  store: SyncImageStore,
  local: SyncLocal
): Promise<number> {
  if (!local.imageNames || !local.hasImage || !local.writeImage) return 0;
  const has = readNameList(local.getCursor(imagesSentKey(transport.name)));
  let count = 0;
  for (const name of local.imageNames()) {
    if (!has.has(name) || local.hasImage(name)) continue;
    const data = await store.get(name);
    if (data && local.writeImage(name, data)) count++;
  }
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
    if (transport.imageStore) {
      imagesSent = await uploadToImageStore(transport, transport.imageStore, local);
    } else if (transport.sendsImages !== false) {
      imagesSent = await pushImages(transport, local, pushWindow);
    }
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

    // After the rows, so the recipes are here to say which photos are wanted.
    if (transport.imageStore) {
      try {
        imagesReceived += await downloadFromImageStore(transport, transport.imageStore, local);
      } catch (e) {
        imageProblem ??= messageOf(e, 'Could not receive recipe photos.');
      }
    }
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
