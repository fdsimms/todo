/**
 * Tests for src/services/placeSearch.ts. Like geocode.test.ts, what matters is
 * the refusals: demo mode, the feature's own switch, and a query too short to
 * send. The call needs no key, so nothing else would stop it.
 */
import { searchPlaces } from '../services/placeSearch';
import { isDemoModeActive } from '../utils/demoState';

const settings = { placeSuggestionsEnabled: true };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));
const mockSearch = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({ searchPlacesRaw: (q: string) => mockSearch(q) }), { virtual: true });

const demoMock = isDemoModeActive as jest.MockedFunction<typeof isDemoModeActive>;

beforeEach(() => {
  settings.placeSuggestionsEnabled = true;
  demoMock.mockReturnValue(false);
  mockSearch.mockReset();
  mockSearch.mockResolvedValue([{ name: "Joe's Pizza", address: '7 Carmine St', latitude: 40.7, longitude: -74 }]);
});

it('asks Apple Maps and returns the parsed places', async () => {
  await expect(searchPlaces("  joe's pizza ")).resolves.toEqual([
    { name: "Joe's Pizza", address: '7 Carmine St', latitude: 40.7, longitude: -74 },
  ]);
  expect(mockSearch).toHaveBeenCalledWith("joe's pizza");
});

it('sends nothing while the setting is off', async () => {
  settings.placeSuggestionsEnabled = false;
  await expect(searchPlaces("joe's pizza")).resolves.toEqual([]);
  expect(mockSearch).not.toHaveBeenCalled();
});

it('sends nothing in demo mode', async () => {
  demoMock.mockReturnValue(true);
  await expect(searchPlaces("joe's pizza")).resolves.toEqual([]);
  expect(mockSearch).not.toHaveBeenCalled();
});

it('sends nothing for a query under three characters', async () => {
  await expect(searchPlaces(' jo ')).resolves.toEqual([]);
  expect(mockSearch).not.toHaveBeenCalled();
});

it('returns nothing when the search fails', async () => {
  mockSearch.mockRejectedValue(new Error('offline'));
  await expect(searchPlaces("joe's pizza")).resolves.toEqual([]);
});
