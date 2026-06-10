import React from 'react';
import { View, Platform } from 'react-native';
import { BlurView, BlurViewProps } from 'expo-blur';
import { useColors } from '../theme/ThemeContext';

// BlurView can silently fail in Expo Go when native module versions are
// mismatched. This wrapper falls back to a semi-transparent View instead.
let nativeBlurAvailable = true;

type Props = BlurViewProps & { fallbackColor?: string };

export function SafeBlurView({ style, intensity = 50, tint = 'default', fallbackColor, children, ...rest }: Props) {
  const colors = useColors();
  if (!nativeBlurAvailable || Platform.OS === 'web') {
    const bg = fallbackColor ?? colors.blurFallback;
    return <View style={[{ backgroundColor: bg }, style]}>{children}</View>;
  }
  return (
    <BlurView intensity={intensity} tint={tint} style={style} {...rest}>
      {children}
    </BlurView>
  );
}

export function markBlurUnavailable() {
  nativeBlurAvailable = false;
}
