import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';

interface Props {
  categoryLabel: string;
  onClear: () => void;
}

/**
 * Shown on Today while a category header's long-press has narrowed the list
 * down to just that category (see toggleCategoryFocus in TodayScreen). The
 * long-press itself has no visible affordance once it's done, so this is the
 * only thing on screen saying the rest of Today is hidden, not gone.
 */
export function CategoryFocusBanner({ categoryLabel, onClear }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const handleClear = () => {
    haptics.tap();
    onClear();
  };

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Ionicons name="locate" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.text} numberOfLines={1}>
          Focused on <Text style={styles.category}>{categoryLabel}</Text>
        </Text>
      </View>
      <PressableScale style={styles.button} onPress={handleClear} accessibilityLabel={`Stop focusing on ${categoryLabel}`}>
        <Text style={styles.buttonText}>Clear</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  category: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
});
