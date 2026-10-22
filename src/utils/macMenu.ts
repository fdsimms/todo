/**
 * What the menu bar holds, on a Mac or on an iPad that has one (iPadOS 26).
 *
 * The native side (`modules/todo-key-commands`) knows only titles, chords and
 * ids; this decides what the menus say, and `menuCommandTarget` turns an id
 * the native side reports back into something to do. The hook that ties the
 * two together is `useMenuBar`.
 *
 * Four rules shape it:
 *
 * - **Only chords go in a menu, never a plain key.** A menu's key equivalent
 *   can be taken before a text field sees it, so "n" in a menu could eat the
 *   letter someone is typing. The plain-key shortcuts stay on the key sink
 *   (`keyShortcuts.ts`), where a field always wins.
 * - **A chord lives in one place.** A menu item and the key sink both claiming
 *   ⌘N is two handlers for one press, so `sinkShortcuts` takes the menu's
 *   chords off the sink while the menu bar exists.
 * - **Go is the side menu's own list** (`visibleMenuRows`), hubs as submenus,
 *   so a screen switched off in the app is not in the menu bar either.
 * - **Titles are Title Case**, the platform's convention for menus, made from
 *   the same labels the side menu shows rather than written out again.
 */
import { MENU_ROUTES, NAV_EXTRA_DESTINATIONS, menuLabelFor, type NavMenuRow } from './navHubs';
import {
  KEY_SHORTCUTS,
  MENU_SHORTCUTS,
  chordKey,
  shortcutById,
  type KeyModifier,
  type KeyShortcut,
  type ShortcutAction,
} from './keyShortcuts';

/** Which menu an item goes in. `settings` is the app menu's Settings group. */
export type MenuPlacement = 'settings' | 'file' | 'edit' | 'view' | 'go' | 'help';

export interface MenuItemSpec {
  /** Reported back when the item is chosen; see `menuCommandTarget`. */
  id: string;
  title: string;
  menu: MenuPlacement;
  /** A submenu inside `menu` to put it in (a hub, in Go), or '' for none. */
  submenu: string;
  /** The key of its chord, or '' for an item with no shortcut. */
  input: string;
  modifiers: KeyModifier[];
}

export type MenuCommandTarget =
  | { kind: 'shortcut'; shortcut: KeyShortcut }
  | { kind: 'go'; route: string };

// Words a title-cased menu item leaves lower case after the first.
const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

/** "Groceries & meals" → "Groceries & Meals", "Meal plan" → "Meal Plan". */
export function menuTitleCase(label: string): string {
  return label
    .split(' ')
    .map((word, i) => {
      if (word.length === 0) return word;
      if (i > 0 && MINOR_WORDS.has(word.toLowerCase())) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function shortcutItem(id: string, title: string, menu: MenuPlacement): MenuItemSpec {
  const shortcut = shortcutById(id);
  if (!shortcut) throw new Error(`No shortcut ${id}`);
  return { id: `shortcut:${id}`, title, menu, submenu: '', input: shortcut.input, modifiers: [...shortcut.modifiers] };
}

function goItem(route: string, label: string, submenu = ''): MenuItemSpec {
  return { id: `go:${route}`, title: menuTitleCase(label), menu: 'go', submenu, input: '', modifiers: [] };
}

const VIEW_ITEMS: readonly { id: string; title: string; action: ShortcutAction }[] = [
  { id: 'menuViewToday', title: 'Today', action: 'viewToday' },
  { id: 'menuViewLater', title: 'Later', action: 'viewLater' },
  { id: 'menuViewUnscheduled', title: 'Unscheduled', action: 'viewUnscheduled' },
  { id: 'menuViewInbox', title: 'Inbox', action: 'viewInbox' },
];

/**
 * Every item in the menu bar, in menu order. `rows` is the side menu's
 * (`visibleMenuRows`), and `hiddenActions` drops a view the app has switched
 * off (Unscheduled, in simplified mode), the same as the shortcuts list.
 */
export function buildMenuItems(rows: readonly NavMenuRow[], hiddenActions: readonly ShortcutAction[] = []): MenuItemSpec[] {
  const items: MenuItemSpec[] = [
    shortcutItem('menuSettings', 'Settings…', 'settings'),
    shortcutItem('newTaskCommand', 'New Task', 'file'),
    shortcutItem('searchCommand', 'Search…', 'edit'),
  ];
  for (const view of VIEW_ITEMS) {
    if (hiddenActions.includes(view.action)) continue;
    items.push(shortcutItem(view.id, view.title, 'view'));
  }
  for (const row of rows) {
    if (row.kind === 'screen') {
      items.push(goItem(row.destination.route, row.destination.label));
      continue;
    }
    const submenu = menuTitleCase(row.hub.label);
    for (const member of row.hub.members) items.push(goItem(member.route, member.label, submenu));
  }
  items.push(shortcutItem('showShortcuts', 'Keyboard Shortcuts', 'help'));
  return items;
}

/** What a chosen item does, or null for an id this build doesn't know. */
export function menuCommandTarget(id: string): MenuCommandTarget | null {
  if (id.startsWith('shortcut:')) {
    const shortcut = shortcutById(id.slice('shortcut:'.length));
    return shortcut ? { kind: 'shortcut', shortcut } : null;
  }
  if (id.startsWith('go:')) {
    const route = id.slice('go:'.length);
    return route ? { kind: 'go', route } : null;
  }
  return null;
}

/**
 * The key sink's shortcuts with any chord the menu bar already carries taken
 * off, so one press has one handler. Plain keys always stay: no menu item has
 * one (see the header).
 */
export function sinkShortcuts(menuItems: readonly MenuItemSpec[]): KeyShortcut[] {
  const menuChords = new Set(menuItems.filter(i => i.input !== '').map(i => chordKey(i)));
  return KEY_SHORTCUTS.filter(s => !menuChords.has(chordKey(s)));
}

/** Every chord the keyboard answers to with the menu bar up: the sink's and the menu's. */
export function shortcutsWithMenuBar(): KeyShortcut[] {
  return [...KEY_SHORTCUTS, ...MENU_SHORTCUTS];
}

/** What the window's title bar says when no screen has a name of its own. */
export const APP_WINDOW_TITLE = 'dundundun';

/** Below this the side menu, the list and its rows stop fitting, so a Mac window can't be dragged smaller. */
export const MIN_WINDOW_SIZE = { width: 390, height: 560 } as const;

/**
 * The window's title for the screen on show: its name in the side menu, the
 * way a Mac app names the view it is on. A page pushed over a screen (a recipe,
 * a project) and anything else without a menu name falls back to the app's
 * name rather than showing a route name nobody has seen.
 */
export function windowTitleFor(route: string | null | undefined): string {
  if (!route) return APP_WINDOW_TITLE;
  if (route === 'Settings' || route === 'SettingsGroup') return 'Settings';
  if (route === 'Today' || MENU_ROUTES.includes(route) || NAV_EXTRA_DESTINATIONS.some(d => d.route === route)) {
    return menuLabelFor(route);
  }
  return APP_WINDOW_TITLE;
}
