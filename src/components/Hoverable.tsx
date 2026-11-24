import React, { useMemo } from 'react';
import { Gesture, GestureDetector, HoverEffect } from 'react-native-gesture-handler';

/**
 * Pointer feedback for a button, for an iPad or Mac with a trackpad or mouse. iOS draws it, not
 * us: `lift` snaps the pointer onto the control and raises it a little. A touch screen has no
 * pointer, so on an iPhone this does nothing, and nothing may depend on it.
 *
 * Only controls that are a button get one (`PressableScale`). A full-width row gets no hover tint,
 * which is the Mac's own convention for lists (`docs/arch/wide-layout.md`, "Hover").
 *
 * Pass `none` for a disabled control so it doesn't invite a tap it can't take. The effect is a
 * prop of one wrapper that is always there, rather than the wrapper coming and going, so a control
 * that enables or disables doesn't remount.
 */
export function Hoverable({ effect, children }: { effect: 'lift' | 'none'; children: React.ReactElement }) {
  const gesture = useMemo(() => Gesture.Hover().effect(effect === 'lift' ? HoverEffect.LIFT : HoverEffect.NONE), [effect]);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
