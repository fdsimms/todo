import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { type Colors, font, fontWeight, radius } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  label: string;
  /** How long the button has to be held before `onConfirm` fires. */
  holdMs: number;
  onConfirm: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** Layout only (margins); the shape and colors are the component's. */
  style?: object;
}

/**
 * A button that does nothing on a tap: it has to be held for `holdMs`, filling
 * as it goes, and lifting early drains it back. Long on purpose, so the action
 * behind it is a decision made deliberately rather than a stray touch or a tap
 * made half asleep. The alarm mission's Give up and the Screen Time screen's
 * End all blocks are both this, so the two can't feel different.
 */
export function HoldToConfirmButton({ label, holdMs, onConfirm, disabled, accessibilityLabel, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fill = useRef(new Animated.Value(0)).current;
  const holding = useRef<Animated.CompositeAnimation | null>(null);

  const drain = () => {
    holding.current?.stop();
    holding.current = null;
    Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };

  // A button turned off mid-hold (the reason was cleared) stops filling.
  useEffect(() => {
    if (disabled) drain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const start = () => {
    if (disabled) return;
    haptics.impactLight();
    holding.current = Animated.timing(fill, {
      toValue: 1,
      duration: holdMs,
      useNativeDriver: false,
    });
    holding.current.start(({ finished }) => {
      if (!finished) return;
      holding.current = null;
      haptics.warning();
      onConfirm();
    });
  };

  return (
    <Pressable
      onPressIn={start}
      onPressOut={drain}
      disabled={disabled}
      style={[styles.button, disabled && styles.off, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View
        style={[
          styles.fill,
          { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  off: { opacity: 0.4 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.redFill,
  },
  text: {
    color: colors.redText,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
