import React from 'react';
import { Animated } from 'react-native';
import { FabMenu, type FabDragHandlers, type FabMenuItem } from './Fab';

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

/** Today's add button: the shared FabMenu, typed to the four ways it adds tasks. */
export function AddTaskFab({ bottom, onSelect, disabled, opacity, drag, dragLabel }: Props) {
  return (
    <FabMenu
      items={ITEMS}
      onSelect={key => onSelect(key as AddTaskType)}
      bottom={bottom}
      disabled={disabled}
      opacity={opacity}
      drag={drag}
      dragLabel={dragLabel}
    />
  );
}
