import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetSetting, dbSetSetting } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  useSettingsStore.setState({ dayResetTime: '00:00', themeMode: 'dark', patchNotesQaStatus: {}, initialized: false });
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

// ─── linkLiveActivity ────────────────────────────────────────────────────────

describe('linkLiveActivity', () => {
  it('defaults to true when nothing is stored', () => {
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().linkLiveActivity).toBe(true);
  });

  it('respects a stored false value', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'linkLiveActivity' ? 'false' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().linkLiveActivity).toBe(false);
  });

  it('respects a stored true value', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'linkLiveActivity' ? 'true' : null,
    );
    useSettingsStore.getState().initialize();
    expect(useSettingsStore.getState().linkLiveActivity).toBe(true);
  });

  it('setLinkLiveActivity(false) updates state and persists', () => {
    useSettingsStore.getState().setLinkLiveActivity(false);
    expect(useSettingsStore.getState().linkLiveActivity).toBe(false);
    expect(dbSetSetting).toHaveBeenCalledWith('linkLiveActivity', 'false');
  });

  it('setLinkLiveActivity(true) updates state and persists', () => {
    useSettingsStore.getState().setLinkLiveActivity(false);
    useSettingsStore.getState().setLinkLiveActivity(true);
    expect(useSettingsStore.getState().linkLiveActivity).toBe(true);
    expect(dbSetSetting).toHaveBeenCalledWith('linkLiveActivity', 'true');
  });
});
