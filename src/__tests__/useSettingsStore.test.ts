import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetSetting, dbSetSetting } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  useSettingsStore.setState({ dayResetTime: '00:00', themeMode: 'dark', initialized: false });
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
