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
import { tagColor } from '../utils/tagColor';

interface Props {
  tags: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

export function TagFilterBar({ tags, selected, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (tags.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <Chip label="All" active={selected === null} color={colors.accent} onPress={() => onSelect(null)} styles={styles} />
      {tags.map(tag => (
        <Chip
          key={tag}
          label={tag}
          active={selected === tag}
          color={tagColor(tag)}
          onPress={() => onSelect(selected === tag ? null : tag)}
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
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      style={[styles.chip, active && { backgroundColor: color }]}
    >
      {!active && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
