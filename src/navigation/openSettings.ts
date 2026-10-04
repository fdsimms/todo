import { navigateToTab } from './navigationRef';
import {
  settingsEntryTarget,
  settingsGroupTarget,
  type SettingsGroupId,
  type SettingsTarget,
} from '../utils/settingsIndex';

type Navigation = { navigate: (name: string, params: object) => void };

/**
 * Opens a Settings group, or the row `entryId` names inside it, wherever that
 * group lives: its page in Settings, or the menu screen it moved to
 * (`SettingsGroup.screen`, which is Automations today).
 *
 * The screen case goes through `navigateToTab` because the caller is usually
 * Settings itself, a pushed card, and a bare navigate to a tab from a card is
 * dropped. `focusStamp` makes a second jump to the same row look different
 * from the first, since a tab screen stays mounted and keeps its last params.
 */
export function openSettingsTarget(navigation: unknown, target: SettingsTarget): void {
  if (target.kind === 'screen') {
    navigateToTab(target.route, { entryId: target.entryId, focusStamp: Date.now() });
    return;
  }
  (navigation as Navigation).navigate('SettingsGroup', { groupId: target.groupId, entryId: target.entryId });
}

export function openSettingsGroup(navigation: unknown, groupId: SettingsGroupId, entryId?: string): void {
  openSettingsTarget(navigation, settingsGroupTarget(groupId, entryId));
}

/**
 * Opens the Settings row with this id, wherever it currently lives.
 *
 * **A hint that names a switch is a dead end until something takes you to
 * it.** Copy like "turn on Log to Health in Settings first" asks the reader to
 * hold a route in their head, leave what they were doing, and find a row by
 * name among a few hundred, so the rows that say it offer this instead.
 *
 * Returns false when no entry has that id, so a caller can leave its button
 * out rather than navigate somewhere arbitrary.
 */
export function navigateToSettingsEntry(navigation: unknown, entryId: string): boolean {
  const target = settingsEntryTarget(entryId);
  if (!target) return false;
  openSettingsTarget(navigation, target);
  return true;
}
