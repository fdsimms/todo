import React, { useMemo } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';

export interface FilterChipItem {
  key: string;
  label: string;
  /** Per-item accent color (e.g. a tag's color). Omit for items with no per-item color, like categories. */
  color?: string;
}

interface Props {
  items: FilterChipItem[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Show a color dot on inactive chips — on for tag-style bars, off for plain ones like categories. */
  showDot?: boolean;
}

// Single-select chip row for filtering by a set of items (tags, categories, ...).
export function FilterChipBar({ items, selected, onSelect, showDot }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <Chip
        label="All"
        active={selected === null}
        color={colors.accent}
        showDot={!!showDot}
        onPress={() => onSelect(null)}
        styles={styles}
      />
      {items.map(item => (
        <Chip
          key={item.key}
          label={item.label}
          active={selected === item.key}
          color={item.color ?? colors.accent}
          showDot={!!showDot}
          onPress={() => onSelect(selected === item.key ? null : item.key)}
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  color,
  showDot,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  color: string;
  showDot: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      style={[styles.chip, active && { backgroundColor: color }]}
    >
      {showDot && !active && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // ScrollView's own base style is flexGrow/flexShrink: 1, so in a column
  // parent this row gets shrunk by whatever list sits below it — the chips
  // end up shorter than their own padding and the labels spill out. Same
  // reason TodayScreen's view-mode pills pin their scroll view.
  scroll: { flexGrow: 0, flexShrink: 0 },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.text,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
