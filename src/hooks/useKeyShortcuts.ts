import { useEffect } from 'react';
import { Alert, TextInput } from 'react-native';
import { addKeyCommandListener, isMenuBarAvailable, setKeyCommands } from 'todo-key-commands';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { usePersonStore } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { isAppLocked } from '../store/useAppLockStore';
import { KEY_SHORTCUTS, describeShortcuts, shortcutById, type KeyShortcut, type ShortcutAction } from '../utils/keyShortcuts';
import { buildMenuItems, shortcutsWithMenuBar, sinkShortcuts } from '../utils/macMenu';
import { latestRedoHistory, latestUndoHistory } from '../utils/undoHistory';
import { anySheetOpen } from '../utils/sheetModal';
import { runCommit, runEscape, runScreenKey, type ScreenKey } from '../utils/keyActions';
import { runningOnMac } from '../utils/runningOnMac';
import { haptics } from '../utils/haptics';
import { featureHidden } from '../utils/simpleMode';
import {
  openQuickAddFromKeyboard,
  openQuickSearchFromKeyboard,
  openSettingsFromKeyboard,
  showTodayViewModeFromKeyboard,
} from '../navigation/navigationRef';
import { animateLayout } from '../utils/layoutAnimation';

/** The same seven histories `useShakeToUndo` and the UndoBar choose between. */
function undoHistories() {
  return [
    useTaskStore.getState(),
    useGroceryStore.getState(),
    useMealPlanStore.getState(),
    useLeftoverStore.getState(),
    usePersonStore.getState(),
    usePersonGroupStore.getState(),
    useFoodLogStore.getState(),
  ];
}

export function hiddenActions(): ShortcutAction[] {
  return featureHidden('unscheduledLens', useSettingsStore.getState().simpleMode) ? ['viewUnscheduled'] : [];
}

/** Whether a text field has focus, so a key that acts on a row should leave the field to it. */
function isTyping(): boolean {
  try {
    return TextInput.State.currentlyFocusedInput() != null;
  } catch {
    // Nothing is focused, or the view that was has gone: not typing.
    return false;
  }
}

function runShortcutId(id: string): void {
  const shortcut = shortcutById(id);
  if (shortcut) runShortcut(shortcut);
}

/** Does what a shortcut means, from a key press or the menu bar alike. */
export function runShortcut(shortcut: KeyShortcut): void {
  // The lock screen is up: nothing behind it may be driven, the same rule
  // shake-to-undo follows.
  if (isAppLocked()) return;
  if (shortcut.screenOnly && anySheetOpen()) return;
  if (shortcut.unlessTyping && isTyping()) return;

  switch (shortcut.action) {
    case 'newTask': openQuickAddFromKeyboard(); return;
    case 'search': openQuickSearchFromKeyboard(); return;
    // No confirm and no freshness window, unlike the shake: a key press can't
    // happen by accident the way a jolt can, and the UndoBar names what was
    // undone with a Redo beside it.
    // Animated like the shake and the bar, so a restored row opens back up.
    case 'undo': animateLayout(); latestUndoHistory(undoHistories())?.undoLastAction(); return;
    case 'redo': animateLayout(); latestRedoHistory(undoHistories())?.redoLastUndone(); return;
    // The sheet on top, or when there is none, whatever the screen is holding open.
    case 'closeSheet': runEscape(); return;
    // The frontmost form's confirm action; a disabled one answers as its button does.
    case 'commit': if (runCommit() === 'refused') haptics.error(); return;
    case 'cursorDown':
    case 'cursorUp':
    case 'openCursor':
    case 'completeCursor':
    case 'deleteCursor':
    case 'selectAll':
      runScreenKey(shortcut.action as ScreenKey);
      return;
    case 'viewToday': showTodayViewModeFromKeyboard('today'); return;
    case 'viewLater': showTodayViewModeFromKeyboard('later'); return;
    case 'viewUnscheduled': showTodayViewModeFromKeyboard('unscheduled'); return;
    case 'viewInbox': showTodayViewModeFromKeyboard('inbox'); return;
    case 'openSettings': openSettingsFromKeyboard(); return;
    case 'showShortcuts': {
      // With a menu bar the menu's own chords (⌘, and ⌘1 to ⌘4) work too.
      const listed = isMenuBarAvailable() ? shortcutsWithMenuBar() : KEY_SHORTCUTS;
      Alert.alert('Keyboard shortcuts', describeShortcuts(hiddenActions(), listed));
      return;
    }
  }
}

/**
 * Hardware-keyboard shortcuts, on while iPhone Mirroring mode is
 * (`mirroringMode`). App-level rather than in a screen, because a frozen tab
 * runs no effects (see `freezeWhenBlurred`) and a shortcut has to work from
 * any of them. The list and what each one means are in `keyShortcuts.ts`;
 * the native side only reports which one was pressed.
 */
export function useKeyShortcuts(): void {
  const mirroringMode = useSettingsStore(s => s.mirroringMode);

  useEffect(() => {
    // Mirroring mode turns the whole list on. A Mac with it off keeps the chords a
    // Mac window answers to whatever it says (⌘Z, Escape, ⌘Return), since turning it
    // off is how someone says no to the single keys, not to undo.
    const wanted = mirroringMode ? KEY_SHORTCUTS : runningOnMac() ? KEY_SHORTCUTS.filter(s => s.onMac) : [];
    if (wanted.length === 0) return;
    // With a menu bar, its items carry their own chords (⌘N, ⌘F, ⌘/), and a
    // chord with two handlers is one press run twice, so the sink leaves them
    // to the menu. The chords are fixed, so the list is too.
    const shortcuts = isMenuBarAvailable() ? sinkShortcuts(buildMenuItems([]), wanted) : wanted;
    setKeyCommands(shortcuts.map(({ id, input, modifiers }) => ({ id, input, modifiers })));
    const unsubscribe = addKeyCommandListener(runShortcutId);
    return () => {
      unsubscribe();
      setKeyCommands([]);
    };
  }, [mirroringMode]);
}
