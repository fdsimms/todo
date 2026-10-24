let mockSettings: { healthWriteEnabled: boolean } = { healthWriteEnabled: false };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockWrite = jest.fn();
const mockWritePulse = jest.fn();
let mockBridge: {
  writeBloodPressureSample: (s: number, d: number, p: number | null, w: string) => Promise<string>;
  writeHeartRateSample: (p: number, w: string) => Promise<boolean>;
} | null = null;
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => mockBridge,
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { logBloodPressureToHealth, logPulseToHealth } from '../utils/healthBloodPressureSync';

const WHEN = new Date('2026-09-10T08:30:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { healthWriteEnabled: true };
  mockDemoActive = false;
  mockBridge = { writeBloodPressureSample: mockWrite, writeHeartRateSample: mockWritePulse };
  mockWrite.mockResolvedValue('saved');
  mockWritePulse.mockResolvedValue(true);
});

describe('logBloodPressureToHealth', () => {
  it('writes both numbers and the instant', async () => {
    expect(await logBloodPressureToHealth(118, 76, null, WHEN)).toBe('written');
    expect(mockWrite).toHaveBeenCalledWith(118, 76, null, WHEN.toISOString());
  });

  it('does nothing when the write setting is off', async () => {
    mockSettings.healthWriteEnabled = false;
    expect(await logBloodPressureToHealth(118, 76, null, WHEN)).toBe('off');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses a pair no reading could be', async () => {
    expect(await logBloodPressureToHealth(76, 118, null, WHEN)).toBe('invalid');
    expect(await logBloodPressureToHealth(900, 76, null, WHEN)).toBe('invalid');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses in demo mode before anything else', async () => {
    mockDemoActive = true;
    expect(await logBloodPressureToHealth(118, 76, null, WHEN)).toBe('unavailable');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('is unavailable with no native half', async () => {
    mockBridge = null;
    expect(await logBloodPressureToHealth(118, 76, null, WHEN)).toBe('unavailable');
  });

  it('reports a refused save', async () => {
    mockWrite.mockResolvedValue('failed');
    expect(await logBloodPressureToHealth(118, 76, null, WHEN)).toBe('refused');
  });

  it('passes a pulse along and refuses an implausible one', async () => {
    expect(await logBloodPressureToHealth(118, 76, 64, WHEN)).toBe('written');
    expect(mockWrite).toHaveBeenCalledWith(118, 76, 64, WHEN.toISOString());
    expect(await logBloodPressureToHealth(118, 76, 5, WHEN)).toBe('invalid');
  });

  it('says so when the reading landed and the pulse did not', async () => {
    mockWrite.mockResolvedValue('pulseRefused');
    expect(await logBloodPressureToHealth(118, 76, 64, WHEN)).toBe('writtenWithoutPulse');
  });
});

describe('logPulseToHealth', () => {
  it('writes the pulse and the instant', async () => {
    expect(await logPulseToHealth(64, WHEN)).toBe('written');
    expect(mockWritePulse).toHaveBeenCalledWith(64, WHEN.toISOString());
  });

  it('does nothing when the write setting is off', async () => {
    mockSettings.healthWriteEnabled = false;
    expect(await logPulseToHealth(64, WHEN)).toBe('off');
    expect(mockWritePulse).not.toHaveBeenCalled();
  });

  it('refuses a number no pulse could be', async () => {
    expect(await logPulseToHealth(12, WHEN)).toBe('invalid');
    expect(await logPulseToHealth(64.5, WHEN)).toBe('invalid');
    expect(mockWritePulse).not.toHaveBeenCalled();
  });

  it('refuses in demo mode before anything else', async () => {
    mockDemoActive = true;
    expect(await logPulseToHealth(64, WHEN)).toBe('unavailable');
    expect(mockWritePulse).not.toHaveBeenCalled();
  });

  it('is unavailable with no native half, and reports a refused save', async () => {
    mockWritePulse.mockResolvedValue(false);
    expect(await logPulseToHealth(64, WHEN)).toBe('refused');
    mockBridge = null;
    expect(await logPulseToHealth(64, WHEN)).toBe('unavailable');
  });
});
