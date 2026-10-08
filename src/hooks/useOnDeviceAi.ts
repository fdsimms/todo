import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { onDeviceAvailability, type OnDeviceAvailability } from '../services/onDeviceModel';
import { routeForFeature, type AiRoute } from '../utils/aiRouting';
import { canReadTextOnDevice } from '../utils/receiptOcr';
import type { AiFeatureId } from '../utils/aiFeatures';

/**
 * What the device says about the on-device model, re-read when the app comes
 * back to the foreground.
 *
 * The foreground re-read is the whole reason this is a hook rather than the
 * module-scope constant `RemindMePicker` uses for `isAlarmKitAvailable`. Two of
 * the three unavailable reasons are temporary and one of them is acted on by
 * leaving the app: `notEnabled` is fixed in the Settings app, which is exactly
 * where the copy sends someone, and `notReady` finishes on its own while the
 * app sits in the background. Read once at launch, both would be stuck until
 * the next cold start. AlarmKit had no equivalent — its availability is an OS
 * version, which doesn't change while the app is open.
 */
export function useOnDeviceAvailability(): OnDeviceAvailability {
  return useSyncExternalStore(subscribeAvailability, readAvailability);
}

/**
 * One answer shared by every caller, rather than one per hook.
 *
 * Each instance used to ask the device on mount and keep its own listener, and
 * a screen holds several (Groceries, with its sheets, about six), so every
 * return to that tab, which re-runs the tab's effects, made that many native
 * calls for one answer. Now a mount asks only once the shared answer is a few
 * seconds old, which still catches a model that finished downloading while the
 * app was open, and one listener re-reads it on every return to the foreground.
 */
const AVAILABILITY_FRESH_MS = 5_000;
let availability: { state: OnDeviceAvailability; readAt: number } | null = null;
const availabilityListeners = new Set<() => void>();
let foregroundSub: { remove: () => void } | null = null;

function readAvailability(): OnDeviceAvailability {
  if (!availability) availability = { state: onDeviceAvailability(), readAt: Date.now() };
  return availability.state;
}

function refreshAvailability() {
  const state = onDeviceAvailability();
  const changed = availability?.state !== state;
  availability = { state, readAt: Date.now() };
  if (changed) availabilityListeners.forEach(fn => fn());
}

function subscribeAvailability(onChange: () => void): () => void {
  availabilityListeners.add(onChange);
  if (!foregroundSub) {
    foregroundSub = AppState.addEventListener('change', s => {
      if (s === 'active') refreshAvailability();
    });
  }
  if (!availability || Date.now() - availability.readAt > AVAILABILITY_FRESH_MS) refreshAvailability();
  return () => {
    availabilityListeners.delete(onChange);
    if (availabilityListeners.size === 0) {
      foregroundSub?.remove();
      foregroundSub = null;
    }
  };
}

/**
 * Which engine would answer this feature right now, for a screen deciding
 * whether to render an entry point at all.
 *
 * Reads the same `routeForFeature` the service does, so a button can't exist
 * for a call that would refuse — the pairing that keeps "opens a sheet that can
 * only apologise" from coming back.
 */
export function useAiRoute(id: AiFeatureId): AiRoute {
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const aiFeatureConfig = useSettingsStore(s => s.aiFeatureConfig);
  const onDeviceAiEnabled = useSettingsStore(s => s.onDeviceAiEnabled);
  const availability = useOnDeviceAvailability();

  return routeForFeature(id, {
    enabled: aiFeatureConfig[id].enabled,
    hasApiKey: !!anthropicApiKey,
    onDeviceEnabled: onDeviceAiEnabled,
    onDeviceAvailable: availability === 'available',
    // Not part of the state above because it cannot change while the app is
    // running — see the note on `canReadTextOnDevice`.
    visionAvailable: canReadTextOnDevice(),
    preferOnDevice: aiFeatureConfig[id].preferOnDevice,
  });
}
