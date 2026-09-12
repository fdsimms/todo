import { rhythmOptionsFromSettings } from '../utils/rhythmsSettings';
import { useSettingsStore } from '../store/useSettingsStore';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbGetAllSettings: jest.fn(() => new Map()),
  dbSetSetting: jest.fn(),
}));

beforeEach(() => {
  useSettingsStore.setState({
    morningStart: '06:00',
    afternoonStart: '12:00',
    eveningStart: '18:00',
    nightStart: '21:00',
    dayResetTime: '02:00',
  });
});

describe('rhythmOptionsFromSettings', () => {
  it('hands over the user’s own segment boundaries and day reset', () => {
    expect(rhythmOptionsFromSettings()).toEqual({
      boundaries: {
        morningStart: '06:00',
        afternoonStart: '12:00',
        eveningStart: '18:00',
        nightStart: '21:00',
      },
      dayResetTime: '02:00',
    });
  });

  it('reads the settings at call time rather than at import', () => {
    useSettingsStore.setState({ dayResetTime: '04:00' });
    expect(rhythmOptionsFromSettings().dayResetTime).toBe('04:00');
  });

  // The caller's own options win, so a screen can ask about a different window
  // without restating the boundaries.
  it('lets the caller override what it passes', () => {
    const options = rhythmOptionsFromSettings({ dayResetTime: '00:00' });
    expect(options.dayResetTime).toBe('00:00');
    expect(options.boundaries?.morningStart).toBe('06:00');
  });
});
