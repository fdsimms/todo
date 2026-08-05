import React from 'react';
import { View, Platform } from 'react-native';
import { BlurView, BlurViewProps } from 'expo-blur';
import { useColors } from '../theme/ThemeContext';

// expo-blur has no web implementation, so web falls back to a semi-
// transparent View instead.
type Props = BlurViewProps;

export function SafeBlurView({ style, intensity = 50, tint = 'default', children, ...rest }: Props) {
  const colors = useColors();
  if (Platform.OS === 'web') {
    return <View style={[{ backgroundColor: colors.blurFallback }, style]}>{children}</View>;
  }
  return (
    <BlurView intensity={intensity} tint={tint} style={style} {...rest}>
      {children}
    </BlurView>
  );
}
