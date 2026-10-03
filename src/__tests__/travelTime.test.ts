/**
 * Tests for src/services/travelTime.ts: the refusals. The call needs no key,
 * so its switch and demo mode are all that stand between an appointment's
 * address and Apple.
 */
import { estimateTravelMinutes } from '../services/travelTime';
import { isDemoModeActive } from '../utils/demoState';

const settings = { travelTasks: true, travelEstimates: true };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));
const mockEstimate = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({
  estimateTravelTime: (...args: unknown[]) => mockEstimate(...args),
}), { virtual: true });

const demoMock = isDemoModeActive as jest.MockedFunction<typeof isDemoModeActive>;
const departAt = new Date(2026, 9, 5, 13, 30);
const dentist = { id: 'e-1', location: ' 123 Main St ' };

beforeEach(() => {
  settings.travelTasks = true;
  settings.travelEstimates = true;
  demoMock.mockReturnValue(false);
  mockEstimate.mockReset();
  mockEstimate.mockResolvedValue(24);
});

it('asks Apple Maps for the trip to the event, by the chosen mode', async () => {
  await expect(estimateTravelMinutes(dentist, departAt, 'transit')).resolves.toBe(24);
  expect(mockEstimate).toHaveBeenCalledWith('e-1', '123 Main St', departAt, 'transit');
});

it('sends nothing while estimates or travel tasks are off', async () => {
  settings.travelEstimates = false;
  await expect(estimateTravelMinutes(dentist, departAt, 'driving')).resolves.toBeNull();
  settings.travelEstimates = true;
  settings.travelTasks = false;
  await expect(estimateTravelMinutes(dentist, departAt, 'driving')).resolves.toBeNull();
  expect(mockEstimate).not.toHaveBeenCalled();
});

it('sends nothing in demo mode, or for an event with no location', async () => {
  demoMock.mockReturnValue(true);
  await expect(estimateTravelMinutes(dentist, departAt, 'driving')).resolves.toBeNull();
  demoMock.mockReturnValue(false);
  await expect(estimateTravelMinutes({ id: 'e-2', location: '  ' }, departAt, 'driving')).resolves.toBeNull();
  expect(mockEstimate).not.toHaveBeenCalled();
});

it('returns null when the estimate fails', async () => {
  mockEstimate.mockRejectedValue(new Error('no route'));
  await expect(estimateTravelMinutes(dentist, departAt, 'walking')).resolves.toBeNull();
});
