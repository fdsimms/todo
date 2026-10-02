import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, iconSize, animation } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';

const SIZE = 44;

interface Props {
  visible: boolean;
  /** Distance from the bottom edge — match the screen's own Fab so the two line up. */
  bottom: number;
  onPress: () => void;
}

/**
 * Floating "back to top" button for a long scrolling list. Fades in once the
 * caller says the list has scrolled down far enough, and sits in the corner
 * opposite the Fab's own (`fabHand` in Settings), so a screen that also has a
 * Fab never ends up with two floating buttons stacked in the same corner.
 */
export function ScrollToTopButton({ visible, bottom, onPress }: Props) {
  const colors = useColors();
  const { shadows } = useTheme();
  const hand = useSettingsStore(s => s.fabHand);
  const opacity = useRef(new Animated.Value(0)).current;
  // Stays mounted a beat after `visible` goes false so the fade-out can play;
  // pointerEvents drops immediately so a fading button can't still be tapped.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.container,
        {
          bottom,
          left: hand === 'left' ? undefined : spacing.lg,
          right: hand === 'left' ? spacing.lg : undefined,
          opacity,
        },
      ]}
    >
      <PressableScale
        style={[
          styles.button,
          shadows.fab,
          { backgroundColor: colors.accentFill, shadowColor: colors.accent },
        ]}
        pressScale={0.9}
        haptic
        onPress={onPress}
        accessibilityLabel="Scroll to top"
      >
        <Ionicons name="arrow-up" size={iconSize.md} color={colors.onAccent} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 15,
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
