// The task editor's Stack picker: a find field over one row per stack, in
// place of the wrapping pill grid, which stopped being scannable once a person
// had a couple of dozen stacks. Same shape as `CategoryPickerList`; the filter
// and cap rules live in src/utils/stackPicker.ts.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useFilterField } from '../hooks/useFilterField';
import { stackRows, type StackOption } from '../utils/stackPicker';

interface Props {
  stacks: StackOption[];
  /** The chosen stack's id, or null for "None". */
  value: string | null;
  onSelect: (id: string | null) => void;
}

export function StackPickerList({ stacks, value, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { query, clear: clearQuery, props: filterField } = useFilterField();
  const [expanded, setExpanded] = useState(false);

  const trimmed = query.trim();
  const { pinned, rows, hidden } = stackRows(stacks, value, query, expanded);

  const pick = (id: string | null) => {
    haptics.tap();
    onSelect(id);
  };

  const renderRow = (stack: StackOption, selected: boolean) => (
    <TouchableOpacity
      key={stack.id}
      style={styles.row}
      onPress={() => pick(stack.id)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={stack.category ? `${stack.title}, ${stack.category}` : stack.title}
    >
      <View style={styles.rowIcon}>
        <Ionicons name="layers-outline" size={16} color={colors.textSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, selected && styles.rowNameSelected]} numberOfLines={1}>
          {stack.title}
        </Text>
        {!!stack.category && (
          <Text style={styles.rowCategory} numberOfLines={1}>{stack.category}</Text>
        )}
      </View>
      {selected && <Ionicons name="checkmark" size={17} color={colors.accent} />}
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          {...filterField}
          placeholder="Find a stack…"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          autoCorrect={false}
          autoCapitalize="words"
          accessibilityLabel="Find a stack"
        />
        {!!trimmed && (
          <TouchableOpacity
            onPress={() => clearQuery()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* "None" is the field's empty value, so typing never offers it. */}
      {!trimmed && (
        <TouchableOpacity
          style={styles.row}
          onPress={() => pick(null)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: value === null }}
          accessibilityLabel="No stack"
        >
          <View style={styles.rowIcon}>
            <Ionicons name="remove-outline" size={16} color={colors.textSecondary} />
          </View>
          <Text style={[styles.rowName, styles.rowNameMuted, styles.rowText]} numberOfLines={1}>None</Text>
          {value === null && <Ionicons name="checkmark" size={17} color={colors.accent} />}
        </TouchableOpacity>
      )}

      {pinned && renderRow(pinned, true)}
      {rows.map(stack => renderRow(stack, stack.id === value))}

      {!!trimmed && rows.length === 0 && (
        <Text style={styles.empty}>No stack matches “{trimmed}”.</Text>
      )}

      {hidden > 0 && (
        <TouchableOpacity
          style={styles.more}
          onPress={() => { haptics.tap(); setExpanded(true); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Show all ${stacks.length} stacks`}
        >
          <Text style={styles.moreText}>Show all {stacks.length} stacks</Text>
          <Ionicons name="chevron-down" size={iconSize.sm} color={colors.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  // A height rather than a lineHeight: see the note on TextInput in CLAUDE.md.
  searchInput: { flex: 1, color: colors.text, fontSize: font.md, minHeight: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    minHeight: 44,
  },
  rowIcon: { width: 24, alignItems: 'center' },
  rowText: { flex: 1 },
  rowName: { color: colors.text, fontSize: font.md },
  rowNameSelected: { fontWeight: fontWeight.semibold },
  rowNameMuted: { color: colors.textSecondary },
  rowCategory: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  empty: { fontSize: font.sm, color: colors.textTertiary, paddingVertical: spacing.sm },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  moreText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
});
