import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetSetting, dbSetSetting } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  useSettingsStore.setState({ dayResetTime: '00:00', themeMode: 'dark', dailyCapacityMinutes: 360, initialized: false });
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

// ─── setDailyCapacityMinutes ──────────────────────────────────────────────────

describe('setDailyCapacityMinutes', () => {
  it('has a default of 360 minutes (6 hours)', () => {
    expect(useSettingsStore.getState().dailyCapacityMinutes).toBe(360);
  });

  it('updates dailyCapacityMinutes in state', () => {
    useSettingsStore.getState().setDailyCapacityMinutes(240);
    expect(useSettingsStore.getState().dailyCapacityMinutes).toBe(240);
  });

  it('persists the value to the database', () => {
    useSettingsStore.getState().setDailyCapacityMinutes(300);
    expect(dbSetSetting).toHaveBeenCalledWith('dailyCapacityMinutes', '300');
  });

  it('clamps below the 30-minute minimum', () => {
    useSettingsStore.getState().setDailyCapacityMinutes(0);
    expect(useSettingsStore.getState().dailyCapacityMinutes).toBe(30);
  });

  it('clamps above the 24-hour maximum', () => {
    useSettingsStore.getState().setDailyCapacityMinutes(10000);
    expect(useSettingsStore.getState().dailyCapacityMinutes).toBe(24 * 60);
  });

  it('rounds fractional minutes', () => {
    useSettingsStore.getState().setDailyCapacityMinutes(90.6);
    expect(useSettingsStore.getState().dailyCapacityMinutes).toBe(91);
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
