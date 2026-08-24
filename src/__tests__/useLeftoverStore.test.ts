import { useLeftoverStore } from '../store/useLeftoverStore';
import {
  dbGetAllLeftovers,
  dbInsertLeftover,
  dbUpdateLeftover,
  dbDeleteLeftover,
  dbPurgeOldLeftovers,
} from '../db/database';
import type { Leftover, Task } from '../types';
import { daysInFridge, isLiveLeftover, keepDaysBetween, needsAttention } from '../utils/leftovers';

jest.mock('../db/database', () => ({
  dbGetAllLeftovers: jest.fn().mockReturnValue([]),
  dbInsertLeftover: jest.fn(),
  dbUpdateLeftover: jest.fn(),
  dbDeleteLeftover: jest.fn(),
  dbPurgeOldLeftovers: jest.fn().mockReturnValue(0),
}));

// The store reaches utils/leftovers → dateUtils → the settings store, for
// dayResetTime a calendar day key doesn't use — and now reconcileLeftoverTask
// reaches it directly for leftoverUseUpTasks/leftoverUseUpTaskCategory. Off
// by default here (unlike the real default) so a bare seed/logLeftover in a
// test that isn't about use-up tasks doesn't start spawning them; the
// use-up-task describe block below flips it on per test.
let mockLeftoverUseUpTasks = false;
let mockLeftoverUseUpTaskCategory: string | null = null;
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      dayResetTime: '00:00',
      get leftoverUseUpTasks() { return mockLeftoverUseUpTasks; },
      get leftoverUseUpTaskCategory() { return mockLeftoverUseUpTaskCategory; },
    }),
  },
}));

// Same shape as useGroceryStore.test.ts's mockTaskState: reconcileLeftoverTask
// reaches useTaskStore directly, so it needs a task list to read and write.
const mockTaskState = {
  tasks: [] as Task[],
  addTask: (draft: Partial<Task>) => {
    const task = { id: `t-${mockTaskState.tasks.length + 1}`, completed: false, archived: false, ...draft } as Task;
    mockTaskState.tasks.push(task);
    return task;
  },
  updateTask: (id: string, updates: Partial<Task>) => {
    mockTaskState.tasks = mockTaskState.tasks.map(t => (t.id === id ? { ...t, ...updates } : t));
  },
  deleteTask: (id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.filter(t => t.id !== id);
  },
  setLastAction: jest.fn(),
};
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => mockTaskState },
}));

let seq = 0;
function makeLeftover(overrides: Partial<Leftover> = {}): Leftover {
  seq += 1;
  return {
    id: `lo-${seq}`,
    title: 'Chilli',
    recipeId: null,
    sourceEntryId: null,
    storedAt: '2026-08-10T09:00:00.000Z',
    keepUntil: '2026-08-13',
    finishedAt: null,
    outcome: null,
    frozenAt: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    useUpTask: null,
    ...overrides,
  };
}

function seed(leftovers: Leftover[]) {
  useLeftoverStore.setState({ leftovers, initialized: true, lastAction: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllLeftovers as jest.Mock).mockReturnValue([]);
  (dbPurgeOldLeftovers as jest.Mock).mockReturnValue(0);
  mockLeftoverUseUpTasks = false;
  mockLeftoverUseUpTaskCategory = null;
  mockTaskState.tasks = [];
  seed([]);
});

describe('initialize', () => {
  it('loads what the db holds', () => {
    const chilli = makeLeftover();
    (dbGetAllLeftovers as jest.Mock).mockReturnValue([chilli]);

    useLeftoverStore.getState().initialize();

    expect(useLeftoverStore.getState().leftovers).toEqual([chilli]);
    expect(useLeftoverStore.getState().initialized).toBe(true);
  });

  it('sorts by urgency rather than trusting the row order', () => {
    const later = makeLeftover({ id: 'later', keepUntil: '2026-08-20' });
    const sooner = makeLeftover({ id: 'sooner', keepUntil: '2026-08-14' });
    (dbGetAllLeftovers as jest.Mock).mockReturnValue([later, sooner]);

    useLeftoverStore.getState().initialize();

    expect(useLeftoverStore.getState().leftovers.map(l => l.id)).toEqual(['sooner', 'later']);
  });

  it('clears a pending use-up prompt — session-only, nothing to mean on a fresh load', () => {
    useLeftoverStore.setState({ pendingUseUpLeftoverId: 'l-1' });
    useLeftoverStore.getState().initialize();
    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBeNull();
  });

  it('clears a pending finish-leftovers prompt too', () => {
    useLeftoverStore.setState({ pendingFinishLeftoverId: 'l-1' });
    useLeftoverStore.getState().initialize();
    expect(useLeftoverStore.getState().pendingFinishLeftoverId).toBeNull();
  });
});

describe('setPendingUseUpLeftover', () => {
  it('is what UseUpResolveSheet watches to open on the right leftover', () => {
    useLeftoverStore.getState().setPendingUseUpLeftover('l-1');
    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBe('l-1');

    useLeftoverStore.getState().setPendingUseUpLeftover(null);
    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBeNull();
  });
});

describe('setPendingFinishLeftover', () => {
  it('is what FinishLeftoverPrompt watches to ask about the right leftover', () => {
    useLeftoverStore.getState().setPendingFinishLeftover('l-1');
    expect(useLeftoverStore.getState().pendingFinishLeftoverId).toBe('l-1');

    useLeftoverStore.getState().setPendingFinishLeftover(null);
    expect(useLeftoverStore.getState().pendingFinishLeftoverId).toBeNull();
  });
});

describe('logLeftover', () => {
  it('logs a container starting today, live and with the default window', () => {
    const logged = useLeftoverStore.getState().logLeftover({ title: '  Sausage   ragù ' })!;

    expect(logged.title).toBe('Sausage ragù');
    expect(logged.finishedAt).toBeNull();
    expect(logged.outcome).toBeNull();
    expect(logged.recipeId).toBeNull();
    expect(logged.sourceEntryId).toBeNull();
    expect(dbInsertLeftover).toHaveBeenCalledTimes(1);
    expect(useLeftoverStore.getState().leftovers).toHaveLength(1);
  });

  it('resolves the keep-for window against the stored instant, not against now', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Dal',
      storedAt: new Date(2026, 7, 10, 18, 0).toISOString(),
      keepDays: 4,
    })!;

    expect(logged.keepUntil).toBe('2026-08-14');
  });

  it('carries the recipe and the meal it came from', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Ragu',
      recipeId: 'r-1',
      sourceEntryId: 'e-1',
    })!;

    expect(logged.recipeId).toBe('r-1');
    expect(logged.sourceEntryId).toBe('e-1');
  });

  it('refuses a blank title', () => {
    expect(useLeftoverStore.getState().logLeftover({ title: '   ' })).toBeNull();
    expect(dbInsertLeftover).not.toHaveBeenCalled();
  });

  it('goes in the fridge unless the draft says otherwise', () => {
    expect(useLeftoverStore.getState().logLeftover({ title: 'Chilli' })!.frozenAt).toBeNull();
    expect(useLeftoverStore.getState().logLeftover({ title: 'Chilli', frozen: false })!.frozenAt)
      .toBeNull();
  });

  it('stamps a frozen container from its put-away instant, not from now', () => {
    const storedAt = new Date(2026, 7, 10, 18, 0).toISOString();
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt,
      keepDays: 4,
      frozen: true,
    })!;

    expect(logged.frozenAt).toBe(storedAt);
    // The window it was given is still on the row, ready for the thaw to hand
    // it back — freezing suspends the countdown, it doesn't clear it.
    expect(logged.keepUntil).toBe('2026-08-14');
    expect(isLiveLeftover(logged)).toBe(true);
    expect(needsAttention(logged)).toBe(false);
  });

  // The log sheet's "Both": two containers out of one cooking, one per place,
  // each with its own clock. The store sees them as two ordinary drafts.
  it('takes a fridge and a freezer container of the same dish', () => {
    const storedAt = new Date(2026, 7, 10, 18, 0).toISOString();
    const fridge = useLeftoverStore.getState().logLeftover({ title: 'Ragù', storedAt })!;
    const freezer = useLeftoverStore.getState().logLeftover({ title: 'Ragù', storedAt, frozen: true })!;

    expect(fridge.id).not.toBe(freezer.id);
    expect(fridge.frozenAt).toBeNull();
    expect(freezer.frozenAt).toBe(storedAt);
    expect(useLeftoverStore.getState().leftovers).toHaveLength(2);
  });

  // #1322: the sheet logs one draft per part the user ticked, so a composed
  // meal leaves several independent containers that happen to share a cooking.
  it('keeps the parts of one meal apart, each pointing at its own recipe', () => {
    const storedAt = new Date(2026, 7, 12, 18, 0).toISOString();
    const whole = useLeftoverStore.getState().logLeftover({
      title: 'Steak with mashed potatoes', storedAt, keepDays: 3, recipeId: 'r-steak', sourceEntryId: 'e-1',
    })!;
    const part = useLeftoverStore.getState().logLeftover({
      title: 'Mashed potatoes', storedAt, keepDays: 3, recipeId: 'r-mash', sourceEntryId: 'e-1',
    })!;

    expect(whole.id).not.toBe(part.id);
    expect([whole.recipeId, part.recipeId]).toEqual(['r-steak', 'r-mash']);
    // The parent isn't recorded on the part — the cooking it came from is.
    expect([whole.sourceEntryId, part.sourceEntryId]).toEqual(['e-1', 'e-1']);
    expect(useLeftoverStore.getState().leftovers).toHaveLength(2);
  });

  // One clock each, even though they went in together: finishing the mash on
  // Thursday must leave the steak alone.
  it('gives each part its own row to finish', () => {
    const storedAt = new Date(2026, 7, 12, 18, 0).toISOString();
    const whole = useLeftoverStore.getState().logLeftover({ title: 'Steak', storedAt, sourceEntryId: 'e-1' })!;
    const part = useLeftoverStore.getState().logLeftover({ title: 'Mash', storedAt, sourceEntryId: 'e-1' })!;

    useLeftoverStore.getState().finishLeftover(part.id, 'eaten');

    const rows = useLeftoverStore.getState().leftovers;
    expect(rows.find(l => l.id === part.id)!.finishedAt).not.toBeNull();
    expect(rows.find(l => l.id === whole.id)!.finishedAt).toBeNull();
  });

  it('allows a second container of the same dish — the name is not the identity', () => {
    useLeftoverStore.getState().logLeftover({ title: 'Chilli' });
    const second = useLeftoverStore.getState().logLeftover({ title: 'Chilli' });

    expect(second).not.toBeNull();
    expect(useLeftoverStore.getState().leftovers).toHaveLength(2);
  });
});

describe('renameLeftover', () => {
  it('renames and persists', () => {
    seed([makeLeftover({ id: 'lo-a' })]);

    expect(useLeftoverStore.getState().renameLeftover('lo-a', '  Beef   chilli ')).toBe(true);
    expect(useLeftoverStore.getState().leftovers[0].title).toBe('Beef chilli');
    expect(dbUpdateLeftover).toHaveBeenCalledTimes(1);
  });

  it('refuses a blank name and an id that is not there', () => {
    seed([makeLeftover({ id: 'lo-a' })]);

    expect(useLeftoverStore.getState().renameLeftover('lo-a', '   ')).toBe(false);
    expect(useLeftoverStore.getState().renameLeftover('nope', 'Anything')).toBe(false);
    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });

  it('does not refuse a name another container already has', () => {
    seed([makeLeftover({ id: 'lo-a', title: 'Chilli' }), makeLeftover({ id: 'lo-b', title: 'Dal' })]);

    expect(useLeftoverStore.getState().renameLeftover('lo-b', 'Chilli')).toBe(true);
  });
});

describe('setStoredAt', () => {
  it('carries the keep-for window with the corrected put-away day', () => {
    // Made on the 10th, keep 3 days → the 13th. "Actually I made it on the 9th"
    // has to mean the 12th, not a silently shortened 2-day window.
    seed([makeLeftover({
      id: 'lo-a',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepUntil: '2026-08-13',
    })]);

    useLeftoverStore.getState().setStoredAt('lo-a', new Date(2026, 7, 9, 9, 0).toISOString());

    expect(useLeftoverStore.getState().leftovers[0].keepUntil).toBe('2026-08-12');
  });

  it('ignores an id that is not there', () => {
    useLeftoverStore.getState().setStoredAt('nope', new Date().toISOString());
    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });
});

describe('setKeepDays', () => {
  it('re-resolves against the row\'s own stored instant', () => {
    seed([makeLeftover({
      id: 'lo-a',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepUntil: '2026-08-13',
    })]);

    useLeftoverStore.getState().setKeepDays('lo-a', 6);

    expect(useLeftoverStore.getState().leftovers[0].keepUntil).toBe('2026-08-16');
    expect(dbUpdateLeftover).toHaveBeenCalledTimes(1);
  });

  it('clamps a window a restored backup could carry', () => {
    seed([makeLeftover({ id: 'lo-a', storedAt: new Date(2026, 7, 10, 9, 0).toISOString() })]);

    useLeftoverStore.getState().setKeepDays('lo-a', -5);

    expect(useLeftoverStore.getState().leftovers[0].keepUntil).toBe('2026-08-10');
  });

  it('re-sorts, so a shortened window moves to the top of the fridge', () => {
    seed([
      makeLeftover({ id: 'soon', storedAt: new Date(2026, 7, 10, 9, 0).toISOString(), keepUntil: '2026-08-13' }),
      makeLeftover({ id: 'later', storedAt: new Date(2026, 7, 10, 9, 0).toISOString(), keepUntil: '2026-08-20' }),
    ]);

    useLeftoverStore.getState().setKeepDays('later', 1);

    expect(useLeftoverStore.getState().leftovers.map(l => l.id)).toEqual(['later', 'soon']);
  });
});

describe('setFrozen', () => {
  it('stamps the instant and leaves the stored keep-until alone', () => {
    seed([makeLeftover({ id: 'lo-a', keepUntil: '2026-08-13' })]);

    useLeftoverStore.getState().setFrozen('lo-a', true);

    const updated = useLeftoverStore.getState().leftovers[0];
    expect(updated.frozenAt).not.toBeNull();
    // Suspended, not cleared: the window is what the thaw hands back.
    expect(updated.keepUntil).toBe('2026-08-13');
  });

  it('does not close the container out — a frozen portion is still in the kitchen', () => {
    seed([makeLeftover({ id: 'lo-a' })]);

    useLeftoverStore.getState().setFrozen('lo-a', true);

    expect(useLeftoverStore.getState().leftovers[0].finishedAt).toBeNull();
    expect(useLeftoverStore.getState().leftovers[0].outcome).toBeNull();
  });

  // The whole window rather than the days that were left: freezing arrests the
  // spoiling the window is about, so it restarts rather than resumes.
  it('hands back the same keep-for window, measured from the thaw', () => {
    seed([makeLeftover({
      id: 'lo-a',
      storedAt: new Date(2026, 4, 1, 9, 0).toISOString(),
      keepUntil: '2026-05-05',
      frozenAt: new Date(2026, 4, 2, 9, 0).toISOString(),
    })]);

    useLeftoverStore.getState().setFrozen('lo-a', false);

    const updated = useLeftoverStore.getState().leftovers[0];
    expect(updated.frozenAt).toBeNull();
    // Four days from now, not four days from a May that has long gone.
    expect(keepDaysBetween(updated.storedAt, updated.keepUntil)).toBe(4);
    expect(daysInFridge(updated)).toBe(0);
  });

  it('is a no-op when the container is already in that state', () => {
    seed([makeLeftover({ id: 'lo-a', frozenAt: new Date(2026, 4, 2, 9, 0).toISOString() })]);

    useLeftoverStore.getState().setFrozen('lo-a', true);

    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useLeftoverStore.getState().setFrozen('gone', true);
    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });
});

describe('splitLeftover', () => {
  it('writes a second row on the opposite side, leaving the original untouched', () => {
    const original = makeLeftover({
      id: 'lo-a',
      title: 'Chilli',
      recipeId: 'r1',
      sourceEntryId: 'e1',
      storedAt: '2026-08-10T09:00:00.000Z',
      keepUntil: '2026-08-13',
    });
    seed([original]);

    const copy = useLeftoverStore.getState().splitLeftover('lo-a')!;

    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Chilli');
    expect(copy.recipeId).toBe('r1');
    expect(copy.sourceEntryId).toBe('e1');
    expect(copy.frozenAt).toBe(copy.storedAt);
    const leftovers = useLeftoverStore.getState().leftovers;
    expect(leftovers).toHaveLength(2);
    expect(leftovers.find(l => l.id === 'lo-a')).toEqual(original);
  });

  // The whole point: a pot logged whole on Sunday and split on Tuesday keeps
  // the two fridge days it already spent, rather than restarting from now.
  it('stamps the copy from the original\'s own storedAt, not now', () => {
    seed([makeLeftover({ id: 'lo-a', storedAt: '2026-08-10T09:00:00.000Z', keepUntil: '2026-08-13' })]);

    const copy = useLeftoverStore.getState().splitLeftover('lo-a')!;

    expect(copy.storedAt).toBe('2026-08-10T09:00:00.000Z');
    expect(copy.frozenAt).toBe('2026-08-10T09:00:00.000Z');
    // The same window the original was given, not the days remaining.
    expect(keepDaysBetween(copy.storedAt, copy.keepUntil)).toBe(3);
  });

  it('freezes the copy of a fridge container, and fridges the copy of a frozen one', () => {
    seed([makeLeftover({ id: 'lo-fridge', frozenAt: null })]);
    const frozenCopy = useLeftoverStore.getState().splitLeftover('lo-fridge')!;
    expect(frozenCopy.frozenAt).not.toBeNull();

    seed([makeLeftover({ id: 'lo-freezer', frozenAt: '2026-08-11T09:00:00.000Z' })]);
    const fridgeCopy = useLeftoverStore.getState().splitLeftover('lo-freezer')!;
    expect(fridgeCopy.frozenAt).toBeNull();
  });

  it('refuses a closed-out container', () => {
    seed([makeLeftover({ id: 'lo-a', finishedAt: '2026-08-12T09:00:00.000Z', outcome: 'eaten' })]);

    const result = useLeftoverStore.getState().splitLeftover('lo-a');

    expect(result).toBeNull();
    expect(useLeftoverStore.getState().leftovers).toHaveLength(1);
    expect(dbInsertLeftover).not.toHaveBeenCalled();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    const result = useLeftoverStore.getState().splitLeftover('gone');
    expect(result).toBeNull();
    expect(dbInsertLeftover).not.toHaveBeenCalled();
  });
});

describe('finishLeftover', () => {
  it('stamps the instant and records which ending it got', () => {
    seed([makeLeftover({ id: 'lo-a' })]);

    useLeftoverStore.getState().finishLeftover('lo-a', 'eaten');

    const stored = useLeftoverStore.getState().leftovers[0];
    expect(stored.finishedAt).not.toBeNull();
    expect(stored.outcome).toBe('eaten');
    expect(dbUpdateLeftover).toHaveBeenCalledTimes(1);
  });

  it('records a bin as a bin', () => {
    seed([makeLeftover({ id: 'lo-a' })]);
    useLeftoverStore.getState().finishLeftover('lo-a', 'tossed');
    expect(useLeftoverStore.getState().leftovers[0].outcome).toBe('tossed');
  });

  it('is idempotent — a second call does not restamp', () => {
    seed([makeLeftover({ id: 'lo-a', finishedAt: '2026-08-11T18:00:00.000Z', outcome: 'eaten' })]);

    useLeftoverStore.getState().finishLeftover('lo-a', 'tossed');

    expect(useLeftoverStore.getState().leftovers[0].finishedAt).toBe('2026-08-11T18:00:00.000Z');
    expect(useLeftoverStore.getState().leftovers[0].outcome).toBe('eaten');
    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });

  it('ignores an id that is not there', () => {
    useLeftoverStore.getState().finishLeftover('nope', 'eaten');
    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });

  it('registers an undoable action whose undo reopens the leftover', () => {
    seed([makeLeftover({ id: 'lo-a', title: 'Chilli' })]);

    useLeftoverStore.getState().finishLeftover('lo-a', 'eaten');

    const action = useLeftoverStore.getState().lastAction;
    expect(action?.label).toBe('Finished "Chilli"');
    expect(action?.destructive).toBeUndefined();

    action!.undo();

    expect(useLeftoverStore.getState().leftovers[0].finishedAt).toBeNull();
  });

  it('labels a bin differently from a finish', () => {
    seed([makeLeftover({ id: 'lo-a', title: 'Chilli' })]);
    useLeftoverStore.getState().finishLeftover('lo-a', 'tossed');
    expect(useLeftoverStore.getState().lastAction?.label).toBe('Threw out "Chilli"');
  });
});

describe('reopenLeftover', () => {
  it('puts a mis-tapped close-out back in the fridge, clearing both columns', () => {
    seed([makeLeftover({ id: 'lo-a', finishedAt: '2026-08-11T18:00:00.000Z', outcome: 'eaten' })]);

    useLeftoverStore.getState().reopenLeftover('lo-a');

    expect(useLeftoverStore.getState().leftovers[0].finishedAt).toBeNull();
    expect(useLeftoverStore.getState().leftovers[0].outcome).toBeNull();
  });

  it('no-ops on something already live', () => {
    seed([makeLeftover({ id: 'lo-a' })]);
    useLeftoverStore.getState().reopenLeftover('lo-a');
    expect(dbUpdateLeftover).not.toHaveBeenCalled();
  });
});

describe('deleteLeftover', () => {
  it('drops the row', () => {
    seed([makeLeftover({ id: 'lo-a' }), makeLeftover({ id: 'lo-b' })]);

    useLeftoverStore.getState().deleteLeftover('lo-a');

    expect(dbDeleteLeftover).toHaveBeenCalledWith('lo-a');
    expect(useLeftoverStore.getState().leftovers.map(l => l.id)).toEqual(['lo-b']);
  });

  it('registers a destructive undo that restores the row', () => {
    seed([makeLeftover({ id: 'lo-a', title: 'Chilli' })]);

    useLeftoverStore.getState().deleteLeftover('lo-a');

    const action = useLeftoverStore.getState().lastAction;
    expect(action?.label).toBe('Deleted "Chilli"');
    expect(action?.destructive).toBe(true);

    action!.undo();

    expect(dbInsertLeftover).toHaveBeenCalledWith(expect.objectContaining({ id: 'lo-a' }));
    expect(useLeftoverStore.getState().leftovers.map(l => l.id)).toEqual(['lo-a']);
  });

  it('registers nothing when the id was not there to begin with', () => {
    useLeftoverStore.getState().deleteLeftover('nope');
    expect(useLeftoverStore.getState().lastAction).toBeNull();
  });
});

describe('purgeOldLeftovers', () => {
  it('returns zero and touches nothing when the db took nothing', () => {
    seed([makeLeftover({ id: 'lo-a' })]);

    expect(useLeftoverStore.getState().purgeOldLeftovers()).toBe(0);
    expect(useLeftoverStore.getState().leftovers).toHaveLength(1);
  });

  it('drops the closed-out rows the db took, and keeps every live one however old', () => {
    (dbPurgeOldLeftovers as jest.Mock).mockReturnValue(1);
    const ancientButLive = makeLeftover({ id: 'live', storedAt: '2020-01-01T00:00:00.000Z' });
    const longFinished = makeLeftover({
      id: 'gone',
      finishedAt: '2020-01-02T00:00:00.000Z',
      outcome: 'eaten',
    });
    const justFinished = makeLeftover({
      id: 'kept',
      finishedAt: new Date().toISOString(),
      outcome: 'eaten',
    });
    seed([ancientButLive, longFinished, justFinished]);

    expect(useLeftoverStore.getState().purgeOldLeftovers()).toBe(1);
    expect(useLeftoverStore.getState().leftovers.map(l => l.id).sort())
      .toEqual(['kept', 'live']);
  });
});

describe('use-up tasks', () => {
  beforeEach(() => {
    mockLeftoverUseUpTasks = true;
  });

  it('spawns a task when a logged leftover already needs attention', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepDays: 0,
    })!;

    const task = mockTaskState.tasks.find(t => t.generatedSourceId === logged.id);
    expect(task).toBeDefined();
    expect(task!.title).toBe('Use up Chilli');
    expect(task!.deadline).toBe(logged.keepUntil);
  });

  it('drops the task when the leftover is finished', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepDays: 0,
    })!;
    expect(mockTaskState.tasks.some(t => t.generatedSourceId === logged.id)).toBe(true);

    useLeftoverStore.getState().finishLeftover(logged.id, 'eaten');

    expect(mockTaskState.tasks.some(t => t.generatedSourceId === logged.id)).toBe(false);
  });

  it('drops the task when the leftover is deleted', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepDays: 0,
    })!;

    useLeftoverStore.getState().deleteLeftover(logged.id);

    expect(mockTaskState.tasks.some(t => t.generatedSourceId === logged.id)).toBe(false);
  });

  it('undoing a delete brings a still-live use-up task back', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepDays: 0,
    })!;

    useLeftoverStore.getState().deleteLeftover(logged.id);
    useLeftoverStore.getState().lastAction!.undo();

    expect(mockTaskState.tasks.some(t => t.generatedSourceId === logged.id)).toBe(true);
  });

  it('undoing a delete does not resurrect a finished leftover\'s use-up task', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepDays: 0,
    })!;
    useLeftoverStore.getState().finishLeftover(logged.id, 'eaten');

    useLeftoverStore.getState().deleteLeftover(logged.id);
    useLeftoverStore.getState().lastAction!.undo();

    expect(mockTaskState.tasks.some(t => t.generatedSourceId === logged.id)).toBe(false);
  });

  it('honors a per-leftover opt-out even with the setting on', () => {
    const logged = useLeftoverStore.getState().logLeftover({
      title: 'Chilli',
      storedAt: new Date(2026, 7, 10, 9, 0).toISOString(),
      keepDays: 0,
    })!;
    useLeftoverStore.getState().setUseUpTask(logged.id, false);

    expect(mockTaskState.tasks.some(t => t.generatedSourceId === logged.id)).toBe(false);
    expect(useLeftoverStore.getState().leftoverById(logged.id)!.useUpTask).toBe(false);
  });

  it('reconcileAllLeftoverTasks sweeps every live leftover, skipping finished ones', () => {
    seed([
      makeLeftover({ id: 'urgent', keepUntil: '2026-08-10' }),
      makeLeftover({ id: 'fresh', keepUntil: '2099-01-01' }),
      makeLeftover({ id: 'closed', keepUntil: '2026-08-10', finishedAt: '2026-08-09T00:00:00.000Z', outcome: 'eaten' }),
    ]);

    useLeftoverStore.getState().reconcileAllLeftoverTasks();

    expect(mockTaskState.tasks.some(t => t.generatedSourceId === 'urgent')).toBe(true);
    expect(mockTaskState.tasks.some(t => t.generatedSourceId === 'fresh')).toBe(false);
    expect(mockTaskState.tasks.some(t => t.generatedSourceId === 'closed')).toBe(false);
  });

  // #1953. The sweep above runs on startup and on every app foreground, because
  // needsAttention is a function of the wall clock. It used to rewrite dueDate
  // to *today* each time, so a use-up task deferred to tomorrow was pulled back
  // onto Today the next time the app came up, over and over, for as long as the
  // container was still in the fridge.
  it('leaves a use-up task the user re-dated where they put it, sweep after sweep', () => {
    seed([makeLeftover({ id: 'chilli', title: 'Chilli', keepUntil: '2026-08-10' })]);
    useLeftoverStore.getState().reconcileAllLeftoverTasks();

    const task = mockTaskState.tasks.find(t => t.generatedSourceId === 'chilli')!;
    const tomorrow = '2099-06-01T12:00:00.000Z';
    mockTaskState.updateTask(task.id, { dueDate: tomorrow });

    useLeftoverStore.getState().reconcileAllLeftoverTasks();
    useLeftoverStore.getState().reconcileAllLeftoverTasks();

    const after = mockTaskState.tasks.find(t => t.generatedSourceId === 'chilli')!;
    expect(after.dueDate).toBe(tomorrow);
    // And exactly one row — the deferred one is still the live task, so no
    // second copy is spawned underneath it.
    expect(mockTaskState.tasks.filter(t => t.generatedSourceId === 'chilli')).toHaveLength(1);
  });

  it('still chases the deadline onto a re-dated task when keep-for is edited', () => {
    seed([makeLeftover({ id: 'chilli', title: 'Chilli', keepUntil: '2026-08-10' })]);
    useLeftoverStore.getState().reconcileAllLeftoverTasks();

    const task = mockTaskState.tasks.find(t => t.generatedSourceId === 'chilli')!;
    const deferred = '2099-06-01T12:00:00.000Z';
    mockTaskState.updateTask(task.id, { dueDate: deferred });

    useLeftoverStore.getState().setKeepDays('chilli', 6);

    const after = mockTaskState.tasks.find(t => t.generatedSourceId === 'chilli')!;
    expect(after.deadline).toBe(useLeftoverStore.getState().leftoverById('chilli')!.keepUntil);
    expect(after.dueDate).toBe(deferred);
  });
});

describe('leftoverById', () => {
  it('resolves, or shrugs', () => {
    const chilli = makeLeftover({ id: 'lo-a' });
    seed([chilli]);

    expect(useLeftoverStore.getState().leftoverById('lo-a')).toEqual(chilli);
    expect(useLeftoverStore.getState().leftoverById('nope')).toBeUndefined();
  });
});
