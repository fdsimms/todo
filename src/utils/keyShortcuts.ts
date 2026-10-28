/**
 * The hardware-keyboard shortcuts iPhone Mirroring mode turns on, and what each
 * one does. The native side (`modules/todo-key-commands`) knows only keys and
 * ids; `useKeyShortcuts` hands it this list and runs the action an id names.
 *
 * Three rules shape the list:
 *
 * - **A plain key is one a text field would take** (a letter, a digit, "/",
 *   Space, an arrow, Return, Delete). Since iOS 15 a focused field sees a key
 *   before any key command does (Apple: key commands get what "text input or
 *   focus systems don't handle", `wantsPriorityOverSystemBehavior` left false),
 *   so typing "n" into a title types an "n" and never opens quick add, and an
 *   arrow moves the caret rather than the row cursor. That's what makes
 *   single-key shortcuts safe at all. A plain key a field does not take (Tab,
 *   Escape) is used only where firing is right. The keys that act on a row
 *   (`unlessTyping`) are also dropped in JS while any field has focus
 *   (`runShortcut`), so one a particular field happens to ignore can't act on
 *   the list under it either.
 * - **⌘1, ⌘2 and ⌘3 belong to iPhone Mirroring** (Home Screen, App Switcher,
 *   Spotlight) and never reach the app, so nothing here uses them.
 * - **A screen action only runs on a bare screen** (`screenOnly`): "n" with a
 *   sheet open would raise quick add beside it, and two sheets can't be up at
 *   once. Escape and undo work anywhere.
 */

export type KeyModifier = 'command' | 'shift' | 'option' | 'control';

export type ShortcutAction =
  | 'newTask'
  | 'search'
  | 'undo'
  | 'redo'
  | 'closeSheet'
  | 'commit'
  | 'cursorDown'
  | 'cursorUp'
  | 'openCursor'
  | 'completeCursor'
  | 'deleteCursor'
  | 'selectAll'
  | 'viewToday'
  | 'viewLater'
  | 'viewUnscheduled'
  | 'viewInbox'
  | 'showShortcuts'
  | 'openSettings';

export interface KeyShortcut {
  /** Sent to native and back, so it must be unique. */
  id: string;
  action: ShortcutAction;
  /** A character, or one of the native module's key names ("escape"). */
  input: string;
  modifiers: KeyModifier[];
  /** Only while no sheet is open. See the header. */
  screenOnly: boolean;
  /** Dropped while a text field has focus. For the keys that act on a row; see the header. */
  unlessTyping?: boolean;
  /**
   * Stays on for a Mac whose iPhone Mirroring mode is off. Mirroring mode is what
   * turns the plain-key shortcuts on, and turning it off is a way of saying "no
   * single keys", not "no ⌘Z": these are the chords a Mac window is expected to
   * answer to whatever that setting says.
   */
  onMac?: boolean;
}

export const KEY_SHORTCUTS: readonly KeyShortcut[] = [
  { id: 'newTask', action: 'newTask', input: 'n', modifiers: [], screenOnly: true },
  { id: 'newTaskCommand', action: 'newTask', input: 'n', modifiers: ['command'], screenOnly: true },
  { id: 'search', action: 'search', input: '/', modifiers: [], screenOnly: true },
  { id: 'searchCommand', action: 'search', input: 'f', modifiers: ['command'], screenOnly: true },
  { id: 'undo', action: 'undo', input: 'z', modifiers: ['command'], screenOnly: false, onMac: true },
  { id: 'redo', action: 'redo', input: 'z', modifiers: ['command', 'shift'], screenOnly: false, onMac: true },
  { id: 'closeSheet', action: 'closeSheet', input: 'escape', modifiers: [], screenOnly: false, onMac: true },
  // The frontmost form's Save, Done or Add (`registerCommit`): the key a Mac user reaches for to finish one.
  { id: 'commit', action: 'commit', input: 'return', modifiers: ['command'], screenOnly: false, onMac: true },
  // The row cursor (`rowCursor.ts`): move it, then act on the row it is on.
  { id: 'cursorDown', action: 'cursorDown', input: 'down', modifiers: [], screenOnly: true, unlessTyping: true },
  { id: 'cursorUp', action: 'cursorUp', input: 'up', modifiers: [], screenOnly: true, unlessTyping: true },
  { id: 'openCursor', action: 'openCursor', input: 'return', modifiers: [], screenOnly: true, unlessTyping: true },
  { id: 'completeCursor', action: 'completeCursor', input: ' ', modifiers: [], screenOnly: true, unlessTyping: true },
  { id: 'deleteCursor', action: 'deleteCursor', input: 'delete', modifiers: [], screenOnly: true, unlessTyping: true },
  { id: 'deleteCursorCommand', action: 'deleteCursor', input: 'delete', modifiers: ['command'], screenOnly: true, unlessTyping: true },
  { id: 'selectAll', action: 'selectAll', input: 'a', modifiers: ['command'], screenOnly: true, unlessTyping: true },
  { id: 'viewToday', action: 'viewToday', input: '1', modifiers: [], screenOnly: true },
  { id: 'viewLater', action: 'viewLater', input: '2', modifiers: [], screenOnly: true },
  { id: 'viewUnscheduled', action: 'viewUnscheduled', input: '3', modifiers: [], screenOnly: true },
  { id: 'viewInbox', action: 'viewInbox', input: '4', modifiers: [], screenOnly: true },
  { id: 'showShortcuts', action: 'showShortcuts', input: '/', modifiers: ['command'], screenOnly: false, onMac: true },
];

/**
 * Chords that exist only as menu bar items (`macMenu.ts`), on a Mac or an iPad
 * with a menu bar, and are never handed to the key sink. ⌘1 to ⌘3 belong to
 * iPhone Mirroring on a phone (see the header), and a phone builds no menu
 * bar, so these can't reach one.
 */
export const MENU_SHORTCUTS: readonly KeyShortcut[] = [
  { id: 'menuSettings', action: 'openSettings', input: ',', modifiers: ['command'], screenOnly: true },
  { id: 'menuViewToday', action: 'viewToday', input: '1', modifiers: ['command'], screenOnly: true },
  { id: 'menuViewLater', action: 'viewLater', input: '2', modifiers: ['command'], screenOnly: true },
  { id: 'menuViewUnscheduled', action: 'viewUnscheduled', input: '3', modifiers: ['command'], screenOnly: true },
  { id: 'menuViewInbox', action: 'viewInbox', input: '4', modifiers: ['command'], screenOnly: true },
];

/** The shortcut an id names, menu-only ones included, or null for one this build doesn't know. */
export function shortcutById(id: string): KeyShortcut | null {
  return KEY_SHORTCUTS.find(s => s.id === id) ?? MENU_SHORTCUTS.find(s => s.id === id) ?? null;
}

/** A chord as one comparable string: the modifiers in a fixed order, then the key. */
export function chordKey(shortcut: Pick<KeyShortcut, 'input' | 'modifiers'>): string {
  return `${MODIFIER_ORDER.filter(m => shortcut.modifiers.includes(m)).join('+')}|${shortcut.input}`;
}

const MODIFIER_GLYPHS: Record<KeyModifier, string> = {
  control: '⌃',
  option: '⌥',
  shift: '⇧',
  command: '⌘',
};
// Apple's own order for a chord: ⌃⌥⇧⌘.
const MODIFIER_ORDER: KeyModifier[] = ['control', 'option', 'shift', 'command'];

// Keys with no character of their own, and the one that is only a space, as they are written.
const KEY_NAMES: Record<string, string> = {
  escape: 'Esc',
  up: '↑',
  down: '↓',
  return: '↩',
  delete: '⌫',
  ' ': 'Space',
};

/** How a shortcut is written down: "⇧⌘Z", "Esc", "N", "↓". */
export function shortcutKeys(shortcut: KeyShortcut): string {
  const mods = MODIFIER_ORDER.filter(m => shortcut.modifiers.includes(m)).map(m => MODIFIER_GLYPHS[m]).join('');
  const key = KEY_NAMES[shortcut.input] ?? shortcut.input.toUpperCase();
  return mods + key;
}

const ACTION_LABELS: Record<ShortcutAction, string> = {
  newTask: 'New task',
  search: 'Search',
  undo: 'Undo',
  redo: 'Redo',
  closeSheet: 'Close the sheet, or step back out',
  commit: 'Save, Done or Add',
  cursorDown: 'Next task',
  cursorUp: 'Previous task',
  openCursor: 'Open the task',
  completeCursor: 'Complete the task',
  deleteCursor: 'Delete the task',
  selectAll: 'Select all tasks',
  viewToday: 'Today',
  viewLater: 'Later',
  viewUnscheduled: 'Unscheduled',
  viewInbox: 'Inbox',
  showShortcuts: 'Show this list',
  openSettings: 'Settings',
};

/**
 * One line per action, its keys joined with "or", in table order. The text of
 * the shortcuts alert; `hiddenActions` drops the ones the app has switched off
 * (Unscheduled, in simplified mode). With a menu bar, `shortcuts` adds the
 * menu-only chords (`MENU_SHORTCUTS`), so the list says what the keyboard can
 * actually do there.
 */
export function describeShortcuts(
  hiddenActions: readonly ShortcutAction[] = [],
  shortcuts: readonly KeyShortcut[] = KEY_SHORTCUTS,
): string {
  const lines: string[] = [];
  const seen = new Set<ShortcutAction>();
  for (const shortcut of shortcuts) {
    if (seen.has(shortcut.action) || hiddenActions.includes(shortcut.action)) continue;
    seen.add(shortcut.action);
    const keys = shortcuts.filter(s => s.action === shortcut.action).map(shortcutKeys).join(' or ');
    lines.push(`${keys}: ${ACTION_LABELS[shortcut.action]}`);
  }
  return lines.join('\n');
}
