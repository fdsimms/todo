import { emptyApplyReport } from '../utils/syncMerge';
import {
  STORE_RELOAD_READS,
  reloadReaches,
  reloadReachesSettings,
  scopeReaches,
  syncReloadScope,
} from '../utils/syncReloadScope';

// What each part really reads is checked against a real database in
// syncReload.test.ts. This file is the arithmetic.

const applied = (over: Partial<ReturnType<typeof emptyApplyReport>>) => ({ ...emptyApplyReport(), ...over });

describe('syncReloadScope', () => {
  it('is the tables and settings the apply changed', () => {
    const scope = syncReloadScope(applied({ changedTables: ['tasks', 'settings'], changedSettingKeys: ['dayResetTime'] }));
    expect([...scope!.tables]).toEqual(['tasks', 'settings']);
    expect([...scope!.settingKeys]).toEqual(['dayResetTime']);
  });

  it('is everything after a fold, whatever the report lists', () => {
    expect(syncReloadScope(applied({ changedTables: ['grocery_items'], folded: true }))).toBeNull();
  });
});

describe('scopeReaches', () => {
  const scope = syncReloadScope(applied({ changedTables: ['recipes', 'settings'], changedSettingKeys: ['workoutRoutineGroups'] }));

  it('reaches every reader when there is no scope', () => {
    expect(scopeReaches(null, { tables: [] })).toBe(true);
  });

  it('reaches a reader of a changed table', () => {
    expect(scopeReaches(scope, { tables: ['cookbooks', 'recipes'] })).toBe(true);
    expect(scopeReaches(scope, { tables: ['tasks'] })).toBe(false);
  });

  it('reaches a reader of a changed setting, by key', () => {
    expect(scopeReaches(scope, { tables: [], settings: ['workoutRoutineGroups'] })).toBe(true);
    expect(scopeReaches(scope, { tables: [], settings: ['event_reminders'] })).toBe(false);
    expect(scopeReaches(scope, { tables: [] })).toBe(false);
  });

  it('reaches a reader of settings at large whenever any setting changed', () => {
    expect(scopeReaches(scope, { tables: [], settings: 'any' })).toBe(true);
    const noSettings = syncReloadScope(applied({ changedTables: ['recipes'] }));
    expect(scopeReaches(noSettings, { tables: [], settings: 'any' })).toBe(false);
  });

  it('reads too much rather than too little when settings changed with no key named', () => {
    const unnamed = syncReloadScope(applied({ changedTables: ['settings'] }));
    expect(scopeReaches(unnamed, { tables: [], settings: ['event_reminders'] })).toBe(true);
  });
});

describe('reloadReaches', () => {
  it('looks a part up by the name the fan-out runs it under', () => {
    const scope = syncReloadScope(applied({ changedTables: ['grocery_list_items'] }));
    expect(reloadReaches(scope, 'Grocery')).toBe(true);
    expect(reloadReaches(scope, 'Recipe')).toBe(false);
    expect(reloadReaches(scope, 'read tasks')).toBe(false);
  });

  it('never reloads for a table that stays on this device', () => {
    // Listed like any other read, and harmless: no sync names them.
    expect(STORE_RELOAD_READS.PendingEstimate.tables).toEqual(['pending_estimates']);
    const scope = syncReloadScope(applied({ changedTables: ['tasks'] }));
    expect(reloadReaches(scope, 'PendingEstimate')).toBe(false);
    expect(reloadReaches(scope, 'EventReminder')).toBe(false);
  });
});

describe('reloadReachesSettings', () => {
  it('is whether a setting arrived, or everything did', () => {
    expect(reloadReachesSettings(null)).toBe(true);
    expect(reloadReachesSettings(syncReloadScope(applied({ changedTables: ['settings'], changedSettingKeys: ['a'] })))).toBe(true);
    expect(reloadReachesSettings(syncReloadScope(applied({ changedTables: ['tasks'] })))).toBe(false);
  });
});
