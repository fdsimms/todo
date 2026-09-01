// Which engine answers an AI feature, given what this install actually has.
//
// A pure function rather than a branch inside each call site, because the
// answer is needed in two places that must not disagree: the service, deciding
// what to call, and the screen, deciding whether the entry point exists at all.
// A button that opens a sheet that can only apologise is the failure this
// prevents — see GroceryScreen's own note on why the tidy action was gated on
// a key in the first place.

import type { AiFeatureId } from './aiFeatures';

export type AiRoute = 'claude' | 'onDevice' | 'unavailable';

/**
 * The features the on-device model can actually carry.
 *
 * Deliberately a list rather than a flag on `AiFeatureMeta`: the constraint is
 * the model's own (a ~4k-token window shared between prompt and completion,
 * text only), not a property of the feature, and writing it here keeps the
 * reason with the rule. Everything absent from this set needs vision or more
 * context than the window holds — `recipeExtraction` and `receiptImport` are
 * photographs, `calendarImport` can be, and `mealIdeas` wants world knowledge.
 *
 * `groceryAisles` is the only member for now, on purpose. It has the best
 * measured gap over the offline lexicon, the smallest input, and a
 * review-then-apply sheet in front of it, so a mediocre answer costs a glance.
 * Adding the next one is a measurement, not a judgement call.
 */
export const ON_DEVICE_FEATURES: ReadonlySet<AiFeatureId> = new Set<AiFeatureId>(['groceryAisles']);

export function supportsOnDevice(id: AiFeatureId): boolean {
  return ON_DEVICE_FEATURES.has(id);
}

export interface AiRouteInput {
  /** The feature's own switch in Settings. */
  enabled: boolean;
  hasApiKey: boolean;
  /** The single on-device switch in Settings. */
  onDeviceEnabled: boolean;
  /** What the device says right now — see `onDeviceModelAvailability`. */
  onDeviceAvailable: boolean;
}

/**
 * Four rules, in this order, and the order is the design:
 *
 * 1. **The feature's own switch wins outright.** Someone who turned grocery
 *    aisle sorting off asked for no aisle sorting, not for a quieter engine to
 *    do it instead. On-device is a floor under the features, never a way past
 *    a switch.
 * 2. **A key means Claude.** The on-device path is not offered to a key holder
 *    even for the small calls it could plausibly serve faster, because "could
 *    plausibly" is the whole of the evidence: nothing here has measured
 *    on-device latency for a 60-name batch against a Haiku round trip, and
 *    quietly making an existing, working feature worse is the one outcome this
 *    change must not have. That routing is a follow-up with a number attached.
 * 3. **No key, but a working model, means on-device.** The point of the
 *    exercise.
 * 4. **Otherwise nothing**, and the caller must not render an entry point.
 */
export function routeForFeature(id: AiFeatureId, input: AiRouteInput): AiRoute {
  if (!input.enabled) return 'unavailable';
  if (input.hasApiKey) return 'claude';
  if (supportsOnDevice(id) && input.onDeviceEnabled && input.onDeviceAvailable) return 'onDevice';
  return 'unavailable';
}
