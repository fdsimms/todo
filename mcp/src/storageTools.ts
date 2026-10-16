/**
 * What this server can say about how much data the person has stored.
 *
 * Not the size of the phone's database. That file's size (free pages included)
 * is a property of the device and never syncs, so the figures here are this
 * replica's own copy: the same rows, laid out fresh by a sync, which is why
 * `replicaBytes` runs lower than what Settings › Data & reset › Storage shows
 * on the phone. What is the same on both is the row counts, and those are what
 * decide how big the data gets, so the answer leads with them and says where
 * the exact phone figure lives.
 *
 * Read-only. Nothing here deletes or compacts anything: both are the person's
 * call on the phone (a retention window is a promise about their Logbook).
 */
import type { Replica } from './replica';
import { formatBytes, topAreas } from '../../src/utils/storageReport';

export interface StorageReport {
  /** Tasks stored: open, and every completed copy of a repeating task still kept. */
  tasks: { open: number; completed: number; oldestCompletedAt?: string };
  /** Completed copies are deleted past this many days, or kept for ever. */
  completedTasksKeptForDays: number | 'forever';
  /** The largest areas of this replica's copy, as sizes in bytes and a readable form. Empty when the build can't say. */
  replicaAreas: { area: string; bytes: number; size: string }[];
  replicaBytes: number;
  note: string;
}

export function storageReport(replica: Replica): StorageReport {
  const tasks = replica.tasks().filter(t => !t.parentId);
  const completed = tasks.filter(t => t.completed);
  const oldest = completed
    .map(t => t.completedAt)
    .filter((d): d is string => !!d)
    .sort()[0];
  const stats = replica.storage();
  const retention = replica.settings().completedRetentionDays;
  return {
    tasks: {
      open: tasks.length - completed.length,
      completed: completed.length,
      ...(oldest ? { oldestCompletedAt: oldest } : {}),
    },
    completedTasksKeptForDays: retention ?? 'forever',
    replicaAreas: topAreas(stats.tables, 8).map(a => ({ area: a.label, bytes: a.bytes, size: formatBytes(a.bytes) })),
    replicaBytes: stats.databaseBytes - stats.freeBytes,
    note: 'Sizes are this server\'s copy of the data, not the phone\'s file, which also holds space left by deleted rows and the recipe photos. The exact figure is under Settings › Data & reset › Storage on the phone, and the person compacts it there. Do not delete tasks or change the retention window to save space unless they ask: completed copies are their history.',
  };
}
