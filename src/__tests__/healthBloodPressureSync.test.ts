let mockSettings: { healthWriteEnabled: boolean } = { healthWriteEnabled: false };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockWrite = jest.fn();
let mockBridge: { writeBloodPressureSample: (s: number, d: number, w: string) => Promise<boolean> } | null = null;
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => mockBridge,
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { logBloodPressureToHealth } from '../utils/healthBloodPressureSync';

const WHEN = new Date('2026-09-10T08:30:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { healthWriteEnabled: true };
  mockDemoActive = false;
  mockBridge = { writeBloodPressureSample: mockWrite };
  mockWrite.mockResolvedValue(true);
});

describe('logBloodPressureToHealth', () => {
  it('writes both numbers and the instant', async () => {
    expect(await logBloodPressureToHealth(118, 76, WHEN)).toBe('written');
    expect(mockWrite).toHaveBeenCalledWith(118, 76, WHEN.toISOString());
  });

  it('does nothing when the write setting is off', async () => {
    mockSettings.healthWriteEnabled = false;
    expect(await logBloodPressureToHealth(118, 76, WHEN)).toBe('off');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses a pair no reading could be', async () => {
    expect(await logBloodPressureToHealth(76, 118, WHEN)).toBe('invalid');
    expect(await logBloodPressureToHealth(900, 76, WHEN)).toBe('invalid');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses in demo mode before anything else', async () => {
    mockDemoActive = true;
    expect(await logBloodPressureToHealth(118, 76, WHEN)).toBe('unavailable');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('is unavailable with no native half', async () => {
    mockBridge = null;
    expect(await logBloodPressureToHealth(118, 76, WHEN)).toBe('unavailable');
  });

  it('reports a refused save', async () => {
    mockWrite.mockResolvedValue(false);
    expect(await logBloodPressureToHealth(118, 76, WHEN)).toBe('refused');
  });
});
