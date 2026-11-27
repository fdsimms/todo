import { createStore } from 'zustand/vanilla';
import { installNotificationBatch, withBatchedActions } from '../utils/storeBatch';

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

interface Tally {
  count: number;
  label: string;
  bump: () => number;
  fail: () => void;
}

function makeTallyStore() {
  return createStore<Tally>((set, get, api) => withBatchedActions(api, ['bump', 'fail'], {
    count: 0,
    label: '',
    bump() {
      set({ count: get().count + 1 });
      set({ label: `at ${get().count}` });
      return get().count;
    },
    fail() {
      set({ count: 99 });
      throw new Error('after the write');
    },
  }));
}

describe('withBatchedActions', () => {
  it('tells subscribers once for an action that writes twice, with the state before it as prev', () => {
    const store = makeTallyStore();
    const heard: [number, string, number][] = [];
    store.subscribe((state, prev) => heard.push([state.count, state.label, prev.count]));
    expect(store.getState().bump()).toBe(1);
    expect(heard).toEqual([[1, 'at 1', 0]]);
  });

  it('still tells them at once for a write outside a batched action', () => {
    const store = makeTallyStore();
    const heard: number[] = [];
    store.subscribe(state => heard.push(state.count));
    store.setState({ count: 5 });
    store.setState({ count: 6 });
    expect(heard).toEqual([5, 6]);
  });

  it('tells them what an action wrote before it threw', () => {
    const store = makeTallyStore();
    const heard: number[] = [];
    store.subscribe(state => heard.push(state.count));
    expect(() => store.getState().fail()).toThrow('after the write');
    expect(heard).toEqual([99]);
    store.setState({ count: 1 });
    expect(heard).toEqual([99, 1]);
  });

  it('stops telling a subscriber that has left', () => {
    const store = makeTallyStore();
    const heard: number[] = [];
    const leave = store.subscribe(state => heard.push(state.count));
    leave();
    store.getState().bump();
    expect(heard).toEqual([]);
  });
});
