import { useFoodLogStore, type FoodLogDraft } from '../store/useFoodLogStore';
import {
  dbBulkDeleteFoodLogEntries,
  dbBulkSetFoodLogSlot,
  dbBulkUpdateFoodLogPlacement,
  dbCountFoodLogEntries,
  dbDeleteFoodLogEntry,
  dbGetFoodLogEntries,
  dbGetFoodLogEntry,
  dbInsertFoodLogEntry,
  dbUpdateFoodLogEntry,
} from '../db/database';
import { logFoodEntryToHealth, retractFoodEntryFromHealth } from '../utils/healthFoodSync';
import type { FoodNutrition } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/**
 * Standing in for the table rather than for one call.
 *
 * `addEntry` reads the day's existing rows back out of SQLite to work out
 * where the new one appends, so a range read hard-coded to `[]` would report
 * that every day is empty and pin every entry at 0 — which is the bug these
 * tests are here to hold down. Inserts land here and the range read filters
 * them, which is as much of a database as this file needs.
 */
const mockRows: { dayKey: string }[] = [];

jest.mock('../db/database', () => ({
  dbGetFoodLogEntries: jest.fn((startKey: string, endKey: string) =>
    mockRows.filter(r => r.dayKey >= startKey && r.dayKey <= endKey)),
  // Matches the real dbGetFoodLogEntry's own miss case (a null row reads as
  // null, never undefined) — see database.ts.
  dbGetFoodLogEntry: jest.fn(() => null),
  dbCountFoodLogEntries: jest.fn(() => 0),
  dbInsertFoodLogEntry: jest.fn((entry: { dayKey: string }) => { mockRows.push(entry); }),
  dbUpdateFoodLogEntry: jest.fn(),
  dbDeleteFoodLogEntry: jest.fn(),
  dbBulkDeleteFoodLogEntries: jest.fn(),
  dbBulkSetFoodLogSlot: jest.fn(),
  dbBulkUpdateFoodLogPlacement: jest.fn(),
}));

// Real module reaches healthBridge.ts, which imports react-native — irrelevant
// to what this file tests (store/db plumbing), and Jest's node environment
// can't parse it anyway. logFoodEntryToHealth resolves 'unavailable' with no
// bridge in a test environment regardless, so this only saves the import.
jest.mock('../utils/healthFoodSync', () => ({
  logFoodEntryToHealth: jest.fn(() => Promise.resolve({ outcome: 'unavailable', sampleIds: [] })),
  retractFoodEntryFromHealth: jest.fn(() => Promise.resolve(true)),
}));

// The real settings store reaches dbGetSetting/dbSetSetting, which the db mock
// above deliberately does not carry. Only two members matter here: whether the
// refusal has already been said, and the setter that records it.
const mockSettingsState = {
  healthFoodWriteRefusalSeen: false,
  setHealthFoodWriteRefusalSeen: jest.fn((seen: boolean) => {
    mockSettingsState.healthFoodWriteRefusalSeen = seen;
  }),
};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}));

jest.mock('../utils/dateUtils', () => ({
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 3, 2)),
  // The whole point of the stamped day key: this is what a 2am reset does to a
  // late-night entry, so an entry made after midnight lands on the day before.
  getLogicalDayKey: jest.fn((d: Date) => {
    const shifted = new Date(d.getTime() - 2 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${shifted.getFullYear()}-${p(shifted.getMonth() + 1)}-${p(shifted.getDate())}`;
  }),
}));

function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: 100,
    servingText: '1 serving',
    amounts: { calorieKcal: 200 },
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<FoodLogDraft> = {}): FoodLogDraft {
  return {
    label: 'Porridge',
    quantity: '1 bowl',
    grams: 250,
    nutrition: panel(),
    slot: 'breakfast',
    at: new Date(2026, 3, 2, 9, 0),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.length = 0;
  (dbGetFoodLogEntry as jest.Mock).mockReturnValue(null);
  useFoodLogStore.setState({
    entries: [], rangeStart: null, rangeEnd: null, totalCount: 0, initialized: false,
  });
});

const state = () => useFoodLogStore.getState();

describe('initialize', () => {
  it('opens on the current logical day rather than the whole history', () => {
    state().initialize();
    expect(dbGetFoodLogEntries).toHaveBeenCalledWith('2026-04-02', '2026-04-02');
    expect(state().initialized).toBe(true);
  });

  it('counts the whole history separately, since one day cannot answer for it', () => {
    (dbCountFoodLogEntries as jest.Mock).mockReturnValueOnce(42);
    state().initialize();
    expect(state().totalCount).toBe(42);
  });
});

/**
 * The notice that Health is refusing meals (#2516).
 *
 * The write is fire-and-forget, so each case flushes the microtask queue before
 * asserting. What is being pinned is the rule rather than the alert: the alert
 * itself lives in HealthWriteRefusedNotice, which has no test because there is
 * no renderer in this project.
 */
describe('addEntry, when Health refuses the write', () => {
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  const outcome = (result: string) =>
    (logFoodEntryToHealth as jest.Mock).mockResolvedValue({ outcome: result, sampleIds: [] });

  beforeEach(() => {
    mockSettingsState.healthFoodWriteRefusalSeen = false;
    (mockSettingsState.setHealthFoodWriteRefusalSeen as jest.Mock).mockClear();
    useFoodLogStore.setState({ pendingHealthWriteRefusal: false });
  });

  it('raises the notice and records that it was said', async () => {
    outcome('refused');
    state().addEntry(draft());
    await flush();

    expect(state().pendingHealthWriteRefusal).toBe(true);
    expect(mockSettingsState.setHealthFoodWriteRefusalSeen).toHaveBeenCalledWith(true);
  });

  // The failure is ongoing and identical every time, so a notice per meal would
  // be a nag about something already said.
  it('says nothing the second time', async () => {
    outcome('refused');
    state().addEntry(draft());
    await flush();
    useFoodLogStore.setState({ pendingHealthWriteRefusal: false });

    state().addEntry(draft());
    await flush();
    expect(state().pendingHealthWriteRefusal).toBe(false);
  });

  // What stops "once" meaning "never again": a write that lands re-arms it, so
  // a breakage starting later gets its own notice.
  it('re-arms once a write lands', async () => {
    mockSettingsState.healthFoodWriteRefusalSeen = true;
    (logFoodEntryToHealth as jest.Mock).mockResolvedValue({ outcome: 'written', sampleIds: ['s1'] });
    state().addEntry(draft());
    await flush();

    expect(mockSettingsState.setHealthFoodWriteRefusalSeen).toHaveBeenCalledWith(false);
    expect(mockSettingsState.healthFoodWriteRefusalSeen).toBe(false);
  });

  // `off` is the switch doing what it says, `unavailable` is a device with no
  // Health at all, and `nothingToWrite` is an entry stating no figure, which is
  // an ordinary thing to log. None of the three is a fault to report.
  it.each(['off', 'unavailable', 'nothingToWrite'])('stays silent on %s', async result => {
    outcome(result);
    state().addEntry(draft());
    await flush();

    expect(state().pendingHealthWriteRefusal).toBe(false);
    expect(mockSettingsState.setHealthFoodWriteRefusalSeen).not.toHaveBeenCalled();
  });

  it('still saves the entry, which is the reason the failure is invisible', async () => {
    outcome('refused');
    expect(state().addEntry(draft())).not.toBeNull();
    await flush();
    expect(dbInsertFoodLogEntry).toHaveBeenCalled();
  });
});

describe('addEntry', () => {
  it('writes an entry and holds it in the loaded window', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft());
    expect(entry).not.toBeNull();
    expect(dbInsertFoodLogEntry).toHaveBeenCalled();
    expect(state().entries).toHaveLength(1);
  });

  it('stamps the logical day, not the calendar one', () => {
    // 00:30 with a 2am reset belongs to the day before, which is the whole
    // reason the key is stored rather than derived from the instant on read.
    const entry = state().addEntry(draft({ at: new Date(2026, 3, 3, 0, 30) }));
    expect(entry?.dayKey).toBe('2026-04-02');
    // ...and the instant itself is untouched, because a Health sample belongs
    // at the moment it happened. The two disagreeing here is correct.
    expect(new Date(entry!.atISO).getDate()).toBe(3);
  });

  it('refuses an entry with nothing to call it', () => {
    expect(state().addEntry(draft({ label: '   ' }))).toBeNull();
    expect(dbInsertFoodLogEntry).not.toHaveBeenCalled();
  });

  it('refuses an entry with no figures, which adds nothing to a total', () => {
    expect(state().addEntry(draft({ nutrition: panel({ amounts: {} }) }))).toBeNull();
    expect(dbInsertFoodLogEntry).not.toHaveBeenCalled();
  });

  it('stores an entry outside the loaded window without showing it', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft({ at: new Date(2026, 2, 20, 13, 0) }));
    expect(entry).not.toBeNull();
    expect(dbInsertFoodLogEntry).toHaveBeenCalled();
    expect(state().entries).toHaveLength(0);
    // ...but it still counts toward the history, which is what decides whether
    // the screen exists at all.
    expect(state().totalCount).toBe(1);
  });

  it('keeps the window in order of when things were eaten', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    state().addEntry(draft({ label: 'Dinner', at: new Date(2026, 3, 2, 19, 0) }));
    state().addEntry(draft({ label: 'Lunch', at: new Date(2026, 3, 2, 13, 0) }));
    expect(state().entries.map(e => e.label)).toEqual(['Lunch', 'Dinner']);
  });

  it('writes no health samples, since nothing writes to Health yet', () => {
    expect(state().addEntry(draft())?.healthSampleIds).toEqual([]);
  });
});

describe('updateEntry', () => {
  it('changes what an edit is allowed to change', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft())!;
    state().updateEntry(entry.id, { label: 'Oatmeal', slot: 'snack' });
    expect(dbUpdateFoodLogEntry).toHaveBeenCalled();
    expect(state().entries[0].label).toBe('Oatmeal');
    expect(state().entries[0].slot).toBe('snack');
  });

  it('leaves the instant and its day key alone', () => {
    // They were stamped together from one moment under one reset time. Moving
    // one without the other counts an entry on a day it did not happen on.
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft())!;
    state().updateEntry(entry.id, { label: 'Oatmeal' });
    expect(state().entries[0].dayKey).toBe(entry.dayKey);
    expect(state().entries[0].atISO).toBe(entry.atISO);
  });

  it('shrugs at an id it does not hold', () => {
    state().updateEntry('nope', { label: 'x' });
    expect(dbUpdateFoodLogEntry).not.toHaveBeenCalled();
  });

  it('re-points an entry at a different catalog row without touching what was eaten', () => {
    // The link is provenance and `nutrition` is a snapshot of the helping.
    // Saying which row this was must never rewrite the meal — the same rule the
    // snapshot exists for, one step along.
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft({ itemId: 'item-a', productId: 'box-a' }))!;
    state().updateEntry(entry.id, { itemId: 'item-b', productId: null });
    expect(state().entries[0].itemId).toBe('item-b');
    expect(state().entries[0].productId).toBeNull();
    expect(state().entries[0].nutrition).toEqual(entry.nutrition);
    expect(state().entries[0].label).toBe(entry.label);
    expect(state().entries[0].grams).toBe(entry.grams);
  });

  it('lets the link be dropped entirely', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft({ itemId: 'item-a' }))!;
    state().updateEntry(entry.id, { itemId: null, productId: null });
    expect(state().entries[0].itemId).toBeNull();
  });
});

describe('removeEntry', () => {
  it('forgets it, and takes it out of the history count', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft())!;
    state().removeEntry(entry.id);
    expect(dbDeleteFoodLogEntry).toHaveBeenCalledWith(entry.id);
    expect(state().entries).toHaveLength(0);
    expect(state().totalCount).toBe(0);
  });

  it('cannot drive the count below zero', () => {
    // A delete of a row outside the loaded window would otherwise make the
    // screen vanish while it still held entries.
    state().removeEntry('nope');
    expect(state().totalCount).toBe(0);
  });
});

describe('addEntry sortOrder', () => {
  it('starts the day at 0', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const entry = state().addEntry(draft())!;
    expect(entry.sortOrder).toBe(0);
  });

  it('appends to the bottom of the day rather than restarting at 0', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    state().addEntry(draft({ label: 'First' }));
    const second = state().addEntry(draft({ label: 'Second' }))!;
    expect(second.sortOrder).toBe(1);
  });

  it('does not let a different day\'s rows push this one down the order', () => {
    state().loadRange('2026-04-01', '2026-04-02');
    state().addEntry(draft({ label: 'Yesterday', at: new Date(2026, 3, 1, 9, 0) }));
    const today = state().addEntry(draft({ label: 'Today' }))!;
    expect(today.sortOrder).toBe(0);
  });

  // The day's rows are read from SQLite rather than from `entries`, which
  // holds only the loaded window. Counted from the window, a meal logged from
  // LogMealPrompt while the day view sat on another day found no siblings,
  // took 0, and tied with the day's first row instead of appending to it.
  it('appends even when the day it lands on is outside the loaded window', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    state().addEntry(draft({ label: 'Breakfast' }));
    state().addEntry(draft({ label: 'Lunch' }));
    state().loadRange('2026-03-01', '2026-03-01');
    const dinner = state().addEntry(draft({ label: 'Dinner' }))!;
    expect(dinner.dayKey).toBe('2026-04-02');
    expect(dinner.sortOrder).toBe(2);
  });
});

describe('removeEntries', () => {
  it('forgets every id at once, and drops the count by that many', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const a = state().addEntry(draft({ label: 'A' }))!;
    const b = state().addEntry(draft({ label: 'B' }))!;
    state().addEntry(draft({ label: 'C' }));
    state().removeEntries([a.id, b.id]);
    expect(dbBulkDeleteFoodLogEntries).toHaveBeenCalledWith([a.id, b.id]);
    expect(state().entries.map(e => e.label)).toEqual(['C']);
    expect(state().totalCount).toBe(1);
  });

  it('is a no-op on an empty selection', () => {
    state().removeEntries([]);
    expect(dbBulkDeleteFoodLogEntries).not.toHaveBeenCalled();
  });

  it('retracts every removed entry\'s Health samples, same rule removeEntry keeps', () => {
    (dbGetFoodLogEntry as jest.Mock).mockImplementation((id: string) =>
      id === 'a' ? { healthSampleIds: ['sample-a'] } : { healthSampleIds: [] }
    );
    state().loadRange('2026-04-02', '2026-04-02');
    state().removeEntries(['a', 'b']);
    expect(retractFoodEntryFromHealth).toHaveBeenCalledWith(['sample-a']);
  });

  it('never calls Health when nothing removed wrote a sample', () => {
    (dbGetFoodLogEntry as jest.Mock).mockReturnValue({ healthSampleIds: [] });
    state().removeEntries(['a']);
    expect(retractFoodEntryFromHealth).not.toHaveBeenCalled();
  });
});

describe('moveEntries', () => {
  it('re-slots every selected entry, leaving the rest alone', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const a = state().addEntry(draft({ label: 'A', slot: 'breakfast' }))!;
    const b = state().addEntry(draft({ label: 'B', slot: 'breakfast' }))!;
    state().moveEntries([a.id], 'lunch');
    expect(dbBulkSetFoodLogSlot).toHaveBeenCalledWith([a.id], 'lunch');
    expect(state().entries.find(e => e.id === a.id)?.slot).toBe('lunch');
    expect(state().entries.find(e => e.id === b.id)?.slot).toBe('breakfast');
  });
});

describe('reorderEntries', () => {
  it('persists a drop\'s new slot and rank together', () => {
    state().loadRange('2026-04-02', '2026-04-02');
    const a = state().addEntry(draft({ label: 'A', slot: 'breakfast' }))!;
    const b = state().addEntry(draft({ label: 'B', slot: 'lunch' }))!;
    const updates = [
      { id: b.id, slot: 'lunch' as const, sortOrder: 1 },
      { id: a.id, slot: 'lunch' as const, sortOrder: 2 },
    ];
    state().reorderEntries(updates);
    expect(dbBulkUpdateFoodLogPlacement).toHaveBeenCalledWith(updates);
    expect(state().entries.find(e => e.id === a.id)).toMatchObject({ slot: 'lunch', sortOrder: 2 });
    expect(state().entries.find(e => e.id === b.id)).toMatchObject({ slot: 'lunch', sortOrder: 1 });
  });
});
