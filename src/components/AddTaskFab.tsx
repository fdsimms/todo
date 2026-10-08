import React, { useMemo } from 'react';
import { Animated } from 'react-native';
import { FabMenu, type FabDragHandlers, type FabMenuItem } from './Fab';
import { addMenuItemShown } from '../utils/simpleMode';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from '../utils/demoState';

export type AddTaskType = 'stack' | 'template' | 'import' | 'event' | 'task';

// Bottom-up, so plain "Task" — far and away the most common — lands closest
// to the button. There's deliberately no "Recurring" entry: it created a plain
// task with one picker pre-opened, which the Repeat row in quick add already
// does in the same number of taps. A chain is reachable from the full editor's
// own kind picker instead of a FAB entry of its own.
//
// "Event" is the one entry that adds no task: a one-line event
// (`QuickEventSheet`) saved straight into the calendar. It sits beside Task because a plan for
// today is a Today thing whichever list it ends up in.
const ITEMS: FabMenuItem[] = [
  { key: 'stack', label: 'Stack', icon: 'layers' },
  { key: 'template', label: 'Template', icon: 'copy' },
  { key: 'import', label: 'Import event', icon: 'scan-outline' },
  { key: 'event', label: 'Event', icon: 'calendar-outline' },
  { key: 'task', label: 'Task', icon: 'checkbox' },
];

interface Props {
  onSelect: (type: AddTaskType) => void;
  disabled?: boolean;
  /** Fades the resting FAB (e.g. while a task is spotlighted). Ignored while the menu is open. */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
  /** Lets the button be dragged into the list to place a task. Omit for tap-only. */
  drag?: FabDragHandlers;
  /** Names the drop target beside the button while dragging. */
  dragLabel?: string | null;
}

/**
 * Today's add button: the shared FabMenu, typed to the four ways it adds tasks.
 *
 * Three of those four are capabilities simplified mode takes away, so what's
 * left there is Task alone — and `FabMenu` performs a lone item on the tap
 * rather than opening a menu to offer it, which is how the button becomes a
 * plain "open quick add" in that mode. Read from the store here rather than
 * taken as a prop, the same way the button reads which corner it sits in.
 */
export function AddTaskFab({ onSelect, disabled, opacity, drag, dragLabel }: Props) {
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const items = useMemo(
    // Event is also dropped in a demo, where it would write to the real calendar.
    () => ITEMS.filter(item =>
      addMenuItemShown(item.key, simpleMode)
      && !(item.key === 'event' && isDemoModeActive())),
    [simpleMode],
  );

  return (
    <FabMenu
      items={items}
      onSelect={key => onSelect(key as AddTaskType)}
      accessibilityLabel="Add task"
      disabled={disabled}
      opacity={opacity}
      drag={drag}
      dragLabel={dragLabel}
    />
  );
}
