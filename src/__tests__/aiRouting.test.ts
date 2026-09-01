import { routeForFeature, supportsOnDevice, ON_DEVICE_FEATURES } from '../utils/aiRouting';
import { AI_FEATURE_IDS } from '../utils/aiFeatures';

const ready = {
  enabled: true,
  hasApiKey: false,
  onDeviceEnabled: true,
  onDeviceAvailable: true,
};

describe('supportsOnDevice', () => {
  it('carries grocery aisles', () => {
    expect(supportsOnDevice('groceryAisles')).toBe(true);
  });

  // The window is ~4k tokens for prompt and completion together, and three of
  // these are photographs. If one is ever added, it should be because it was
  // measured, not because the set looked short.
  it('carries nothing that needs vision or long context', () => {
    for (const id of ['recipeExtraction', 'receiptImport', 'calendarImport', 'mealIdeas'] as const) {
      expect(supportsOnDevice(id)).toBe(false);
    }
  });

  it('only names features that exist', () => {
    for (const id of ON_DEVICE_FEATURES) {
      expect(AI_FEATURE_IDS).toContain(id);
    }
  });
});

describe('routeForFeature', () => {
  it('routes to the device when there is no key and the model is there', () => {
    expect(routeForFeature('groceryAisles', ready)).toBe('onDevice');
  });

  it('prefers Claude whenever there is a key', () => {
    expect(routeForFeature('groceryAisles', { ...ready, hasApiKey: true })).toBe('claude');
  });

  // The one that matters most: on-device is a floor under the features, never
  // a way past a switch. Someone who turned aisle sorting off asked for no
  // aisle sorting, not for a different engine to do it.
  it('respects the feature switch even when the model is available', () => {
    expect(routeForFeature('groceryAisles', { ...ready, enabled: false })).toBe('unavailable');
    expect(routeForFeature('groceryAisles', { ...ready, enabled: false, hasApiKey: true }))
      .toBe('unavailable');
  });

  it('respects the on-device switch', () => {
    expect(routeForFeature('groceryAisles', { ...ready, onDeviceEnabled: false }))
      .toBe('unavailable');
  });

  // An ineligible device, Apple Intelligence off, or assets still downloading
  // all arrive here as one false, and all mean the entry point must not render.
  it('is unavailable when the device has no model', () => {
    expect(routeForFeature('groceryAisles', { ...ready, onDeviceAvailable: false }))
      .toBe('unavailable');
  });

  it('never routes an unsupported feature to the device', () => {
    expect(routeForFeature('receiptImport', ready)).toBe('unavailable');
    expect(routeForFeature('recipeExtraction', ready)).toBe('unavailable');
  });

  it('leaves every unsupported feature exactly as it was without a key', () => {
    for (const id of AI_FEATURE_IDS) {
      if (supportsOnDevice(id)) continue;
      expect(routeForFeature(id, ready)).toBe('unavailable');
      expect(routeForFeature(id, { ...ready, hasApiKey: true })).toBe('claude');
    }
  });
});
