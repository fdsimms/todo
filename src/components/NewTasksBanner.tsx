import React, { useEffect, useMemo, useRef } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useReduceMotion } from '../utils/useReduceMotion';
import { haptics } from '../utils/haptics';

interface Props {
  count: number;
  onDismiss: () => void;
}

/**
 * Banner shown on the Today screen when tasks have newly become visible
 * since the user last saw them. Dismissing clears the "new" badge on every
 * one of those tasks (see isTaskNew / markTasksSeen).
 */
export function NewTasksBanner({ count, onDismiss }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: animation.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);

  const handleDismiss = () => {
    haptics.tap();
    onDismiss();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
    >
      <Text style={styles.text} numberOfLines={1}>
        You have <Text style={styles.count}>{count}</Text> new to-do{count === 1 ? '' : 's'}
      </Text>
      <PressableScale style={styles.button} onPress={handleDismiss} accessibilityLabel="Dismiss new to-dos notice">
        <Text style={styles.buttonText}>OK</Text>
      </PressableScale>
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.warningBg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  count: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onWarning, fontSize: font.sm, fontWeight: fontWeight.bold },
});
