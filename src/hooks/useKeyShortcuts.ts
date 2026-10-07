import { useEffect } from 'react';
import { Alert } from 'react-native';
import { addKeyCommandListener, setKeyCommands } from 'todo-key-commands';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { usePersonStore } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { isAppLocked } from '../store/useAppLockStore';
import { KEY_SHORTCUTS, describeShortcuts, shortcutById, type ShortcutAction } from '../utils/keyShortcuts';
import { latestRedoHistory, latestUndoHistory } from '../utils/undoHistory';
import { anySheetOpen, closeTopmostSheet } from '../utils/sheetModal';
import { featureHidden } from '../utils/simpleMode';
import {
  openQuickAddFromKeyboard,
  openQuickSearchFromKeyboard,
  showTodayViewModeFromKeyboard,
} from '../navigation/navigationRef';

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

function hiddenActions(): ShortcutAction[] {
  return featureHidden('unscheduledLens', useSettingsStore.getState().simpleMode) ? ['viewUnscheduled'] : [];
}

function runShortcut(id: string): void {
  const shortcut = shortcutById(id);
  if (!shortcut) return;
  // The lock screen is up: nothing behind it may be driven, the same rule
  // shake-to-undo follows.
  if (isAppLocked()) return;
  if (shortcut.screenOnly && anySheetOpen()) return;

  switch (shortcut.action) {
    case 'newTask': openQuickAddFromKeyboard(); return;
    case 'search': openQuickSearchFromKeyboard(); return;
    // No confirm and no freshness window, unlike the shake: a key press can't
    // happen by accident the way a jolt can, and the UndoBar names what was
    // undone with a Redo beside it.
    case 'undo': latestUndoHistory(undoHistories())?.undoLastAction(); return;
    case 'redo': latestRedoHistory(undoHistories())?.redoLastUndone(); return;
    case 'closeSheet': closeTopmostSheet(); return;
    case 'viewToday': showTodayViewModeFromKeyboard('today'); return;
    case 'viewLater': showTodayViewModeFromKeyboard('later'); return;
    case 'viewUnscheduled': showTodayViewModeFromKeyboard('unscheduled'); return;
    case 'viewInbox': showTodayViewModeFromKeyboard('inbox'); return;
    case 'showShortcuts': Alert.alert('Keyboard shortcuts', describeShortcuts(hiddenActions())); return;
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
    if (!mirroringMode) return;
    setKeyCommands(KEY_SHORTCUTS.map(({ id, input, modifiers }) => ({ id, input, modifiers })));
    const unsubscribe = addKeyCommandListener(runShortcut);
    return () => {
      unsubscribe();
      setKeyCommands([]);
    };
  }, [mirroringMode]);
}
