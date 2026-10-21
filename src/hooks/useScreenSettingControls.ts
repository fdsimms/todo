import { useMemo } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { setGeneratorEnabled } from '../store/generatorSwitch';
import type { SettingsEntry } from '../utils/settingsIndex';
import { aiFeatureOf, generatorKindOf, screenSettingRead } from '../utils/screenSettingControls';

export type ScreenSettingControl =
  | { kind: 'toggle'; on: boolean; set: (on: boolean) => void }
  | { kind: 'value'; text: string };

/**
 * The write behind one of `screenSettingRead`'s switches: the same setter its
 * Settings row calls, and nothing more, since the reader only offers a switch
 * where the row does nothing more.
 */
function screenSettingWrite(id: string, on: boolean): void {
  const s = useSettingsStore.getState();
  const kind = generatorKindOf(id);
  if (kind) { setGeneratorEnabled(kind, on); return; }
  const feature = aiFeatureOf(id, s);
  if (feature) { s.setAiFeatureConfig(feature, { enabled: on }); return; }
  switch (id) {
    case 'mealsOnToday': s.setMealsOnToday(on ? 'inline' : 'off'); return;
    case 'mealLogPrompt': s.setMealLogPrompt(on); return;
    case 'tripLiveActivity': s.setTripLiveActivity(on); return;
    case 'autoCompleteProjects': s.setAutoCompleteProjectsOnDone(on); return;
    case 'postponeCheck': s.setPostponeCheckEnabled(on); return;
    case 'tipsEnabled': s.setTipsEnabled(on); return;
    case 'hideCategories': s.setHideCategories(on); return;
    case 'backgroundRefreshEnabled': s.setBackgroundRefreshEnabled(on); return;
  }
}

/** Each gear row's switch or value, by entry id, kept current while the sheet is open. */
export function useScreenSettingControls(
  entries: readonly SettingsEntry[],
  visible: boolean,
): Record<string, ScreenSettingControl> {
  // The whole store, since a row can read any of a dozen fields, but only
  // while the sheet is up: it stays mounted on every screen with a gear, and
  // a closed one re-rendering on each settings write is work for nothing.
  const settings = useSettingsStore(s => (visible ? s : null));
  return useMemo(() => {
    const out: Record<string, ScreenSettingControl> = {};
    if (!settings) return out;
    for (const entry of entries) {
      const read = screenSettingRead(entry.id, settings);
      if (!read) continue;
      out[entry.id] = read.kind === 'toggle'
        ? { kind: 'toggle', on: read.on, set: on => screenSettingWrite(entry.id, on) }
        : read;
    }
    return out;
  }, [entries, settings]);
}
