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
 * The two on-device engines, which are not interchangeable and do not answer
 * the same kind of question.
 *
 * - `languageModel` is Apple's on-device Foundation Model: it *reasons* about
 *   text, inside a ~4k-token window shared between prompt and completion, and
 *   is switched on and off by the user as "Apple Intelligence".
 * - `vision` is `VNRecognizeTextRequest`: it *transcribes* a photo and
 *   understands none of it. No window, no switch, no model.
 *
 * They are both "answered without a key on this device", which is why they
 * share the one `onDevice` route — what a caller does with that answer is the
 * feature's own business, and no screen has ever needed to know which engine
 * is behind it.
 */
export type OnDeviceEngine = 'languageModel' | 'vision';

/**
 * Which engine can carry each feature, where one can at all.
 *
 * Deliberately a map here rather than a flag on `AiFeatureMeta`: the constraint
 * is each engine's own, not a property of the feature, and writing it here
 * keeps the reason with the rule.
 *
 * `groceryAisles` goes to the language model because it has the best measured
 * gap over the offline lexicon, the smallest input, and a review-then-apply
 * sheet in front of it, so a mediocre answer costs a glance. Adding another to
 * *that* engine is a measurement, not a judgement call: everything absent needs
 * vision or more context than the window holds, since `recipeExtraction` is a
 * photograph, `calendarImport` can be, and `mealIdeas` wants world knowledge.
 *
 * `receiptImport` is a photograph too, and goes to `vision` for exactly that
 * reason rather than in spite of it. The device transcribes the paper; what it
 * cannot do is expand the shorthand, so the offline reading is honestly worse
 * and says so (`src/utils/receiptOffline.ts`). It is here because a worse
 * reading of a receipt is worth far more than no reading at all.
 */
const ON_DEVICE_ENGINE: Partial<Record<AiFeatureId, OnDeviceEngine>> = {
  groceryAisles: 'languageModel',
  receiptImport: 'vision',
};

export function onDeviceEngineFor(id: AiFeatureId): OnDeviceEngine | null {
  return ON_DEVICE_ENGINE[id] ?? null;
}

/**
 * The features Apple's on-device *language model* can carry.
 *
 * Still means only that, and not "can be answered without a key" — a feature
 * routed to `vision` is not in here and must not be, since what constrains this
 * set is the 4k window and the text-only input.
 */
export const ON_DEVICE_FEATURES: ReadonlySet<AiFeatureId> = new Set<AiFeatureId>(
  (Object.keys(ON_DEVICE_ENGINE) as AiFeatureId[]).filter(
    id => ON_DEVICE_ENGINE[id] === 'languageModel',
  ),
);

export function supportsOnDevice(id: AiFeatureId): boolean {
  return onDeviceEngineFor(id) === 'languageModel';
}

export interface AiRouteInput {
  /** The feature's own switch in Settings. */
  enabled: boolean;
  hasApiKey: boolean;
  /** The single on-device switch in Settings. Apple Intelligence only. */
  onDeviceEnabled: boolean;
  /** What the device says right now — see `onDeviceModelAvailability`. */
  onDeviceAvailable: boolean;
  /**
   * Whether Vision can read a photo here — see `canReadTextOnDevice`.
   *
   * Required rather than optional so a new call site cannot forget it and
   * silently route a `vision` feature to `unavailable`, which would read as the
   * feature being switched off rather than as a missing field.
   */
  visionAvailable: boolean;
  /**
   * The explicit, per-feature opt-in past rule 2 below: `AiFeatureConfig.preferOnDevice`.
   * Optional and false by default, so every existing caller keeps rule 2's
   * behavior unchanged — this only matters for a feature whose config was
   * deliberately set to it (grocery aisle sorting, at launch). It's a
   * *preference*, not a demand: if on-device can't actually answer (off, or
   * the model isn't ready), a key holder still falls through to Claude rather
   * than losing the feature outright.
   */
  preferOnDevice?: boolean;
}

/**
 * Five rules, in this order, and the order is the design:
 *
 * 1. **The feature's own switch wins outright.** Someone who turned grocery
 *    aisle sorting off asked for no aisle sorting, not for a quieter engine to
 *    do it instead. On-device is a floor under the features, never a way past
 *    a switch.
 * 2. **A key means Claude — unless the feature's own `preferOnDevice` opt-in
 *    says otherwise.** The on-device path is not offered to a key holder even
 *    for the small calls it could plausibly serve faster, because "could
 *    plausibly" is the whole of the evidence: nothing here has measured
 *    on-device latency for a 60-name batch against a Haiku round trip, and
 *    quietly making an existing, working feature worse is the one outcome
 *    this rule must not have by default. `preferOnDevice` is that
 *    measurement's opt-in escape hatch: a per-feature switch the *user* sets
 *    (not a default), so making it worse is a choice they made, not one this
 *    file made for them.
 * 3. **A working engine, with no key or the key overridden, means on-device.**
 *    The point of the exercise. Which engine, and so what has to be true for
 *    it to work, is the feature's own — see `OnDeviceEngine`. Only the
 *    language model answers to the Apple Intelligence switch: that setting is
 *    about a model that reasons about your text, and reading a photo you just
 *    took is neither that model nor that concern, so gating Vision on it
 *    would take receipt scanning away from someone who only meant to turn
 *    Apple Intelligence off.
 * 4. **A key means Claude after all, if on-device turned out not to work.**
 *    `preferOnDevice` is a preference, not a demand — it must never be the
 *    reason a working feature goes dark for someone who has a key sitting
 *    right there. This is rule 2 again, reached the second time only when
 *    rule 3 couldn't answer.
 * 5. **Otherwise nothing**, and the caller must not render an entry point.
 */
export function routeForFeature(id: AiFeatureId, input: AiRouteInput): AiRoute {
  if (!input.enabled) return 'unavailable';
  if (input.hasApiKey && !input.preferOnDevice) return 'claude';
  const onDeviceRoute = (() => {
    switch (onDeviceEngineFor(id)) {
      case 'languageModel':
        return input.onDeviceEnabled && input.onDeviceAvailable;
      case 'vision':
        return input.visionAvailable;
      default:
        return false;
    }
  })();
  if (onDeviceRoute) return 'onDevice';
  return input.hasApiKey ? 'claude' : 'unavailable';
}
