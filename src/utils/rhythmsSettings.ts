import { useSettingsStore } from '../store/useSettingsStore';
import type { RhythmOptions } from './rhythms';

/**
 * Supplies rhythms.ts with the user's segment boundaries and day reset.
 *
 * Same split dateUtils has with clockTime: the module doing the work stays
 * free of the store so it can be tested in the `node` environment, and this
 * one-liner is what the screens actually import. Kept in its own file rather
 * than exported from rhythms.ts so that importing the pure module can never
 * drag the store in behind it.
 */
export function rhythmOptionsFromSettings(extra: RhythmOptions = {}): RhythmOptions {
  const { morningStart, afternoonStart, eveningStart, nightStart, dayResetTime } =
    useSettingsStore.getState();
  return {
    boundaries: { morningStart, afternoonStart, eveningStart, nightStart },
    dayResetTime,
    ...extra,
  };
}
