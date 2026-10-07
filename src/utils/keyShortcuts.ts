/**
 * The hardware-keyboard shortcuts iPhone Mirroring mode turns on, and what each
 * one does. The native side (`modules/todo-key-commands`) knows only keys and
 * ids; `useKeyShortcuts` hands it this list and runs the action an id names.
 *
 * Three rules shape the list:
 *
 * - **A plain key is one a text field would take** (a letter, a digit, "/").
 *   Since iOS 15 a focused field sees a key before any key command does, so
 *   typing "n" into a title types an "n" and never opens quick add. That's
 *   what makes single-key shortcuts safe at all; a plain key a field *doesn't*
 *   use (an arrow, Return) would fire while typing, so none is used plain.
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
  | 'viewToday'
  | 'viewLater'
  | 'viewUnscheduled'
  | 'viewInbox'
  | 'showShortcuts';

export interface KeyShortcut {
  /** Sent to native and back, so it must be unique. */
  id: string;
  action: ShortcutAction;
  /** A character, or one of the native module's key names ("escape"). */
  input: string;
  modifiers: KeyModifier[];
  /** Only while no sheet is open. See the header. */
  screenOnly: boolean;
}

export const KEY_SHORTCUTS: readonly KeyShortcut[] = [
  { id: 'newTask', action: 'newTask', input: 'n', modifiers: [], screenOnly: true },
  { id: 'newTaskCommand', action: 'newTask', input: 'n', modifiers: ['command'], screenOnly: true },
  { id: 'search', action: 'search', input: '/', modifiers: [], screenOnly: true },
  { id: 'searchCommand', action: 'search', input: 'f', modifiers: ['command'], screenOnly: true },
  { id: 'undo', action: 'undo', input: 'z', modifiers: ['command'], screenOnly: false },
  { id: 'redo', action: 'redo', input: 'z', modifiers: ['command', 'shift'], screenOnly: false },
  { id: 'closeSheet', action: 'closeSheet', input: 'escape', modifiers: [], screenOnly: false },
  { id: 'viewToday', action: 'viewToday', input: '1', modifiers: [], screenOnly: true },
  { id: 'viewLater', action: 'viewLater', input: '2', modifiers: [], screenOnly: true },
  { id: 'viewUnscheduled', action: 'viewUnscheduled', input: '3', modifiers: [], screenOnly: true },
  { id: 'viewInbox', action: 'viewInbox', input: '4', modifiers: [], screenOnly: true },
  { id: 'showShortcuts', action: 'showShortcuts', input: '/', modifiers: ['command'], screenOnly: false },
];

/** The shortcut an id names, or null for one this build doesn't know. */
export function shortcutById(id: string): KeyShortcut | null {
  return KEY_SHORTCUTS.find(s => s.id === id) ?? null;
}

const MODIFIER_GLYPHS: Record<KeyModifier, string> = {
  control: '⌃',
  option: '⌥',
  shift: '⇧',
  command: '⌘',
};
// Apple's own order for a chord: ⌃⌥⇧⌘.
const MODIFIER_ORDER: KeyModifier[] = ['control', 'option', 'shift', 'command'];

/** How a shortcut is written down: "⇧⌘Z", "Esc", "N". */
export function shortcutKeys(shortcut: KeyShortcut): string {
  const mods = MODIFIER_ORDER.filter(m => shortcut.modifiers.includes(m)).map(m => MODIFIER_GLYPHS[m]).join('');
  const key = shortcut.input === 'escape' ? 'Esc' : shortcut.input.toUpperCase();
  return mods + key;
}

const ACTION_LABELS: Record<ShortcutAction, string> = {
  newTask: 'New task',
  search: 'Search',
  undo: 'Undo',
  redo: 'Redo',
  closeSheet: 'Close the sheet on top',
  viewToday: 'Today',
  viewLater: 'Later',
  viewUnscheduled: 'Unscheduled',
  viewInbox: 'Inbox',
  showShortcuts: 'Show this list',
};

/**
 * One line per action, its keys joined with "or", in table order. The text of
 * the shortcuts alert; `hiddenActions` drops the ones the app has switched off
 * (Unscheduled, in simplified mode).
 */
export function describeShortcuts(hiddenActions: readonly ShortcutAction[] = []): string {
  const lines: string[] = [];
  const seen = new Set<ShortcutAction>();
  for (const shortcut of KEY_SHORTCUTS) {
    if (seen.has(shortcut.action) || hiddenActions.includes(shortcut.action)) continue;
    seen.add(shortcut.action);
    const keys = KEY_SHORTCUTS.filter(s => s.action === shortcut.action).map(shortcutKeys).join(' or ');
    lines.push(`${keys}: ${ACTION_LABELS[shortcut.action]}`);
  }
  return lines.join('\n');
}
