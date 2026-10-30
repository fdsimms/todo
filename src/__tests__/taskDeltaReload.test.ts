import { mergeTaskDelta } from '../utils/taskDeltaReload';
import { benchBaseTask } from '../__bench__/benchTask';
import type { Task } from '../types';

const task = (id: string, sortOrder: number, extra: Partial<Task> = {}): Task => ({
  ...benchBaseTask,
  id,
  sortOrder,
  createdAt: new Date(2026, 0, 1, 0, 0, sortOrder).toISOString(),
  ...extra,
});

const base = Array.from({ length: 10 }, (_, i) => task(`t${i}`, i));
const ids = (ts: Task[] | null) => ts?.map(t => t.id);

describe('mergeTaskDelta', () => {
  it('keeps unchanged rows by identity and swaps in the changed one', () => {
    const edited = task('t3', 3, { title: 'edited' });
    const out = mergeTaskDelta(base, base.map(t => t.id), [edited])!;
    expect(out[3]).toBe(edited);
    expect(out[4]).toBe(base[4]);
    expect(out).toHaveLength(10);
  });

  it('drops a row the table no longer has', () => {
    const present = base.filter(t => t.id !== 't5').map(t => t.id);
    expect(ids(mergeTaskDelta(base, present, []))).toEqual(present);
  });

  it('adds a new row in table order', () => {
    const added = task('new', 2.5);
    const out = mergeTaskDelta(base, [...base.map(t => t.id), 'new'], [added]);
    expect(ids(out)).toEqual(['t0', 't1', 't2', 'new', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);
  });

  it('re-sorts a row whose sort order moved', () => {
    const moved = task('t0', 99);
    expect(ids(mergeTaskDelta(base, base.map(t => t.id), [moved]))!.slice(-1)).toEqual(['t0']);
  });

  it('asks for a full read when there is nothing in memory', () => {
    expect(mergeTaskDelta([], ['a'], [task('a', 0)])).toBeNull();
  });

  it('asks for a full read when too much changed', () => {
    const changed = base.slice(0, 5).map(t => ({ ...t }));
    expect(mergeTaskDelta(base, base.map(t => t.id), changed)).toBeNull();
  });

  it('asks for a full read when a present row is neither in memory nor changed', () => {
    expect(mergeTaskDelta(base, [...base.map(t => t.id), 'ghost'], [])).toBeNull();
  });
});
