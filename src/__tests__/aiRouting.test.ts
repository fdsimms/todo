import {
  onDeviceEngineFor, routeForFeature, supportsOnDevice, ON_DEVICE_FEATURES,
} from '../utils/aiRouting';
import { AI_FEATURE_IDS } from '../utils/aiFeatures';

const ready = {
  enabled: true,
  hasApiKey: false,
  onDeviceEnabled: true,
  onDeviceAvailable: true,
  visionAvailable: true,
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

  it('never routes a feature no engine carries to the device', () => {
    expect(routeForFeature('recipeExtraction', ready)).toBe('unavailable');
    expect(routeForFeature('mealIdeas', ready)).toBe('unavailable');
  });

  it('leaves a feature no engine carries exactly as it was without a key', () => {
    for (const id of AI_FEATURE_IDS) {
      if (onDeviceEngineFor(id) !== null) continue;
      expect(routeForFeature(id, ready)).toBe('unavailable');
      expect(routeForFeature(id, { ...ready, hasApiKey: true })).toBe('claude');
    }
  });

  // Receipt scanning takes the other engine: Vision transcribes the paper, so
  // the reading happens with no key and no language model.
  describe('a feature Vision carries', () => {
    it('routes to the device when Vision can read here', () => {
      expect(routeForFeature('receiptImport', ready)).toBe('onDevice');
    });

    it('still prefers Claude whenever there is a key', () => {
      expect(routeForFeature('receiptImport', { ...ready, hasApiKey: true })).toBe('claude');
    });

    // The bug this routing exists to prevent: an offline read is still the
    // feature, so a switched-off feature must not quietly keep working just
    // because nothing has to be paid for it.
    it('respects the feature switch, same as every other route', () => {
      expect(routeForFeature('receiptImport', { ...ready, enabled: false }))
        .toBe('unavailable');
    });

    // Vision is not Apple Intelligence and is not what that switch is about.
    // Turning the model off must not take receipt scanning away with it.
    it('ignores the Apple Intelligence switch and the model\'s availability', () => {
      expect(routeForFeature('receiptImport', {
        ...ready, onDeviceEnabled: false, onDeviceAvailable: false,
      })).toBe('onDevice');
    });

    it('is unavailable where Vision cannot read', () => {
      expect(routeForFeature('receiptImport', { ...ready, visionAvailable: false }))
        .toBe('unavailable');
    });

    // And the converse, so the two engines cannot quietly become one: the
    // language model's feature must not start answering to Vision.
    it('does not let Vision carry a language-model feature', () => {
      expect(routeForFeature('groceryAisles', {
        ...ready, onDeviceEnabled: false, visionAvailable: true,
      })).toBe('unavailable');
    });
  });
});

describe('onDeviceEngineFor', () => {
  it('sends aisle sorting to the language model and receipts to Vision', () => {
    expect(onDeviceEngineFor('groceryAisles')).toBe('languageModel');
    expect(onDeviceEngineFor('receiptImport')).toBe('vision');
  });

  it('names no engine for a feature neither can carry', () => {
    expect(onDeviceEngineFor('recipeExtraction')).toBeNull();
  });

  // supportsOnDevice is about the 4k window and text-only input, so a Vision
  // feature must never appear in it however keyless it is.
  it('keeps supportsOnDevice meaning the language model alone', () => {
    expect(supportsOnDevice('receiptImport')).toBe(false);
    expect(ON_DEVICE_FEATURES.has('receiptImport')).toBe(false);
  });
});
