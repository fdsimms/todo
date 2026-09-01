import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { onDeviceAvailability, type OnDeviceAvailability } from '../services/onDeviceModel';
import { routeForFeature, type AiRoute } from '../utils/aiRouting';
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
  const [state, setState] = useState<OnDeviceAvailability>(() => onDeviceAvailability());

  const refresh = useCallback(() => setState(onDeviceAvailability()), []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return state;
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
  });
}
