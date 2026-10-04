const mockNavigateToTab = jest.fn();
jest.mock('../navigation/navigationRef', () => ({
  navigateToTab: (...args: unknown[]) => mockNavigateToTab(...args),
}));

import { navigateToSettingsEntry, openSettingsGroup } from '../navigation/openSettings';

beforeEach(() => mockNavigateToTab.mockClear());

describe('navigateToSettingsEntry', () => {
  it('opens a row in a Settings group on that group', () => {
    const navigate = jest.fn();
    expect(navigateToSettingsEntry({ navigate }, 'healthWrite')).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      'SettingsGroup', { groupId: 'health', entryId: 'healthWrite' });
    expect(mockNavigateToTab).not.toHaveBeenCalled();
  });

  it('opens an automatic-task row on the Automations tab, which a card can reach', () => {
    const navigate = jest.fn();
    expect(navigateToSettingsEntry({ navigate }, 'gen:weather')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(mockNavigateToTab).toHaveBeenCalledWith(
      'Automations', expect.objectContaining({ entryId: 'gen:weather', focusStamp: expect.any(Number) }));
  });

  it('refuses an id no entry has, rather than landing somewhere arbitrary', () => {
    const navigate = jest.fn();
    expect(navigateToSettingsEntry({ navigate }, 'noSuchRow')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(mockNavigateToTab).not.toHaveBeenCalled();
  });
});

describe('openSettingsGroup', () => {
  it('opens a group from the index on its own page', () => {
    const navigate = jest.fn();
    openSettingsGroup({ navigate }, 'appearance');
    expect(navigate).toHaveBeenCalledWith('SettingsGroup', { groupId: 'appearance', entryId: undefined });
  });
});
