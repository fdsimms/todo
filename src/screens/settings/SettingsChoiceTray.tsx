import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, type Colors } from '../../theme';

interface Option {
  id: string;
  title: string;
}

interface Props<T extends Option> {
  options: T[];
  selectedId?: string | null;
  onSelect: (option: T) => void;
  /** The line above the choices saying what they are ("Import from"). */
  caption: string;
  /** Shown in place of the choices when there are none to offer. */
  emptyText?: string;
  accessibilityLabelFor?: (option: T) => string;
}

/**
 * The choices belonging to a `SettingsRow` that unfolds in place, rather than
 * pushing a screen — the Reminders list pickers.
 *
 * These used to be bare `SettingsRow`-shaped rows appended to the card, which
 * made them indistinguishable from the settings *above* them: the row's accent
 * "Choose" read as a button that would open something, and the options it
 * unfolded read as three more settings that had always been there. So they sit
 * in a `bgSunken` region under their row, the way `TaskGroupTray` encloses a
 * stack's tasks — enclosure is what says "these belong to the row above",
 * where resemblance said the opposite.
 */
export function SettingsChoiceTray<T extends Option>({
  options, selectedId, onSelect, caption, emptyText, accessibilityLabelFor,
}: Props<T>) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.tray}>
      <Text style={styles.caption}>{caption}</Text>
      {options.length === 0 && !!emptyText && <Text style={styles.empty}>{emptyText}</Text>}
      {options.map(option => {
        const selected = option.id === selectedId;
        return (
          <TouchableOpacity
            key={option.id}
            style={styles.option}
            onPress={() => onSelect(option)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={accessibilityLabelFor?.(option) ?? option.title}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={iconSize.sm}
              color={selected ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.optionText, selected && styles.optionTextSelected]} numberOfLines={1}>
              {option.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  tray: {
    backgroundColor: colors.bgSunken,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  caption: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  empty: { color: colors.textTertiary, fontSize: font.sm, paddingVertical: spacing.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10,
  },
  optionText: { color: colors.text, fontSize: font.md, flexShrink: 1 },
  optionTextSelected: { color: colors.accent, fontWeight: fontWeight.medium },
});
