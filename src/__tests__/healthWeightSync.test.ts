let mockSettings: { healthWriteEnabled: boolean } = { healthWriteEnabled: false };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockWriteBodyMassSample = jest.fn();
let mockBridge: { writeBodyMassSample: (kg: number, whenISO: string) => Promise<boolean> } | null = null;
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => mockBridge,
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { logWeightToHealth } from '../utils/healthWeightSync';
import { MAX_WEIGHT_KG } from '../utils/weightLog';

const WHEN = new Date('2026-09-10T08:30:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { healthWriteEnabled: true };
  mockDemoActive = false;
  mockBridge = { writeBodyMassSample: mockWriteBodyMassSample };
  mockWriteBodyMassSample.mockResolvedValue(true);
});

describe('logWeightToHealth', () => {
  it('writes the weight and the instant it is for', async () => {
    const result = await logWeightToHealth(72.4, WHEN);
    expect(result).toBe('written');
    expect(mockWriteBodyMassSample).toHaveBeenCalledWith(72.4, WHEN.toISOString());
  });

  it('does nothing when the write setting is off', async () => {
    mockSettings.healthWriteEnabled = false;
    expect(await logWeightToHealth(72.4, WHEN)).toBe('off');
    expect(mockWriteBodyMassSample).not.toHaveBeenCalled();
  });

  it('refuses a non-positive weight', async () => {
    expect(await logWeightToHealth(0, WHEN)).toBe('invalid');
    expect(await logWeightToHealth(-5, WHEN)).toBe('invalid');
    expect(mockWriteBodyMassSample).not.toHaveBeenCalled();
  });

  it('refuses an absurd weight rather than recording it permanently', async () => {
    expect(await logWeightToHealth(MAX_WEIGHT_KG, WHEN)).toBe('invalid');
    expect(await logWeightToHealth(Number.POSITIVE_INFINITY, WHEN)).toBe('invalid');
    expect(await logWeightToHealth(Number.NaN, WHEN)).toBe('invalid');
    expect(mockWriteBodyMassSample).not.toHaveBeenCalled();
  });

  it('reports unavailable when there is no native half', async () => {
    mockBridge = null;
    expect(await logWeightToHealth(72.4, WHEN)).toBe('unavailable');
  });

  it('distinguishes a refused save from a missing bridge', async () => {
    // The person is standing there waiting, so "sharing is off" and "this
    // phone can't" have to be tellable apart in what they're shown.
    mockWriteBodyMassSample.mockResolvedValue(false);
    expect(await logWeightToHealth(72.4, WHEN)).toBe('refused');
  });

  it('never touches the device Health store while demo mode is active', async () => {
    // A demo session must not be able to put a real sample in a real medical
    // record — checked here as well as inside healthBridge().
    mockDemoActive = true;
    expect(await logWeightToHealth(72.4, WHEN)).toBe('unavailable');
    expect(mockWriteBodyMassSample).not.toHaveBeenCalled();
  });

  it('checks demo mode before the setting, so demo never reports "off"', async () => {
    mockDemoActive = true;
    mockSettings.healthWriteEnabled = false;
    expect(await logWeightToHealth(72.4, WHEN)).toBe('unavailable');
  });
});
