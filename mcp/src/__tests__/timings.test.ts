import { createTimingLog, noteWait } from '../timings';

function clock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('timing log', () => {
  it('splits a call into its waits and the rest', async () => {
    const c = clock();
    const log = createTimingLog(10, c.now);
    await log.time('list_tasks', async () => {
      c.advance(30);
      noteWait('sync', 30);
      c.advance(5);
    });
    await log.time('update_task', async () => {
      c.advance(10);
      c.advance(40);
      noteWait('push', 40);
    });
    const { calls } = log.recent();
    expect(calls[0]).toMatchObject({ tool: 'update_task', totalMs: 50, syncWaitMs: 0, pushWaitMs: 40, handlerMs: 10, failed: false });
    expect(calls[1]).toMatchObject({ tool: 'list_tasks', totalMs: 35, syncWaitMs: 30, handlerMs: 5 });
  });

  it('adds up several waits within one call', async () => {
    const c = clock();
    const log = createTimingLog(10, c.now);
    await log.time('x', async () => {
      c.advance(20);
      noteWait('sync', 10);
      noteWait('sync', 10);
    });
    expect(log.recent().calls[0].syncWaitMs).toBe(20);
  });

  it('keeps concurrent calls apart', async () => {
    const c = clock();
    const log = createTimingLog(10, c.now);
    await Promise.all([
      log.time('a', async () => { await Promise.resolve(); noteWait('sync', 7); }),
      log.time('b', async () => { await Promise.resolve(); noteWait('push', 9); }),
    ]);
    const byTool = Object.fromEntries(log.recent().calls.map(s => [s.tool, s]));
    expect(byTool.a).toMatchObject({ syncWaitMs: 7, pushWaitMs: 0 });
    expect(byTool.b).toMatchObject({ syncWaitMs: 0, pushWaitMs: 9 });
  });

  it('records a call that throws, and rethrows', async () => {
    const log = createTimingLog(10, clock().now);
    await expect(log.time('boom', async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(log.recent().calls[0]).toMatchObject({ tool: 'boom', failed: true });
  });

  it('ignores a wait noted outside a timed call', () => {
    expect(() => noteWait('sync', 5)).not.toThrow();
  });

  it('drops the oldest past its cap, filters by tool and ranks tools by average', async () => {
    const c = clock();
    const log = createTimingLog(3, c.now);
    for (const [tool, ms] of [['a', 10], ['b', 100], ['a', 30], ['a', 50]] as const) {
      await log.time(tool, async () => { c.advance(ms); });
    }
    const all = log.recent();
    expect(all.kept).toBe(3);
    expect(all.calls.map(s => s.totalMs)).toEqual([50, 30, 100]);
    expect(all.perTool[0]).toEqual({ tool: 'b', calls: 1, avgMs: 100, maxMs: 100 });
    expect(log.recent({ tool: 'a', limit: 1 }).calls).toHaveLength(1);
  });
});
