import React from 'react';
import { TouchableOpacity, type TouchableOpacityProps } from 'react-native';
import { interaction } from '../theme';
import { Hoverable } from './Hoverable';

/**
 * A `TouchableOpacity` for a button, chip or icon button that gets the pointer effect on an iPad
 * or Mac (`Hoverable`). It dims on press exactly as a `TouchableOpacity` does. A full-width row
 * stays a plain `TouchableOpacity`: a list gets no hover tint on a Mac, and a lift on a row looks
 * wrong. Nothing is lifted while `disabled`.
 */
export function HoverTouchable({ activeOpacity = interaction.activeOpacity, ...props }: TouchableOpacityProps) {
  return (
    <Hoverable effect={props.disabled ? 'none' : 'lift'}>
      <TouchableOpacity activeOpacity={activeOpacity} {...props} />
    </Hoverable>
  );
}
