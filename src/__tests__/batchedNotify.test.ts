import { createStore } from 'zustand/vanilla';
import { batchNotifications, withBatchedActions } from '../store/batchedNotify';

interface Counter {
  count: number;
  label: string;
  bump: () => number;
  fail: () => void;
}

function makeStore() {
  return createStore<Counter>((set, get, api) => withBatchedActions(api, ['bump', 'fail'], {
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
    const store = makeStore();
    const heard: [number, string, number][] = [];
    store.subscribe((state, prev) => heard.push([state.count, state.label, prev.count]));
    expect(store.getState().bump()).toBe(1);
    expect(heard).toEqual([[1, 'at 1', 0]]);
  });

  it('still tells them at once for a write outside a batched action', () => {
    const store = makeStore();
    const heard: number[] = [];
    store.subscribe(state => heard.push(state.count));
    store.setState({ count: 5 });
    store.setState({ count: 6 });
    expect(heard).toEqual([5, 6]);
  });

  it('tells them what an action wrote before it threw', () => {
    const store = makeStore();
    const heard: number[] = [];
    store.subscribe(state => heard.push(state.count));
    expect(() => store.getState().fail()).toThrow('after the write');
    expect(heard).toEqual([99]);
    store.setState({ count: 1 });
    expect(heard).toEqual([99, 1]);
  });

  it('stops telling a subscriber that has left', () => {
    const store = makeStore();
    const heard: number[] = [];
    const leave = store.subscribe(state => heard.push(state.count));
    leave();
    store.getState().bump();
    expect(heard).toEqual([]);
  });
});

describe('batchNotifications', () => {
  it('waits for the outermost batch, and says nothing when nothing was written', () => {
    const store = createStore<{ n: number }>(() => ({ n: 0 }));
    const batch = batchNotifications(store);
    const heard: number[] = [];
    store.subscribe(state => heard.push(state.n));
    batch(() => {
      batch(() => store.setState({ n: 1 }));
      expect(heard).toEqual([]);
      store.setState({ n: 2 });
    });
    expect(heard).toEqual([2]);
    batch(() => {});
    expect(heard).toEqual([2]);
  });
});
