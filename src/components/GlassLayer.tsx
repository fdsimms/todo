import React from 'react';
import { Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '../theme/ThemeContext';

let supported: boolean | undefined;

/**
 * Whether this device can draw Liquid Glass at all (iOS 26+, and the API
 * present at runtime: some iOS 26 betas lack it and crash). Read once, since
 * neither answer changes while the app runs. The user's Reduce Transparency
 * setting is not checked here: the system flattens a glass view itself.
 *
 * A surface that uses glass sets its own fill to transparent only when this is
 * true, so the host keeps its solid fill everywhere else.
 */
export function glassSupported(): boolean {
  if (supported === undefined) {
    try {
      supported = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
    } catch {
      supported = false;
    }
  }
  return supported;
}

interface Props {
  /** Corner radius, which `GlassView` clips to; match the host's own. */
  style?: StyleProp<ViewStyle>;
  /** Tints the glass. Use a fill token, never a raw colour. */
  tintColor?: string;
  /** Lets the glass react to a touch. Only on a layer under something pressable. */
  interactive?: boolean;
  /** `clear` shows more of what's behind; `regular` is the default for anything holding text. */
  effect?: 'regular' | 'clear';
}

/**
 * The glass behind a surface, as an underlay filling its host. Renders nothing
 * where glass is unavailable, so a host draws its usual fill in that case:
 * `const glass = glassSupported()`, then `backgroundColor: glass ? 'transparent' : fill`.
 * It never takes a touch, and the host's children draw over it.
 *
 * `colorScheme` follows the app's own theme rather than the system's, since the
 * theme is a setting here and the two can disagree.
 */
export function GlassLayer({ style, tintColor, interactive, effect = 'regular' }: Props) {
  const { isDark } = useTheme();
  if (!glassSupported()) return null;
  return (
    <GlassView
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      glassEffectStyle={effect}
      tintColor={tintColor}
      isInteractive={interactive}
      colorScheme={isDark ? 'dark' : 'light'}
    />
  );
}
