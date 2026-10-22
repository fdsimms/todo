import React, { useCallback } from 'react';
import { View, type ViewProps } from 'react-native';
import { getNativePointerView, type NativePointerMenuItem } from 'todo-key-commands';
import { runningOnMac } from '../utils/runningOnMac';

export type PointerMenuItem = NativePointerMenuItem;

const NO_ITEMS: NativePointerMenuItem[] = [];

/** One right-click menu item. `icon` is an SF Symbol name. */
export function pointerMenuItem(id: string, title: string, icon = '', destructive = false): PointerMenuItem {
  return { id, title, icon, destructive };
}

interface Props extends ViewProps {
  /** Shown when the pointer rests on it, on a Mac. Pass the control's accessibility label. */
  toolTip?: string;
  /**
   * Its right-click menu, on a Mac. Empty or omitted means none. `icon` is an
   * SF Symbol name (a Mac menu draws one beside each item), or '' for none.
   */
  menuItems?: readonly PointerMenuItem[];
  /** Called with the id of the item picked from `menuItems`. */
  onMenuSelect?: (id: string) => void;
}

/**
 * A View that, on a Mac, gives what it wraps a tooltip and a right-click menu
 * (`TodoPointerView` in `modules/todo-key-commands`). Anywhere else it is a
 * plain View with the same props, so the layout is the same on every device
 * and a call site needs no gate of its own.
 *
 * The right-click menu is the desktop way to reach a row's actions. It offers
 * what the row already offers (its buttons, its swipes), never something new,
 * and it is Mac only because a context menu opens on a long press on a touch
 * screen, where a long press on a row means drag.
 */
export function PointerView({ toolTip, menuItems, onMenuSelect, children, ...rest }: Props) {
  const NativeView = runningOnMac() ? getNativePointerView() : null;
  const handleSelect = useCallback(
    (event: { nativeEvent: { id: string } }) => onMenuSelect?.(event.nativeEvent.id),
    [onMenuSelect],
  );
  if (!NativeView) return <View {...rest}>{children}</View>;
  return (
    <NativeView
      {...rest}
      toolTip={toolTip ?? null}
      // The caller's array as it is: a copy here would be a new prop on every
      // render, and each one resets the native menu.
      menuItems={(menuItems ?? NO_ITEMS) as NativePointerMenuItem[]}
      onMenuSelect={handleSelect}
    >
      {children}
    </NativeView>
  );
}
