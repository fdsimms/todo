import React, { useMemo } from 'react';
import { Animated } from 'react-native';
import { FabMenu, type FabDragHandlers, type FabMenuItem } from './Fab';
import { addMenuItemShown } from '../utils/simpleMode';
import { useSettingsStore } from '../store/useSettingsStore';

export type AddTaskType = 'chain' | 'stack' | 'template' | 'task';

// Bottom-up, so plain "Task" — far and away the most common — lands closest
// to the button. There's deliberately no "Recurring" entry: it created a plain
// task with one picker pre-opened, which the Repeat row in quick add already
// does in the same number of taps.
const ITEMS: FabMenuItem[] = [
  { key: 'chain', label: 'Chain', icon: 'git-commit' },
  { key: 'stack', label: 'Stack', icon: 'layers' },
  { key: 'template', label: 'Template', icon: 'copy' },
  { key: 'task', label: 'Task', icon: 'checkbox' },
];

interface Props {
  /** Distance from the bottom of the screen — matches the resting FAB's position. */
  bottom: number;
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
export function AddTaskFab({ bottom, onSelect, disabled, opacity, drag, dragLabel }: Props) {
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const items = useMemo(
    () => ITEMS.filter(item => addMenuItemShown(item.key, simpleMode)),
    [simpleMode],
  );

  return (
    <FabMenu
      items={items}
      onSelect={key => onSelect(key as AddTaskType)}
      accessibilityLabel="Add task"
      bottom={bottom}
      disabled={disabled}
      opacity={opacity}
      drag={drag}
      dragLabel={dragLabel}
    />
  );
}
