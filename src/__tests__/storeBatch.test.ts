import { createStore } from 'zustand/vanilla';
import { installNotificationBatch } from '../utils/storeBatch';

interface Counter { count: number; bump: () => void }

function makeStore() {
  let batch: <T>(fn: () => T) => T = fn => fn();
  const store = createStore<Counter>((set, _get, api) => {
    batch = installNotificationBatch(api);
    return { count: 0, bump: () => set(s => ({ count: s.count + 1 })) };
  });
  return { store, batch: <T>(fn: () => T) => batch(fn) };
}

describe('installNotificationBatch', () => {
  it('leaves an ordinary write as it was: one notification, with the state before it', () => {
    const { store } = makeStore();
    const heard: [number, number][] = [];
    store.subscribe((state, prev) => heard.push([state.count, prev.count]));
    store.getState().bump();
    store.getState().bump();
    expect(heard).toEqual([[1, 0], [2, 1]]);
  });

  it('tells subscribers once for a batch, with the state from before it', () => {
    const { store, batch } = makeStore();
    const heard: [number, number][] = [];
    store.subscribe((state, prev) => heard.push([state.count, prev.count]));
    const seenInside: number[] = [];
    const answer = batch(() => {
      store.getState().bump();
      seenInside.push(store.getState().count);
      store.getState().bump();
      store.getState().bump();
      return 'done';
    });
    expect(answer).toBe('done');
    // Reads inside the batch see each write as it lands.
    expect(seenInside).toEqual([1]);
    expect(heard).toEqual([[3, 0]]);
  });

  it('says nothing for a batch that wrote nothing', () => {
    const { store, batch } = makeStore();
    const listener = jest.fn();
    store.subscribe(listener);
    batch(() => {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('waits for the outermost of nested batches', () => {
    const { store, batch } = makeStore();
    const heard: [number, number][] = [];
    store.subscribe((state, prev) => heard.push([state.count, prev.count]));
    batch(() => {
      store.getState().bump();
      batch(() => store.getState().bump());
      expect(heard).toEqual([]);
    });
    expect(heard).toEqual([[2, 0]]);
  });

  it('still tells subscribers what was written before a throw', () => {
    const { store, batch } = makeStore();
    const heard: [number, number][] = [];
    store.subscribe((state, prev) => heard.push([state.count, prev.count]));
    expect(() => batch(() => {
      store.getState().bump();
      throw new Error('boom');
    })).toThrow('boom');
    expect(heard).toEqual([[1, 0]]);
    // And the store is back to telling each write.
    store.getState().bump();
    expect(heard).toEqual([[1, 0], [2, 1]]);
  });

  it('does not tell a listener that left during the batch', () => {
    const { store, batch } = makeStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    batch(() => {
      store.getState().bump();
      unsubscribe();
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
