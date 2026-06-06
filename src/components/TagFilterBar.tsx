import React from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { colors, spacing, radius, font } from '../theme';
import { tagColor } from '../utils/tagColor';

interface Props {
  tags: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

export function TagFilterBar({ tags, selected, onSelect }: Props) {
  if (tags.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <Chip label="All" active={selected === null} color={colors.accent} onPress={() => onSelect(null)} />
      {tags.map(tag => (
        <Chip
          key={tag}
          label={tag}
          active={selected === tag}
          color={tagColor(tag)}
          onPress={() => onSelect(selected === tag ? null : tag)}
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
}: {
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.chip, active && { backgroundColor: color }]}
    >
      {!active && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
});
