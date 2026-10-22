import { useEffect, useMemo } from 'react';
import { addMenuCommandListener, isMenuBarAvailable, setMenuItems } from 'todo-key-commands';
import { useSettingsStore } from '../store/useSettingsStore';
import { isAppLocked } from '../store/useAppLockStore';
import { useNavMenuOptions } from './useNavMenuOptions';
import { hiddenActions, runShortcut } from './useKeyShortcuts';
import { buildMenuItems, menuCommandTarget } from '../utils/macMenu';
import { visibleMenuRows } from '../utils/navHubs';
import { anySheetOpen } from '../utils/sheetModal';
import { navigateToTab } from '../navigation/navigationRef';

// Asked once: whether the menu bar was set up at launch can't change while the
// app runs.
const menuBarAvailable = isMenuBarAvailable();

function runMenuCommand(id: string): void {
  const target = menuCommandTarget(id);
  if (!target) return;
  if (target.kind === 'shortcut') {
    runShortcut(target.shortcut);
    return;
  }
  // A screen from Go, held to the rule a screen shortcut follows: never under
  // the lock screen, and never under an open sheet, which would leave the
  // sheet up over a screen it doesn't belong to.
  if (isAppLocked() || anySheetOpen()) return;
  navigateToTab(target.route);
}

/**
 * The menu bar on a Mac or an iPad (`macMenu.ts` says what it holds). App-level
 * for the reason `useKeyShortcuts` is: a frozen tab runs no effects. Unlike the
 * shortcuts it doesn't wait for iPhone Mirroring mode, since a menu bar is how
 * a Mac app is used at all.
 */
export function useMenuBar(): void {
  const menuOptions = useNavMenuOptions();
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const items = useMemo(
    () => (menuBarAvailable ? buildMenuItems(visibleMenuRows(menuOptions), hiddenActions()) : []),
    // simpleMode is what hiddenActions reads.
    [menuOptions, simpleMode],
  );

  useEffect(() => {
    if (!menuBarAvailable) return;
    setMenuItems(items);
  }, [items]);

  useEffect(() => {
    if (!menuBarAvailable) return;
    return addMenuCommandListener(runMenuCommand);
  }, []);
}
