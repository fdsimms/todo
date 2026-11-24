import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { Gesture, GestureDetector, HoverEffect } from 'react-native-gesture-handler';

/**
 * Whether this device can have a pointer. An iPad can, and so can an iPad app on a Mac (iOS
 * reports it as an iPad); an iPhone never does. Fixed for the life of the process, which is what
 * lets `Hoverable` skip its wrapper rather than render one that does nothing: a gesture handler
 * per chip is a native cost on every row of a long list, wasted on a screen no pointer touches.
 */
const HAS_POINTER = Platform.OS === 'ios' && Platform.isPad === true;

/**
 * Pointer feedback for a button, for an iPad or Mac with a trackpad or mouse. iOS draws it, not
 * us: `lift` snaps the pointer onto the control and raises it a little. A touch screen has no
 * pointer, so on an iPhone this renders its child as it is, and nothing may depend on it.
 *
 * Only controls that are a button get one (`PressableScale`, `HoverTouchable`). A full-width row
 * gets no hover tint, which is the Mac's own convention for lists (`docs/arch/wide-layout.md`,
 * "Hover").
 *
 * Pass `none` for a disabled control so it doesn't invite a tap it can't take. The effect is a
 * prop of one wrapper that is always there, rather than the wrapper coming and going, so a control
 * that enables or disables doesn't remount.
 */
export function Hoverable({ effect, children }: { effect: 'lift' | 'none'; children: React.ReactElement }) {
  return HAS_POINTER ? <PointerHoverable effect={effect}>{children}</PointerHoverable> : children;
}

function PointerHoverable({ effect, children }: { effect: 'lift' | 'none'; children: React.ReactElement }) {
  const gesture = useMemo(() => Gesture.Hover().effect(effect === 'lift' ? HoverEffect.LIFT : HoverEffect.NONE), [effect]);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
