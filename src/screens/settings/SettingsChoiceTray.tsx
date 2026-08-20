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
  /**
   * Pass this instead of `selectedId` to pick several — the glyphs become
   * checkboxes and the tray announces itself accordingly. It's a second prop
   * rather than an array `selectedId` because the two differ in more than
   * arity: a single-choice tray is a radio group whose caller usually closes it
   * on the tap, a multiple-choice one stays open while a set is built.
   */
  selectedIds?: readonly string[];
  onSelect: (option: T) => void;
  /** The line above the choices saying what they are ("Import from"). */
  caption: string;
  /** Shown in place of the choices when there are none to offer. */
  emptyText?: string;
  accessibilityLabelFor?: (option: T) => string;
  /**
   * A second line under an option's title — the calendar picker's per-source
   * read status (#1744: "3 events" / "Couldn't read"). Returning undefined
   * for an option renders no second line, same as omitting the prop entirely;
   * every other tray leaves this unset.
   */
  subtitleFor?: (option: T) => string | undefined;
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
  options, selectedId, selectedIds, onSelect, caption, emptyText, accessibilityLabelFor, subtitleFor,
}: Props<T>) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const multiple = selectedIds !== undefined;

  return (
    <View style={styles.tray}>
      <Text style={styles.caption}>{caption}</Text>
      {options.length === 0 && !!emptyText && <Text style={styles.empty}>{emptyText}</Text>}
      {options.map(option => {
        const selected = multiple ? selectedIds!.includes(option.id) : option.id === selectedId;
        const subtitle = subtitleFor?.(option);
        return (
          <TouchableOpacity
            key={option.id}
            style={styles.option}
            onPress={() => onSelect(option)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={multiple ? { checked: selected } : { selected }}
            accessibilityLabel={
              accessibilityLabelFor?.(option) ?? (subtitle ? `${option.title}, ${subtitle}` : option.title)
            }
          >
            <Ionicons
              name={
                multiple
                  ? selected ? 'checkbox' : 'square-outline'
                  : selected ? 'radio-button-on' : 'radio-button-off'
              }
              size={iconSize.sm}
              color={selected ? colors.accent : colors.textTertiary}
            />
            <View style={styles.optionTextGroup}>
              <Text style={[styles.optionText, selected && styles.optionTextSelected]} numberOfLines={1}>
                {option.title}
              </Text>
              {!!subtitle && (
                <Text style={styles.optionSubtitle} numberOfLines={1}>{subtitle}</Text>
              )}
            </View>
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
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  empty: { color: colors.textTertiary, fontSize: font.sm, paddingVertical: spacing.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10,
  },
  optionTextGroup: { flexShrink: 1 },
  optionText: { color: colors.text, fontSize: font.md },
  optionTextSelected: { color: colors.accent, fontWeight: fontWeight.medium },
  optionSubtitle: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
});
