import { navigationRef, navigateToTab, runWhenReady } from './navigationRef';
import { navigateToSettingsEntry } from './openSettings';
import { navMenuOptionsNow } from '../hooks/useNavMenuOptions';
import { menuDestinations } from '../utils/navHubs';
import { resolveScreen } from '../utils/screenLinks';
import { settingsEntryTarget } from '../utils/settingsIndex';

/**
 * Opens the screen a link, a Shortcut or a Home Screen action names
 * (`resolveScreen`). A name that is nothing reachable does nothing: a screen
 * a switch took away isn't reopened from outside the app. False only for an
 * empty name.
 *
 * Resolved when the navigator is ready rather than at call time, since a cold
 * launch delivers the link before the stores have loaded, and the counts that
 * decide a content screen would all read zero.
 */
export function openScreenByName(raw: string): boolean {
  if (!raw.trim()) return false;
  runWhenReady(() => {
    const route = resolveScreen(raw, menuDestinations(navMenuOptionsNow()));
    if (route) navigateToTab(route);
  });
  return true;
}

/** Opens one Settings row by id (`settings?entry=`), false when there is no such row. */
export function openSettingsEntryById(entryId: string): boolean {
  if (!settingsEntryTarget(entryId)) return false;
  runWhenReady(() => { navigateToSettingsEntry(navigationRef, entryId); });
  return true;
}
