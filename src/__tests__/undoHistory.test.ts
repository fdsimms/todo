import {
  UNDO_STACK_LIMIT,
  UndoableAction,
  freshest,
  isReplaying,
  popEntry,
  pushEntry,
  redoIsCurrent,
  resetReplayForTests,
  topOf,
  withReplay,
} from '../utils/undoHistory';

const act = (label: string, at?: number): UndoableAction => ({ label, undo: () => {}, at });

afterEach(() => resetReplayForTests());

describe('topOf', () => {
  it('is null on an empty stack', () => {
    expect(topOf([])).toBeNull();
  });

  it('is the last entry pushed', () => {
    expect(topOf([act('a'), act('b')])?.label).toBe('b');
  });
});

describe('pushEntry', () => {
  it('stamps the entry with the time it landed', () => {
    const stack = pushEntry([], act('deleted'), 1000);
    expect(stack[0].at).toBe(1000);
  });

  it('re-stamps rather than keeping an earlier stamp, so a moved entry sorts as current', () => {
    const stack = pushEntry([], { ...act('deleted'), at: 10 }, 1000);
    expect(stack[0].at).toBe(1000);
  });

  it('leaves the source stack alone', () => {
    const before: UndoableAction[] = [];
    pushEntry(before, act('a'), 1);
    expect(before).toHaveLength(0);
  });

  it('drops the oldest entry once the stack is full', () => {
    let stack: UndoableAction[] = [];
    for (let i = 0; i < UNDO_STACK_LIMIT + 5; i++) {
      stack = pushEntry(stack, act(`a${i}`), i);
    }
    expect(stack).toHaveLength(UNDO_STACK_LIMIT);
    expect(stack[0].label).toBe('a5');
    expect(topOf(stack)?.label).toBe(`a${UNDO_STACK_LIMIT + 4}`);
  });
});

describe('popEntry', () => {
  it('drops the top entry', () => {
    expect(popEntry([act('a'), act('b')]).map(e => e.label)).toEqual(['a']);
  });

  it('is safe on an empty stack', () => {
    expect(popEntry([])).toEqual([]);
  });
});

describe('freshest', () => {
  const at = (a: UndoableAction | null) => a?.at;

  it('is null when nothing carries a stamp', () => {
    expect(freshest([null, null], at)).toBeNull();
  });

  it('picks the newest stamp across independent stacks', () => {
    const grocery = act('Cleared the list', 300);
    const task = act('Task deleted', 500);
    const meal = act('Removed "Roast"', 100);
    expect(freshest([grocery, task, meal], at)).toBe(task);
  });

  it('skips unstamped candidates rather than treating them as newest', () => {
    const stamped = act('Task deleted', 5);
    expect(freshest([act('never stamped'), stamped], at)).toBe(stamped);
  });
});

describe('redoIsCurrent', () => {
  it('is false when there is nothing to redo', () => {
    expect(redoIsCurrent(null, [act('Task deleted', 10)])).toBe(false);
  });

  it('is true when nothing has been done since the undo', () => {
    expect(redoIsCurrent(act('Cleared the list', 500), [act('Task deleted', 200), null])).toBe(true);
  });

  // The cross-store half of "a new action discards the redo branch": deleting
  // a task can't reach into the grocery store to clear its redo stack, so the
  // stamps have to answer it.
  it('is false once any store has acted since the undo', () => {
    expect(redoIsCurrent(act('Cleared the list', 500), [act('Task deleted', 900), null])).toBe(false);
  });

  it('survives the store it belongs to being the one that acted first', () => {
    expect(redoIsCurrent(act('Cleared the list', 500), [act('Task deleted', 500)])).toBe(true);
  });
});

describe('withReplay', () => {
  it('reports replaying only while the closure runs', () => {
    expect(isReplaying()).toBe(false);
    withReplay(() => expect(isReplaying()).toBe(true));
    expect(isReplaying()).toBe(false);
  });

  // An undo closure can cascade into another store's undo path, so the inner
  // call must restore the guard rather than lift it.
  it('stays armed through a nested replay', () => {
    withReplay(() => {
      withReplay(() => {});
      expect(isReplaying()).toBe(true);
    });
    expect(isReplaying()).toBe(false);
  });

  it('releases the guard when the closure throws', () => {
    expect(() => withReplay(() => { throw new Error('undo blew up'); })).toThrow('undo blew up');
    expect(isReplaying()).toBe(false);
  });
});
