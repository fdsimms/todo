import { visibleSettingsEntries, type SettingsEntry } from './settingsIndex';
import { GENERATED_KIND_LIST, generatorSwitchedOn, type GeneratedEnabledFlags } from './generatedTasks';

/**
 * Which Settings rows are on the page right now, for anything that searches
 * them: the Settings screen's own field, and the app-wide search.
 *
 * The index (`settingsIndex.ts`) is pure data, so it can't read the store to
 * know which parent toggles are on; this takes the store's values as plain
 * arguments and answers. It used to live inside SettingsScreen, which was fine
 * while that was the only search over settings. A second copy for the app-wide
 * search would drift from the first, and the drift is exactly a search result
 * that opens a row that isn't rendered.
 */

/** The settings values a row's visibility depends on. The settings store satisfies it. */
export type SettingsGateState = GeneratedEnabledFlags & {
  kitchenEnabled: boolean;
  simpleMode: boolean;
  postponeCheckEnabled: boolean;
  focusLongRestEvery: number | null;
  focusShieldEnabled: boolean;
  penaltyShieldEnabled: boolean;
  gateShieldEnabled: boolean;
  vacationMode: boolean;
  dailyAgendaEnabled: boolean;
  quietHoursStart: string | null;
  appLockEnabled: boolean;
  productLookupEnabled: boolean;
  cookRecapEnabled: boolean;
  mealLogPrompt: boolean;
  onDeviceAiEnabled: boolean;
  remindersImportEnabled: boolean;
  travelEstimates: boolean;
  transitAlerts: boolean;
};

/** The sync store's values "Sync now" depends on. The sync store satisfies it. */
export interface SyncGateState {
  supported: boolean;
  enabled: boolean;
  serverUrl: string;
  hasServerToken: boolean;
}

/** The gating rows currently switched on — see `SettingsEntry.requires`. */
export function activeSettingsEntryIds(settings: SettingsGateState, sync: SyncGateState): Set<string> {
  const on = new Set<string>();
  if (settings.postponeCheckEnabled) on.add('postponeCheck');
  if (settings.focusLongRestEvery !== null) on.add('focusLongRestEvery');
  if (settings.focusShieldEnabled) on.add('focusShield');
  if (settings.penaltyShieldEnabled) on.add('penaltyShield');
  if (settings.gateShieldEnabled) on.add('gateShield');
  if (settings.vacationMode) on.add('vacationMode');
  if (settings.dailyAgendaEnabled) on.add('dailyAgenda');
  // Both null is how quiet hours are off; the screen's own toggle is derived
  // from exactly this.
  if (settings.quietHoursStart !== null) on.add('quietHours');
  if (settings.appLockEnabled) on.add('appLock');
  if (settings.productLookupEnabled) on.add('productLookupEnabled');
  if (settings.cookRecapEnabled) on.add('cookRecapEnabled');
  if (settings.mealLogPrompt) on.add('mealLogPrompt');
  if (settings.onDeviceAiEnabled) on.add('onDeviceAiEnabled');
  if (settings.healthReadEnabled) on.add('healthRead');
  if (settings.healthWriteEnabled) on.add('healthWrite');
  if (settings.calendarReadEnabled) on.add('calendarRead');
  if (settings.remindersImportEnabled) on.add('remindersImport');
  // The two ways to sync, which is what "Sync now" renders behind: iCloud
  // switched on, or a server with both a URL and a token.
  if (sync.supported && sync.enabled) on.add('syncEnabled');
  if (sync.serverUrl && sync.hasServerToken) on.add('syncServerToken');
  // Through the same rule the rows themselves use, so a generator whose read
  // is switched off takes its "File them under" row out of search too.
  for (const spec of GENERATED_KIND_LIST) {
    if (generatorSwitchedOn(spec.kind, settings)) on.add(`gen:${spec.kind}`);
  }
  // Nested a level further, inside the leave-by generator's own options, so
  // they need it on as well as their own switch.
  if (on.has('gen:travel') && settings.travelEstimates) on.add('travelEstimates');
  if (on.has('gen:travel') && settings.transitAlerts) on.add('transitAlerts');
  return on;
}

/**
 * Every Settings row a search may return: the kitchen rows leave with the
 * area, the simplified-mode ones with theirs, the iOS-only rows with the
 * platform, and a row nested under a switched-off toggle with that toggle.
 */
export function searchableSettingsEntries(
  platformOS: string,
  settings: SettingsGateState,
  sync: SyncGateState,
): SettingsEntry[] {
  return visibleSettingsEntries(
    platformOS, settings.kitchenEnabled, settings.simpleMode, activeSettingsEntryIds(settings, sync));
}
