import { createSyncGate } from '../syncGate';

/** A sync that stays running until the test lets it finish. */
function controllableSync() {
  const finishers: (() => void)[] = [];
  let running = 0;
  let maxRunning = 0;
  const sync = jest.fn(() => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    return new Promise<void>(resolve => {
      finishers.push(() => {
        running--;
        resolve();
      });
    });
  });
  const finishNext = async () => {
    finishers.shift()?.();
    // Let the gate's own `.then` bookkeeping run.
    await new Promise(r => setImmediate(r));
  };
  return { sync, finishNext, maxRunning: () => maxRunning };
}

const tick = () => new Promise(r => setImmediate(r));

describe('fresh', () => {
  it('syncs on the first read', async () => {
    const sync = jest.fn(async () => {});
    await createSyncGate(sync, 10_000).fresh();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('does not sync again within the throttle', async () => {
    let t = 0;
    const sync = jest.fn(async () => {});
    const gate = createSyncGate(sync, 10_000, () => t);
    await gate.fresh();
    t = 9_000;
    await gate.fresh();
    expect(sync).toHaveBeenCalledTimes(1);
    t = 10_001;
    await gate.fresh();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  // The bug: a first sync longer than the throttle let the next read start a
  // second run beside it.
  it('waits out a run in flight rather than starting a second beside it', async () => {
    let t = 0;
    const s = controllableSync();
    const gate = createSyncGate(s.sync, 10_000, () => t);

    const first = gate.fresh();
    await tick();
    t = 60_000;
    let secondDone = false;
    const second = gate.fresh().then(() => { secondDone = true; });
    await tick();

    expect(s.sync).toHaveBeenCalledTimes(1);
    expect(secondDone).toBe(false);

    await s.finishNext();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(s.sync).toHaveBeenCalledTimes(1);
    expect(s.maxRunning()).toBe(1);
  });

  it('answers anyway when the sync fails, and reports the failure', async () => {
    const onError = jest.fn();
    const gate = createSyncGate(async () => { throw new Error('store down'); }, 10_000, Date.now, onError);
    await expect(gate.fresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'store down' }));
  });
});

describe('afterWrite', () => {
  it('ignores the throttle', async () => {
    const sync = jest.fn(async () => {});
    const gate = createSyncGate(sync, 10_000, () => 0);
    await gate.fresh();
    await gate.afterWrite();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('queues its own run behind one in flight, never overlapping it', async () => {
    const s = controllableSync();
    const gate = createSyncGate(s.sync, 10_000);

    const read = gate.fresh();
    await tick();
    const write = gate.afterWrite();
    await tick();
    // The run in flight read the database before the write, so the write
    // needs a run of its own, and that run waits for the first to finish.
    expect(s.sync).toHaveBeenCalledTimes(1);

    await s.finishNext();
    await read;
    expect(s.sync).toHaveBeenCalledTimes(2);

    await s.finishNext();
    await write;
    expect(s.maxRunning()).toBe(1);
  });

  it('leaves nothing in flight once the queue drains, so the throttle applies again', async () => {
    let t = 0;
    const sync = jest.fn(async () => {});
    const gate = createSyncGate(sync, 10_000, () => t);
    await gate.afterWrite();
    await tick();
    t = 1_000;
    await gate.fresh();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
