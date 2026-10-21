import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { iconSize, radius } from '../theme';

interface Props {
  /** Read aloud when set. Leave it off where the row's own label already says it is a record. */
  accessibilityLabel?: string;
}

const SIZE = 28;

/**
 * The trophy that marks a personal record: the finish summary, a workout's page,
 * Stats and an exercise's page all draw it, so a record looks the same wherever
 * it turns up. Accent rather than gold, because gold in this app is finishing
 * (the checked box, coins, streaks).
 */
export function RecordBadge({ accessibilityLabel }: Props) {
  const colors = useColors();
  return (
    <View
      style={[styles.circle, { backgroundColor: colors.accentSubtle }]}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      <Ionicons name="trophy" size={iconSize.sm} color={colors.accentText} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { width: SIZE, height: SIZE, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
