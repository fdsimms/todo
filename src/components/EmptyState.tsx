import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, lineHeight, spacing, radius, type Colors } from '../theme';
import { PressableScale } from './PressableScale';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Optional call-to-action pill button below the text. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Shared empty state: tinted icon circle + title + subtitle that gently
 * fades and rises in on mount. Use for every empty list in the app.
 */
export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const progress = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: animation.duration.normal,
        useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: 1,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }),
    ]).start();
  }, [progress, iconScale]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <Animated.View style={[styles.iconCircle, { transform: [{ scale: iconScale }] }]}>
        <Ionicons name={icon} size={34} color={colors.textTertiary} />
      </Animated.View>
      <Text style={styles.title}>{title}</Text>
      {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel != null && onAction != null && (
        <PressableScale style={styles.actionBtn} onPress={onAction} haptic>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { color: colors.textSecondary, fontSize: font.lg, fontWeight: fontWeight.semibold },
  subtitle: {
    color: colors.textTertiary, fontSize: font.sm, textAlign: 'center',
    paddingHorizontal: spacing.xl, lineHeight: lineHeight.sm,
  },
  actionBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  actionText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
