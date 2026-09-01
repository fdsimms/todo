const mockAvailable = jest.fn();
const mockAvailability = jest.fn();
const mockGenerate = jest.fn();
const mockIsDemoModeActive = jest.fn(() => false);

jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockIsDemoModeActive(),
  setDemoModeActive: jest.fn(),
}));

jest.mock('todo-foundation-models', () => ({
  isOnDeviceModelAvailable: () => mockAvailable(),
  onDeviceModelAvailability: () => mockAvailability(),
  generateOnDevice: (prompt: string, schema: unknown) => mockGenerate(prompt, schema),
}), { virtual: true });

import {
  isOnDeviceReady,
  onDeviceAvailability,
  describeOnDeviceAvailability,
  describeOnDeviceError,
  isOnDeviceErrorMessage,
  runOnDevice,
} from '../services/onDeviceModel';

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable.mockReturnValue(true);
  mockAvailability.mockReturnValue('available');
});

describe('availability', () => {
  it('passes the native answer through', () => {
    expect(isOnDeviceReady()).toBe(true);
    expect(onDeviceAvailability()).toBe('available');
  });

  it('reads a native throw as unavailable rather than propagating it', () => {
    mockAvailable.mockImplementation(() => { throw new Error('not linked'); });
    mockAvailability.mockImplementation(() => { throw new Error('not linked'); });
    expect(isOnDeviceReady()).toBe(false);
    expect(onDeviceAvailability()).toBe('unavailable');
  });
});

describe('describeOnDeviceAvailability', () => {
  it('says nothing when the model is ready', () => {
    expect(describeOnDeviceAvailability('available')).toBeNull();
  });

  // The one with no route forward. A row that only said "unavailable" would
  // read as a bug to someone holding an older iPhone, so the copy has to say
  // the hardware is the reason.
  it('explains an ineligible device rather than implying a fix', () => {
    const copy = describeOnDeviceAvailability('deviceNotEligible');
    expect(copy).toContain('doesn\'t support Apple Intelligence');
  });

  it('points at the Settings app when Apple Intelligence is merely off', () => {
    expect(describeOnDeviceAvailability('notEnabled')).toContain('Settings app');
  });

  it('says a download in progress will finish on its own', () => {
    expect(describeOnDeviceAvailability('notReady')).toContain('still setting up');
  });

  it('has copy for every state', () => {
    for (const state of ['deviceNotEligible', 'notEnabled', 'notReady', 'unavailable'] as const) {
      expect(describeOnDeviceAvailability(state)).toBeTruthy();
    }
  });
});

describe('runOnDevice', () => {
  it('hands the prompt and schema to the native module', async () => {
    mockGenerate.mockResolvedValue([{ name: 'tofu', aisle: 'Dairy & Eggs' }]);
    const schema = { name: 'X', fields: [{ name: 'name', type: 'string' as const }] };
    await expect(runOnDevice('go', schema)).resolves.toEqual([{ name: 'tofu', aisle: 'Dairy & Eggs' }]);
    expect(mockGenerate).toHaveBeenCalledWith('go', schema);
  });

  // Rejects rather than resolving empty: a caller has already checked
  // availability, so "nothing came back" and "there is no model" are different
  // answers and only one of them is worth retrying.
  it('rejects when the native module is missing', async () => {
    jest.resetModules();
    jest.doMock('todo-foundation-models', () => { throw new Error('not linked'); }, { virtual: true });
    const { runOnDevice: run } = require('../services/onDeviceModel');
    await expect(run('go', { name: 'X', fields: [] })).rejects.toThrow('On-device model unavailable');
    jest.resetModules();
  });
});

describe('error copy', () => {
  it('recognises its own failures so they are not read as network failures', () => {
    expect(isOnDeviceErrorMessage('On-device model unavailable')).toBe(true);
    expect(isOnDeviceErrorMessage('On-device model returned malformed output')).toBe(true);
    expect(isOnDeviceErrorMessage('API error 429')).toBe(false);
    expect(isOnDeviceErrorMessage('')).toBe(false);
  });

  it('never tells someone to check a connection nothing used', () => {
    for (const message of ['On-device model unavailable', 'On-device model returned malformed output']) {
      expect(describeOnDeviceError(new Error(message)).toLowerCase()).not.toContain('connection');
    }
  });
});

// The gate the rest of the app's integrations all carry, deliberately absent
// here. Pinned so a later reader doesn't add one back assuming it was missed:
// on-device inference writes nothing outside SQLite and consumes no queue, so
// neither half of the demo-mode rule in CLAUDE.md applies.
describe('demo mode', () => {
  it('is not consulted', () => {
    isOnDeviceReady();
    onDeviceAvailability();
    expect(mockIsDemoModeActive).not.toHaveBeenCalled();
  });
});
