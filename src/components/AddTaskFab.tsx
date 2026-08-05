import React from 'react';
import { Animated } from 'react-native';
import { FabMenu, type FabMenuItem } from './Fab';

export type AddTaskType = 'chain' | 'stack' | 'recurring' | 'task';

// Bottom-up, so plain "Task" — far and away the most common — lands closest
// to the button.
const ITEMS: FabMenuItem[] = [
  { key: 'chain', label: 'Chain', icon: 'link' },
  { key: 'stack', label: 'Stack', icon: 'layers' },
  { key: 'recurring', label: 'Recurring', icon: 'repeat' },
  { key: 'task', label: 'Task', icon: 'checkmark-circle' },
];

interface Props {
  /** Distance from the bottom of the screen — matches the resting FAB's position. */
  bottom: number;
  onSelect: (type: AddTaskType) => void;
  disabled?: boolean;
  /** Fades the resting FAB (e.g. while a task is spotlighted). Ignored while the menu is open. */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
}

/** Today's add button: the shared FabMenu, typed to the four kinds of task it creates. */
export function AddTaskFab({ bottom, onSelect, disabled, opacity }: Props) {
  return (
    <FabMenu
      items={ITEMS}
      onSelect={key => onSelect(key as AddTaskType)}
      bottom={bottom}
      disabled={disabled}
      opacity={opacity}
    />
  );
}
