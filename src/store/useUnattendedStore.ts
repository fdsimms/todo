import { create } from 'zustand';
import type { GeneratedKind, Task, UnattendedAction, UnattendedEntry } from '../types';
import {
  dbClearUnattendedLog,
  dbGetUnattendedLog,
  dbInsertUnattendedEntries,
  dbPruneUnattendedLog,
} from '../db/database';
import { generateId } from '../utils/id';
import { ledgerCutoff, selectPurgeableUnattendedIds } from '../utils/retention';
import { useSettingsStore } from './useSettingsStore';

/**
 * The write half of the unattended ledger — see `src/utils/unattendedLedger.ts`
 * for what an entry is and `UnattendedEntry` in types for the three rules
 * deciding what gets one.
 *
 * Its own store rather than a slice of `useTaskStore`, for the reason
 * `useMilestoneStore` is its own: append-only rows with their own lifecycle
 * that nothing else points at. Keeping it separate also keeps the recording
 * call one line at each of the four sites that make one, rather than another
 * concern threaded through the task store's own actions.
 *
 * **Recording never throws into the pass that called it.** Every caller is an
 * unattended sweep running inside `runStartupSequence`'s try/catch, and a
 * ledger that could fail a generator would be a bookkeeping feature breaking
 * the thing it books. The db write is wrapped for that reason alone: an entry
 * lost is a line missing from a screen, an entry that throws is a task that
 * never got written.
 */

/** What a caller hands over. The id and the timestamp are this store's to set. */
export interface UnattendedRecord {
  action: UnattendedAction;
  kind: GeneratedKind | null;
  title: string;
  taskId: string | null;
  /** Rows accounted for. Omitted means one. */
  count?: number;
}

interface UnattendedStore {
  entries: UnattendedEntry[];
  initialized: boolean;
  initialize: () => void;
  /** Append one entry. */
  record: (entry: UnattendedRecord) => void;
  /** Append several under one transaction — the two sweeps' path. */
  recordMany: (entries: readonly UnattendedRecord[]) => void;
  /** Record a generated task appearing, read straight off the row that was written. */
  recordGenerated: (action: 'created' | 'cleared', task: Pick<Task, 'id' | 'title' | 'generatedKind'>) => void;
  /** Drop entries past the ledger's own bound. Runs at launch, never in the background. */
  purgeOldEntries: () => number;
  /** Empty it, for the screen's own action. */
  clearAll: () => void;
}

function toEntries(records: readonly UnattendedRecord[]): UnattendedEntry[] {
  const at = new Date().toISOString();
  return records.map(r => ({
    id: generateId(),
    at,
    action: r.action,
    kind: r.kind,
    title: r.title,
    taskId: r.taskId,
    count: r.count ?? 1,
  }));
}

export const useUnattendedStore = create<UnattendedStore>((set, get) => ({
  entries: [],
  initialized: false,

  initialize() {
    set({ entries: dbGetUnattendedLog(), initialized: true });
  },

  record(entry) {
    get().recordMany([entry]);
  },

  recordMany(records) {
    if (records.length === 0) return;
    const entries = toEntries(records);
    try {
      dbInsertUnattendedEntries(entries);
    } catch {
      // See the note above: a ledger write may not take a generator down with
      // it. Swallowed rather than logged because the callers run unattended and
      // there is nobody to read a log line.
      return;
    }
    // Newest first, matching what dbGetUnattendedLog hands back next launch —
    // a list that reorders itself on relaunch is the usual way one of these
    // drifts out of step with its own store.
    set({ entries: [...entries].reverse().concat(get().entries) });
  },

  // A row's own `generatedKind` rather than the caller's, so an entry can never
  // name a generator the task doesn't actually belong to. A row with no kind is
  // not a generated task and gets no entry: the two sweeps record themselves.
  recordGenerated(action, task) {
    if (task.generatedKind === null) return;
    get().record({ action, kind: task.generatedKind, title: task.title, taskId: task.id });
  },

  purgeOldEntries() {
    const { completedRetentionDays, dayResetTime } = useSettingsStore.getState();
    const cutoff = ledgerCutoff(completedRetentionDays, new Date(), dayResetTime);
    const doomed = new Set(selectPurgeableUnattendedIds(get().entries, cutoff));
    if (doomed.size === 0) return 0;
    // By date rather than by the ids just collected, the same call
    // `purgeHistoryBefore` makes: this store's copy is what was loaded at
    // launch, and an entry synced in from another device since is equally out
    // of the window. The in-memory filter only has to agree about what it sees.
    dbPruneUnattendedLog(cutoff.toISOString());
    set({ entries: get().entries.filter(e => !doomed.has(e.id)) });
    return doomed.size;
  },

  clearAll() {
    dbClearUnattendedLog();
    set({ entries: [] });
  },
}));
