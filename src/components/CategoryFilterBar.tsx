import React, { useMemo } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { useCategoryStore } from '../store/useCategoryStore';

interface Props {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}

// Single-select chip row for filtering by category, styled to match
// TagFilterBar. Categories have no per-item color (unlike tags), so chips
// lead with the category's emoji when it has one instead of a color dot.
export function CategoryFilterBar({ categories, selected, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);

  if (categories.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <Chip label="All" active={selected === null} onPress={() => onSelect(null)} styles={styles} />
      {categories.map(category => {
        const emoji = getCategoryByName(category)?.emoji;
        return (
          <Chip
            key={category}
            label={emoji ? `${emoji} ${category}` : category}
            active={selected === category}
            onPress={() => onSelect(selected === category ? null : category)}
            styles={styles}
          />
        );
      })}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipActive: {
    backgroundColor: colors.accent,
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
