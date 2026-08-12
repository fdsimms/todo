import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { loadAnthropicApiKey, saveAnthropicApiKey } from '../utils/secureApiKey';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

// The key lives in the keychain now — see secureApiKey.test.ts for the module
// itself. Here it only matters that the store goes through it.
jest.mock('../utils/secureApiKey', () => ({
  loadAnthropicApiKey: jest.fn().mockResolvedValue(''),
  saveAnthropicApiKey: jest.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  (loadAnthropicApiKey as jest.Mock).mockResolvedValue('');
  useSettingsStore.setState({ dayResetTime: '00:00', themeMode: 'dark', anthropicApiKey: '', appLockEnabled: false, appLockGraceSeconds: 60, patchNotesQaStatus: {}, initialized: false });
});

// ─── initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('has default dayResetTime of 00:00', () => {
    expect(useSettingsStore.getState().dayResetTime).toBe('00:00');
  });

  it('has default themeMode of dark', () => {
    expect(useSettingsStore.getState().themeMode).toBe('dark');
  });

  it('starts uninitialized', () => {
    expect(useSettingsStore.getState().initialized).toBe(false);
  });
});

// ─── initialize ──────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('sets initialized to true', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().initialized).toBe(true);
  });

  it('uses stored dayResetTime when present', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'dayResetTime' ? '06:00' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().dayResetTime).toBe('06:00');
  });

  it('uses stored themeMode when present', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'themeMode' ? 'light' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().themeMode).toBe('light');
  });

  it('falls back to 00:00 when dayResetTime is not stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().dayResetTime).toBe('00:00');
  });

  it('falls back to dark when themeMode is not stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().themeMode).toBe('dark');
  });

  // ─── autoRemoveExpiredTasks migration (issue #898) ──────────────────────────
  // Still read from the same 'autoRemoveExpiredTasks' key the boolean used, so
  // an existing install's persisted 'true'/'false' has to keep meaning exactly
  // what it always did once the setting becomes a duration.

  it('defaults autoRemoveExpiredTasks to Never (null) when nothing is stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().autoRemoveExpiredTasks).toBe(null);
  });

  it('migrates legacy "true" to Immediately (0)', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'autoRemoveExpiredTasks' ? 'true' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().autoRemoveExpiredTasks).toBe(0);
  });

  it('migrates legacy "false" to Never (null)', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'autoRemoveExpiredTasks' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().autoRemoveExpiredTasks).toBe(null);
  });

  it('reads a stored grace period in days', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'autoRemoveExpiredTasks' ? '7' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().autoRemoveExpiredTasks).toBe(7);
  });
});

// ─── setDayResetTime ──────────────────────────────────────────────────────────

describe('setDayResetTime', () => {
  it('updates dayResetTime in state', () => {
    useSettingsStore.getState().setDayResetTime('08:00');
    expect(useSettingsStore.getState().dayResetTime).toBe('08:00');
  });

  it('persists the value to the database', () => {
    useSettingsStore.getState().setDayResetTime('03:30');
    expect(dbSetSetting).toHaveBeenCalledWith('dayResetTime', '03:30');
  });
});

// ─── setThemeMode ─────────────────────────────────────────────────────────────

describe('setThemeMode', () => {
  it('updates themeMode in state', () => {
    useSettingsStore.getState().setThemeMode('light');
    expect(useSettingsStore.getState().themeMode).toBe('light');
  });

  it('persists the value to the database', () => {
    useSettingsStore.getState().setThemeMode('light');
    expect(dbSetSetting).toHaveBeenCalledWith('themeMode', 'light');
  });

  it('can toggle back to dark', () => {
    useSettingsStore.getState().setThemeMode('light');
    useSettingsStore.getState().setThemeMode('dark');
    expect(useSettingsStore.getState().themeMode).toBe('dark');
  });
});

// ─── setPatchNoteQaStatus ───────────────────────────────────────────────────

describe('setPatchNoteQaStatus', () => {
  it('has an empty default', () => {
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({});
  });

  it('marks a note as passed', () => {
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', 'pass');
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({ 'some-note': 'pass' });
  });

  it('marks a note as failed', () => {
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', 'fail');
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({ 'some-note': 'fail' });
  });

  it('overwrites an existing status for the same note', () => {
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', 'pass');
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', 'fail');
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({ 'some-note': 'fail' });
  });

  it('clears the status when passed null', () => {
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', 'pass');
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', null);
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({});
  });

  it('persists the map to the database', () => {
    useSettingsStore.getState().setPatchNoteQaStatus('some-note', 'pass');
    expect(dbSetSetting).toHaveBeenCalledWith('patchNotesQaStatus', JSON.stringify({ 'some-note': 'pass' }));
  });

  it('keeps statuses for other notes independent', () => {
    useSettingsStore.getState().setPatchNoteQaStatus('note-a', 'pass');
    useSettingsStore.getState().setPatchNoteQaStatus('note-b', 'fail');
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({ 'note-a': 'pass', 'note-b': 'fail' });
  });

  it('restores stored statuses on initialize', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'patchNotesQaStatus' ? JSON.stringify({ 'note-a': 'pass' }) : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().patchNotesQaStatus).toEqual({ 'note-a': 'pass' });
  });
});

// ─── setVacationMode / setVacationEnd ───────────────────────────────────────

describe('setVacationMode', () => {
  it('turns on with a vacationStart timestamp and no end date by default', () => {
    useSettingsStore.getState().setVacationMode(true);
    const state = useSettingsStore.getState();
    expect(state.vacationMode).toBe(true);
    expect(state.vacationStart).not.toBeNull();
    expect(state.vacationEnd).toBeNull();
  });

  it('turns on with an optional end date', () => {
    useSettingsStore.getState().setVacationMode(true, '2025-07-10T23:59:59.999Z');
    expect(useSettingsStore.getState().vacationEnd).toBe('2025-07-10T23:59:59.999Z');
  });

  it('clears vacationStart and vacationEnd when turned off', () => {
    useSettingsStore.getState().setVacationMode(true, '2025-07-10T23:59:59.999Z');
    useSettingsStore.getState().setVacationMode(false);
    const state = useSettingsStore.getState();
    expect(state.vacationMode).toBe(false);
    expect(state.vacationStart).toBeNull();
    expect(state.vacationEnd).toBeNull();
  });

  it('restores a stored vacationEnd on initialize', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'vacationEnd' ? '2025-08-01T23:59:59.999Z' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().vacationEnd).toBe('2025-08-01T23:59:59.999Z');
  });
});

// ─── resetToDefaults ─────────────────────────────────────────────────────────

describe('resetToDefaults', () => {
  it('restores appearance and day/time settings to their defaults', () => {
    useSettingsStore.getState().setThemeMode('light');
    useSettingsStore.getState().setDayResetTime('06:00');
    useSettingsStore.getState().setAfternoonStart('13:00');
    useSettingsStore.getState().setAutoRemoveExpiredTasks(7);
    useSettingsStore.getState().setAutoArchiveProjectsOnComplete(true);
    useSettingsStore.getState().setHideCategories(true);
    useSettingsStore.getState().setTimerLiveActivity(false);

    useSettingsStore.getState().resetToDefaults();

    const state = useSettingsStore.getState();
    expect(state.themeMode).toBe('dark');
    expect(state.dayResetTime).toBe('00:00');
    expect(state.morningStart).toBe('06:00');
    expect(state.afternoonStart).toBe('12:00');
    expect(state.eveningStart).toBe('18:00');
    expect(state.nightStart).toBe('21:00');
    expect(state.activeHoursStart).toBe('08:00');
    expect(state.activeHoursEnd).toBe('22:00');
    // Deletes tasks unattended, like completedRetentionDays — a reset must not
    // silently change how aggressively it does that.
    expect(state.autoRemoveExpiredTasks).toBe(7);
    expect(state.autoArchiveProjectsOnComplete).toBe(false);
    expect(state.hideCategories).toBe(false);
    expect(state.timerLiveActivity).toBe(true);
  });

  it('persists each default to the database', () => {
    useSettingsStore.getState().resetToDefaults();
    expect(dbSetSetting).toHaveBeenCalledWith('themeMode', 'dark');
    expect(dbSetSetting).toHaveBeenCalledWith('dayResetTime', '00:00');
  });

  // Same reasoning as the app lock below: a reset is about appearance and
  // formatting, not about putting a whole feature area back in someone's menu.
  it('does not put the groceries area back', () => {
    useSettingsStore.getState().setKitchenEnabled(false);

    useSettingsStore.getState().resetToDefaults();

    expect(useSettingsStore.getState().kitchenEnabled).toBe(false);
    expect(dbSetSetting).not.toHaveBeenCalledWith('kitchenEnabled', 'true');
  });

  it('does not touch the API key or vacation mode', () => {
    useSettingsStore.getState().setAnthropicApiKey('sk-ant-secret');
    useSettingsStore.getState().setVacationMode(true);

    useSettingsStore.getState().resetToDefaults();

    const state = useSettingsStore.getState();
    expect(state.anthropicApiKey).toBe('sk-ant-secret');
    expect(state.vacationMode).toBe(true);
  });

  // "Reset appearance and formatting" must not be a way to take the lock off
  // the app.
  it('does not turn the app lock off', () => {
    useSettingsStore.getState().setAppLockEnabled(true);
    useSettingsStore.getState().setAppLockGraceSeconds(900);

    useSettingsStore.getState().resetToDefaults();

    const state = useSettingsStore.getState();
    expect(state.appLockEnabled).toBe(true);
    expect(state.appLockGraceSeconds).toBe(900);
    expect(dbSetSetting).not.toHaveBeenCalledWith('appLockEnabled', 'false');
  });
});

// ─── the API key ─────────────────────────────────────────────────────────────

describe('the API key', () => {
  it('never goes into the settings table', () => {
    useSettingsStore.getState().setAnthropicApiKey('sk-ant-secret');

    expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-secret');
    expect(saveAnthropicApiKey).toHaveBeenCalledWith('sk-ant-secret');
    expect(dbSetSetting).not.toHaveBeenCalledWith('anthropicApiKey', expect.anything());
  });

  it('is not read out of the settings table by initialize', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'anthropicApiKey' ? 'sk-ant-plaintext' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().anthropicApiKey).toBe('');
  });

  it('comes from the keychain', async () => {
    (loadAnthropicApiKey as jest.Mock).mockResolvedValue('sk-ant-secure');
    await useSettingsStore.getState().initializeSecrets();
    expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-secure');
  });

  // The keychain read is in flight for a moment at launch; a key typed in that
  // window has already been written, and must not be overwritten by it.
  it('does not clobber a key set while the keychain read was in flight', async () => {
    let resolveLoad: (key: string) => void = () => {};
    (loadAnthropicApiKey as jest.Mock).mockReturnValue(
      new Promise<string>(resolve => { resolveLoad = resolve; })
    );

    const pending = useSettingsStore.getState().initializeSecrets();
    useSettingsStore.getState().setAnthropicApiKey('sk-ant-typed');
    resolveLoad('sk-ant-stale');
    await pending;

    expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-typed');
  });
});

// ─── app lock ────────────────────────────────────────────────────────────────

describe('app lock settings', () => {
  it('is off with a one-minute grace period until someone turns it on', () => {
    const state = useSettingsStore.getState();
    expect(state.appLockEnabled).toBe(false);
    expect(state.appLockGraceSeconds).toBe(60);
  });

  it('persists both halves', () => {
    useSettingsStore.getState().setAppLockEnabled(true);
    useSettingsStore.getState().setAppLockGraceSeconds(300);
    expect(dbSetSetting).toHaveBeenCalledWith('appLockEnabled', 'true');
    expect(dbSetSetting).toHaveBeenCalledWith('appLockGraceSeconds', '300');
  });

  it('reads both back', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'appLockEnabled' ? 'true' : key === 'appLockGraceSeconds' ? '0' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().appLockEnabled).toBe(true);
    expect(useSettingsStore.getState().appLockGraceSeconds).toBe(0);
  });

  it('falls back to the default grace period for a garbled value', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'appLockGraceSeconds' ? '99999' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().appLockGraceSeconds).toBe(60);
  });
});

// ─── Apple Reminders import ──────────────────────────────────────────────────

describe('reminders import settings', () => {
  it('is off with no list until someone turns it on', () => {
    const state = useSettingsStore.getState();
    expect(state.remindersImportEnabled).toBe(false);
    expect(state.remindersImportListId).toBeNull();
    expect(state.remindersImportConfirmedListId).toBeNull();
  });

  it('round-trips the list ids through the settings table', () => {
    useSettingsStore.getState().setRemindersImportListId('list-1');
    useSettingsStore.getState().setRemindersImportConfirmedListId('list-1');
    expect(dbSetSetting).toHaveBeenCalledWith('remindersImportListId', 'list-1');
    expect(dbSetSetting).toHaveBeenCalledWith('remindersImportConfirmedListId', 'list-1');

    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'remindersImportListId' || key === 'remindersImportConfirmedListId' ? 'list-1'
      : key === 'remindersImportEnabled' ? 'true'
      : null
    );
    useSettingsStore.getState().initialize();
    const state = useSettingsStore.getState();
    expect(state.remindersImportEnabled).toBe(true);
    expect(state.remindersImportListId).toBe('list-1');
    expect(state.remindersImportConfirmedListId).toBe('list-1');
  });

  it('reads a cleared list id back as null rather than an empty string', () => {
    useSettingsStore.getState().setRemindersImportListId(null);
    expect(dbSetSetting).toHaveBeenCalledWith('remindersImportListId', '');

    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'remindersImportListId' ? '' : null
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().remindersImportListId).toBeNull();
  });

  it('resetToDefaults disarms it completely, ids included', () => {
    useSettingsStore.getState().setRemindersImportEnabled(true);
    useSettingsStore.getState().setRemindersImportListId('list-1');
    useSettingsStore.getState().setRemindersImportConfirmedListId('list-1');

    useSettingsStore.getState().resetToDefaults();

    const state = useSettingsStore.getState();
    expect(state.remindersImportEnabled).toBe(false);
    // Leaving the confirmed id matching the chosen one would let a later
    // re-enable skip the confirmation, which is the whole safeguard.
    expect(state.remindersImportListId).toBeNull();
    expect(state.remindersImportConfirmedListId).toBeNull();
    expect(dbSetSetting).toHaveBeenCalledWith('remindersImportConfirmedListId', '');
  });
});

describe('grocery import settings', () => {
  it('is off with no list until someone turns it on', () => {
    const state = useSettingsStore.getState();
    expect(state.groceryImportEnabled).toBe(false);
    expect(state.groceryImportListId).toBeNull();
    expect(state.groceryImportConfirmedListId).toBeNull();
  });

  it('round-trips its own list ids, independently of the task import', () => {
    useSettingsStore.getState().setGroceryImportListId('list-2');
    useSettingsStore.getState().setGroceryImportConfirmedListId('list-2');
    expect(dbSetSetting).toHaveBeenCalledWith('groceryImportListId', 'list-2');
    expect(dbSetSetting).toHaveBeenCalledWith('groceryImportConfirmedListId', 'list-2');

    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'groceryImportListId' || key === 'groceryImportConfirmedListId' ? 'list-2'
      : key === 'groceryImportEnabled' ? 'true'
      : null
    );
    useSettingsStore.getState().initialize();
    const state = useSettingsStore.getState();
    expect(state.groceryImportEnabled).toBe(true);
    expect(state.groceryImportListId).toBe('list-2');
    expect(state.groceryImportConfirmedListId).toBe('list-2');
    // The task-side import is untouched by any of it.
    expect(state.remindersImportEnabled).toBe(false);
  });

  it('reads a cleared list id back as null rather than an empty string', () => {
    useSettingsStore.getState().setGroceryImportListId(null);
    expect(dbSetSetting).toHaveBeenCalledWith('groceryImportListId', '');

    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'groceryImportListId' ? '' : null
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryImportListId).toBeNull();
  });

  it('resetToDefaults disarms it completely, ids included', () => {
    useSettingsStore.getState().setGroceryImportEnabled(true);
    useSettingsStore.getState().setGroceryImportListId('list-2');
    useSettingsStore.getState().setGroceryImportConfirmedListId('list-2');

    useSettingsStore.getState().resetToDefaults();

    const state = useSettingsStore.getState();
    expect(state.groceryImportEnabled).toBe(false);
    // Same safeguard as the task side: a matching confirmed id would let a
    // later re-enable skip the confirmation entirely.
    expect(state.groceryImportListId).toBeNull();
    expect(state.groceryImportConfirmedListId).toBeNull();
    expect(dbSetSetting).toHaveBeenCalledWith('groceryImportConfirmedListId', '');
  });
});

describe('the delete-after-importing settings', () => {
  it('both default on, which is what the feature has always done', () => {
    const state = useSettingsStore.getState();
    expect(state.remindersImportDelete).toBe(true);
    expect(state.groceryImportDelete).toBe(true);
  });

  it('round-trips each independently of the other', () => {
    useSettingsStore.getState().setRemindersImportDelete(false);
    expect(dbSetSetting).toHaveBeenCalledWith('remindersImportDelete', 'false');
    expect(useSettingsStore.getState().remindersImportDelete).toBe(false);
    expect(useSettingsStore.getState().groceryImportDelete).toBe(true);

    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'remindersImportDelete' ? 'false' : null
    );
    useSettingsStore.getState().initialize();
    const state = useSettingsStore.getState();
    expect(state.remindersImportDelete).toBe(false);
    // Absent row, and absent must read as on — see below.
    expect(state.groceryImportDelete).toBe(true);
  });

  // The important one. An install that predates the setting has been deleting
  // reminders all along; reading the missing row as "off" would silently switch
  // it to leaving them behind, duplicating anything the name index missed.
  it('reads a missing row as on rather than off', () => {
    (dbGetSetting as jest.Mock).mockImplementation(() => null);
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().remindersImportDelete).toBe(true);
    expect(useSettingsStore.getState().groceryImportDelete).toBe(true);
  });

  it('resetToDefaults puts both back on', () => {
    useSettingsStore.getState().setRemindersImportDelete(false);
    useSettingsStore.getState().setGroceryImportDelete(false);

    useSettingsStore.getState().resetToDefaults();

    expect(useSettingsStore.getState().remindersImportDelete).toBe(true);
    expect(useSettingsStore.getState().groceryImportDelete).toBe(true);
  });
});

describe('setProjectNudgeDismissedAt', () => {
  it('stores and persists the stamp', () => {
    useSettingsStore.getState().setProjectNudgeDismissedAt('2026-08-06T09:00:00.000Z');
    expect(useSettingsStore.getState().projectNudgeDismissedAt).toBe('2026-08-06T09:00:00.000Z');
    expect(dbSetSetting).toHaveBeenCalledWith('projectNudgeDismissedAt', '2026-08-06T09:00:00.000Z');
  });

  it('clears back to null through an empty string', () => {
    useSettingsStore.getState().setProjectNudgeDismissedAt(null);
    expect(useSettingsStore.getState().projectNudgeDismissedAt).toBeNull();
    expect(dbSetSetting).toHaveBeenCalledWith('projectNudgeDismissedAt', '');
  });
});

describe('meal plan nudge settings', () => {
  it('defaults to off, Sunday, 09:00, and never fired', () => {
    expect(useSettingsStore.getState().mealPlanNudgeEnabled).toBe(false);
    expect(useSettingsStore.getState().mealPlanNudgeWeekday).toBe(0);
    expect(useSettingsStore.getState().mealPlanNudgeTime).toBe('09:00');
    expect(useSettingsStore.getState().mealPlanNudgeLastFiredWeekKey).toBeNull();
  });

  it('stores and persists mealPlanNudgeEnabled', () => {
    useSettingsStore.getState().setMealPlanNudgeEnabled(true);
    expect(useSettingsStore.getState().mealPlanNudgeEnabled).toBe(true);
    expect(dbSetSetting).toHaveBeenCalledWith('mealPlanNudgeEnabled', 'true');
  });

  it('stores and persists mealPlanNudgeWeekday', () => {
    useSettingsStore.getState().setMealPlanNudgeWeekday(5);
    expect(useSettingsStore.getState().mealPlanNudgeWeekday).toBe(5);
    expect(dbSetSetting).toHaveBeenCalledWith('mealPlanNudgeWeekday', '5');
  });

  it('stores and persists mealPlanNudgeTime', () => {
    useSettingsStore.getState().setMealPlanNudgeTime('18:30');
    expect(useSettingsStore.getState().mealPlanNudgeTime).toBe('18:30');
    expect(dbSetSetting).toHaveBeenCalledWith('mealPlanNudgeTime', '18:30');
  });

  it('stores and clears mealPlanNudgeLastFiredWeekKey through an empty string', () => {
    useSettingsStore.getState().setMealPlanNudgeLastFiredWeekKey('2026-08-09');
    expect(useSettingsStore.getState().mealPlanNudgeLastFiredWeekKey).toBe('2026-08-09');
    expect(dbSetSetting).toHaveBeenCalledWith('mealPlanNudgeLastFiredWeekKey', '2026-08-09');

    useSettingsStore.getState().setMealPlanNudgeLastFiredWeekKey(null);
    expect(useSettingsStore.getState().mealPlanNudgeLastFiredWeekKey).toBeNull();
    expect(dbSetSetting).toHaveBeenCalledWith('mealPlanNudgeLastFiredWeekKey', '');
  });

  it('reads an out-of-range stored weekday back as the default rather than trusting it', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'mealPlanNudgeWeekday' ? '9' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().mealPlanNudgeWeekday).toBe(0);
  });

  it('resetToDefaults turns the nudge back off without touching the idempotency key', () => {
    useSettingsStore.getState().setMealPlanNudgeEnabled(true);
    useSettingsStore.getState().setMealPlanNudgeLastFiredWeekKey('2026-08-09');
    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().mealPlanNudgeEnabled).toBe(false);
    expect(useSettingsStore.getState().mealPlanNudgeLastFiredWeekKey).toBe('2026-08-09');
  });
});

describe('setVacationEnd', () => {
  it('updates vacationEnd independently of vacationMode', () => {
    useSettingsStore.getState().setVacationEnd('2025-09-01T23:59:59.999Z');
    expect(useSettingsStore.getState().vacationEnd).toBe('2025-09-01T23:59:59.999Z');
  });

  it('persists the value to the database', () => {
    useSettingsStore.getState().setVacationEnd('2025-09-01T23:59:59.999Z');
    expect(dbSetSetting).toHaveBeenCalledWith('vacationEnd', '2025-09-01T23:59:59.999Z');
  });

  it('clears the end date when passed null', () => {
    useSettingsStore.getState().setVacationEnd('2025-09-01T23:59:59.999Z');
    useSettingsStore.getState().setVacationEnd(null);
    expect(useSettingsStore.getState().vacationEnd).toBeNull();
  });
});

// ─── formatting, haptics, and the persisted sort & filter ────────────────────

describe('use24HourTime', () => {
  it('defaults to 12-hour', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().use24HourTime).toBe(false);
  });

  it('round-trips through the settings table', () => {
    useSettingsStore.getState().setUse24HourTime(true);
    expect(dbSetSetting).toHaveBeenCalledWith('use24HourTime', 'true');
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'use24HourTime' ? 'true' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().use24HourTime).toBe(true);
  });
});

describe('unitSystem', () => {
  it('defaults to as-written, so an existing install reads exactly as it did', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().unitSystem).toBe('asWritten');
  });

  it('round-trips through the settings table', () => {
    useSettingsStore.getState().setUnitSystem('metric');
    expect(dbSetSetting).toHaveBeenCalledWith('unitSystem', 'metric');
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'unitSystem' ? 'metric' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().unitSystem).toBe('metric');
  });

  it('falls back to as-written for a value that is not a system', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'unitSystem' ? 'imperial' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().unitSystem).toBe('asWritten');
  });
});

describe('use-up task settings', () => {
  const stored = (rows: Record<string, string>) =>
    (dbGetSetting as jest.Mock).mockImplementation((key: string) => rows[key] ?? null);

  it('defaults off — the one setting here that can put rows on a task list by itself', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpTasks).toBe(false);
  });

  it('round-trips through the settings table', () => {
    useSettingsStore.getState().setGroceryUseUpTasks(true);
    expect(dbSetSetting).toHaveBeenCalledWith('groceryUseUpTasks', 'true');
    stored({ groceryUseUpTasks: 'true' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpTasks).toBe(true);
  });

  it('defaults the lead time to a day rather than reading a missing row as zero', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpLeadDays).toBe(1);
  });

  it('keeps a stored zero — "on the use-by day" is a real answer', () => {
    stored({ groceryUseUpLeadDays: '0' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpLeadDays).toBe(0);
  });

  it('falls back for a value out of range or not a number', () => {
    stored({ groceryUseUpLeadDays: '400' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpLeadDays).toBe(1);

    stored({ groceryUseUpLeadDays: 'soon' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpLeadDays).toBe(1);
  });

  it('clamps what the setter is given rather than storing it', () => {
    useSettingsStore.getState().setGroceryUseUpLeadDays(99);
    expect(dbSetSetting).toHaveBeenCalledWith('groceryUseUpLeadDays', '14');
    useSettingsStore.getState().setGroceryUseUpLeadDays(-3);
    expect(dbSetSetting).toHaveBeenCalledWith('groceryUseUpLeadDays', '0');
  });

  it('stores no category as an empty string, and reads it back as null', () => {
    useSettingsStore.getState().setGroceryUseUpTaskCategory(null);
    expect(dbSetSetting).toHaveBeenCalledWith('groceryUseUpTaskCategory', '');
    stored({ groceryUseUpTaskCategory: '' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().groceryUseUpTaskCategory).toBeNull();
  });

  // The loop in resetToDefaults writes String(null) — a category literally
  // named "null", which Today would grow a section header for.
  it('resets the category to no category, not to the string "null"', () => {
    useSettingsStore.getState().resetToDefaults();
    expect(dbSetSetting).toHaveBeenCalledWith('groceryUseUpTaskCategory', '');
    expect(useSettingsStore.getState().groceryUseUpTaskCategory).toBeNull();
  });
});

describe('weekStartsOn', () => {
  it('defaults to Sunday', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().weekStartsOn).toBe(0);
  });

  it('round-trips Monday', () => {
    useSettingsStore.getState().setWeekStartsOn(1);
    expect(dbSetSetting).toHaveBeenCalledWith('weekStartsOn', '1');
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'weekStartsOn' ? '1' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().weekStartsOn).toBe(1);
  });

  it('falls back to Sunday for a value that is neither 0 nor 1', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'weekStartsOn' ? '5' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().weekStartsOn).toBe(0);
  });
});

describe('fabHand', () => {
  it('defaults to the right corner, so an existing install is unchanged', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().fabHand).toBe('right');
  });

  it('round-trips left', () => {
    useSettingsStore.getState().setFabHand('left');
    expect(dbSetSetting).toHaveBeenCalledWith('fabHand', 'left');
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'fabHand' ? 'left' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().fabHand).toBe('left');
  });

  it('falls back to right for anything that is not exactly "left"', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'fabHand' ? 'LEFT' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().fabHand).toBe('right');
  });
});

describe('hapticsEnabled', () => {
  // Defaults on rather than off, so an install predating the setting doesn't
  // silently lose the haptics it already had.
  it('defaults to on, including when nothing is stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().hapticsEnabled).toBe(true);
  });

  it('only turns off for an explicit "false"', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'hapticsEnabled' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().hapticsEnabled).toBe(false);
  });
});

describe('shakeToUndoEnabled', () => {
  // Same reasoning as hapticsEnabled: defaults on so an install predating the
  // setting keeps the gesture it already had.
  it('defaults to on, including when nothing is stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().shakeToUndoEnabled).toBe(true);
  });

  it('only turns off for an explicit "false"', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'shakeToUndoEnabled' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().shakeToUndoEnabled).toBe(false);
  });

  it('round-trips through setShakeToUndoEnabled', () => {
    useSettingsStore.getState().setShakeToUndoEnabled(false);
    expect(dbSetSetting).toHaveBeenCalledWith('shakeToUndoEnabled', 'false');
    expect(useSettingsStore.getState().shakeToUndoEnabled).toBe(false);
  });
});

describe('timerLiveActivity', () => {
  // Same reasoning as hapticsEnabled/shakeToUndoEnabled: defaults on so an
  // install predating the setting keeps the Live Activity it already had.
  it('defaults to on, including when nothing is stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().timerLiveActivity).toBe(true);
  });

  it('only turns off for an explicit "false"', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'timerLiveActivity' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().timerLiveActivity).toBe(false);
  });

  it('round-trips through setTimerLiveActivity', () => {
    useSettingsStore.getState().setTimerLiveActivity(false);
    expect(dbSetSetting).toHaveBeenCalledWith('timerLiveActivity', 'false');
    expect(useSettingsStore.getState().timerLiveActivity).toBe(false);
  });
});

describe('kitchenEnabled', () => {
  // Same `!== 'false'` reading as timerLiveActivity above: every install that
  // predates this setting keeps the groceries area it already had.
  it('defaults to on, including when nothing is stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().kitchenEnabled).toBe(true);
  });

  it('only turns off for an explicit "false"', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'kitchenEnabled' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().kitchenEnabled).toBe(false);
  });

  it('round-trips through setKitchenEnabled', () => {
    useSettingsStore.getState().setKitchenEnabled(false);
    expect(dbSetSetting).toHaveBeenCalledWith('kitchenEnabled', 'false');
    expect(useSettingsStore.getState().kitchenEnabled).toBe(false);
  });

  // The whole promise of the setting: it hides, it doesn't reconfigure. A
  // turn-off that wrote these to their own "off" values would lose what the
  // user had chosen, and turning the area back on would return it changed.
  it('leaves every downstream kitchen setting exactly as it was', () => {
    useSettingsStore.getState().setMealsOnToday('block');
    useSettingsStore.getState().setMealCookTasks(false);
    useSettingsStore.getState().setMealPlanNudgeEnabled(true);
    useSettingsStore.getState().setGroceryImportEnabled(true);
    useSettingsStore.getState().setGroceryImportListId('list-1');
    useSettingsStore.getState().setGroceryImportConfirmedListId('list-1');

    useSettingsStore.getState().setKitchenEnabled(false);

    const state = useSettingsStore.getState();
    expect(state.mealsOnToday).toBe('block');
    expect(state.mealCookTasks).toBe(false);
    expect(state.mealPlanNudgeEnabled).toBe(true);
    expect(state.groceryImportEnabled).toBe(true);
    // The confirmed-list pair especially: clearing it would make re-enabling
    // re-ask for a confirmation the user already gave.
    expect(state.groceryImportListId).toBe('list-1');
    expect(state.groceryImportConfirmedListId).toBe('list-1');
  });
});

describe('persisted sort', () => {
  it('defaults to the user-defined order', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().sortOption).toBe('default');
  });

  it('round-trips a real sort option', () => {
    useSettingsStore.getState().setSortOption('due-date');
    expect(dbSetSetting).toHaveBeenCalledWith('sortOption', 'due-date');
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'sortOption' ? 'due-date' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().sortOption).toBe('due-date');
  });

  it('rejects a stored value that is not a sort option', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'sortOption' ? 'by-vibes' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().sortOption).toBe('default');
  });
});

describe('persisted filters', () => {
  const storing = (values: Record<string, string>) =>
    (dbGetSetting as jest.Mock).mockImplementation((key: string) => values[key] ?? null);

  it('defaults to no filters', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().filterPriorities).toEqual([]);
    expect(useSettingsStore.getState().filterEfforts).toEqual([]);
  });

  it('round-trips both filter arrays as JSON', () => {
    useSettingsStore.getState().setFilterPriorities([2, 4]);
    useSettingsStore.getState().setFilterEfforts([0, 6]);
    expect(dbSetSetting).toHaveBeenCalledWith('filterPriorities', '[2,4]');
    expect(dbSetSetting).toHaveBeenCalledWith('filterEfforts', '[0,6]');
    storing({ filterPriorities: '[2,4]', filterEfforts: '[0,6]' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().filterPriorities).toEqual([2, 4]);
    expect(useSettingsStore.getState().filterEfforts).toEqual([0, 6]);
  });

  // A filter hides tasks, so a value that survives validation but isn't a real
  // priority would empty Today with nothing to explain it.
  it('drops entries outside the valid range', () => {
    storing({ filterPriorities: '[0,4,9,-1]', filterEfforts: '[3,6,7]' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().filterPriorities).toEqual([0, 4]);
    expect(useSettingsStore.getState().filterEfforts).toEqual([3, 6]);
  });

  it('drops non-integer and non-numeric entries', () => {
    storing({ filterPriorities: '[1,"2",2.5,null]' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().filterPriorities).toEqual([1]);
  });

  it('falls back to no filter for unparseable or non-array JSON', () => {
    storing({ filterPriorities: 'not json', filterEfforts: '{"a":1}' });
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().filterPriorities).toEqual([]);
    expect(useSettingsStore.getState().filterEfforts).toEqual([]);
  });
});

// ─── postpone check ───

describe('postpone check settings', () => {
  it('defaults to on, at a threshold of 3', () => {
    expect(useSettingsStore.getState().postponeCheckEnabled).toBe(true);
    expect(useSettingsStore.getState().postponeCheckThreshold).toBe(3);
  });

  it('stays on for an install that predates the setting', () => {
    // Nothing stored: the read is `!== 'false'`, so an upgrade arrives with the
    // prompt available rather than silently off.
    (dbGetSetting as jest.Mock).mockReturnValue(null);
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().postponeCheckEnabled).toBe(true);
  });

  it('only turns off for an explicitly stored "false"', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'postponeCheckEnabled' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().postponeCheckEnabled).toBe(false);
  });

  it('stores and persists postponeCheckEnabled', () => {
    useSettingsStore.getState().setPostponeCheckEnabled(false);
    expect(useSettingsStore.getState().postponeCheckEnabled).toBe(false);
    expect(dbSetSetting).toHaveBeenCalledWith('postponeCheckEnabled', 'false');
  });

  it('stores and persists postponeCheckThreshold', () => {
    useSettingsStore.getState().setPostponeCheckThreshold(6);
    expect(useSettingsStore.getState().postponeCheckThreshold).toBe(6);
    expect(dbSetSetting).toHaveBeenCalledWith('postponeCheckThreshold', '6');
  });

  it('clamps a threshold that would put the prompt out of reach', () => {
    useSettingsStore.getState().setPostponeCheckThreshold(999);
    expect(useSettingsStore.getState().postponeCheckThreshold).toBe(15);
    useSettingsStore.getState().setPostponeCheckThreshold(0);
    expect(useSettingsStore.getState().postponeCheckThreshold).toBe(2);
  });

  it('reads an unparseable stored threshold back as the default', () => {
    // NaN would compare false against every count and silently disable the
    // prompt, which is the failure mode worth guarding.
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'postponeCheckThreshold' ? 'null' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().postponeCheckThreshold).toBe(3);
  });

  it('resetToDefaults restores both', () => {
    useSettingsStore.getState().setPostponeCheckEnabled(false);
    useSettingsStore.getState().setPostponeCheckThreshold(9);
    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().postponeCheckEnabled).toBe(true);
    expect(useSettingsStore.getState().postponeCheckThreshold).toBe(3);
  });
});
