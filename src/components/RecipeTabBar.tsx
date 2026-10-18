import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

export type RecipeTab = 'ingredients' | 'steps' | 'timers' | 'details';

const TABS: { key: RecipeTab; label: string }[] = [
  { key: 'ingredients', label: 'Ingredients' },
  { key: 'steps', label: 'Steps' },
  { key: 'timers', label: 'Timers' },
  { key: 'details', label: 'Details' },
];

interface Props {
  value: RecipeTab;
  onChange: (tab: RecipeTab) => void;
  /** A timer is running or paused: a dot on its tab, so it shows from the other tabs. */
  timerActive: boolean;
}

/**
 * The recipe page's tab bar: the page is four short pages instead of one long
 * scroll, because the ingredients are what most visits are for and the timers,
 * facts and method used to sit above them. Underlined rather than a
 * segmented track, since the scale control right under it is already a track.
 */
export function RecipeTabBar({ value, onChange, timerActive }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {TABS.map(({ key, label }) => {
        const selected = key === value;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.tab, selected && styles.tabSelected]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => {
              if (selected) return;
              haptics.tap();
              animateLayout();
              onChange(key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={key === 'timers' && timerActive ? 'Timers, one is running' : label}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>{label}</Text>
            {key === 'timers' && timerActive && <View style={styles.dot} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  // The underline sits on the bar's own hairline (marginBottom: -hairline), so
  // the selected tab reads as part of the rule rather than a box above it.
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -border.hairline,
  },
  tabSelected: {
    borderBottomColor: colors.accent,
  },
  label: {
    color: colors.textSecondary,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  labelSelected: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
