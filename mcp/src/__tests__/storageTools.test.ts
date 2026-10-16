import { storageReport } from '../storageTools';
import type { Replica } from '../replica';

const task = (id: string, completed: boolean, completedAt: string | null = null, parentId: string | null = null) =>
  ({ id, completed, completedAt, parentId });

const replica = (tasks: unknown[], retention: number | null = null) => ({
  tasks: () => tasks,
  settings: () => ({ completedRetentionDays: retention }),
  storage: () => ({
    databaseBytes: 100_000_000,
    freeBytes: 20_000_000,
    tables: [
      { name: 'tasks', bytes: 60_000_000 },
      { name: 'sync_deletions', bytes: 1_000_000 },
      { name: 'sync_received', bytes: 2_000_000 },
    ],
  }),
}) as unknown as Replica;

describe('storageReport', () => {
  it('counts open and completed top-level tasks and finds the oldest completion', () => {
    const r = storageReport(replica([
      task('a', false), task('s', true, '2026-01-01', 'a'),
      task('b', true, '2026-03-02'), task('c', true, '2026-02-01'),
    ]));
    expect(r.tasks).toEqual({ open: 1, completed: 2, oldestCompletedAt: '2026-02-01' });
  });

  it('says retention is forever when unset, and reports the window when set', () => {
    expect(storageReport(replica([])).completedTasksKeptForDays).toBe('forever');
    expect(storageReport(replica([], 365)).completedTasksKeptForDays).toBe(365);
  });

  it('reports the replica size without its free pages, with areas combined and labelled', () => {
    const r = storageReport(replica([]));
    expect(r.replicaBytes).toBe(80_000_000);
    expect(r.replicaAreas).toEqual([
      { area: 'Tasks', bytes: 60_000_000, size: '60.0 MB' },
      { area: 'Sync records', bytes: 3_000_000, size: '3.0 MB' },
    ]);
    expect(r.note).toMatch(/Settings › Data & reset › Storage/);
  });
});
