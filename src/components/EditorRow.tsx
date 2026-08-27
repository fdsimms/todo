import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, interaction, type Colors } from '../theme';
import { disclosureValue } from '../theme/textStyles';
import { haptics } from '../utils/haptics';
import { useSettingsStore } from '../store/useSettingsStore';

interface Props {
  icon: string;
  label: string;
  /** The current value — replaces the hint once something is set. */
  value?: string;
  /** One-liner explaining what the row does, shown while it has no value. */
  hint?: string;
  /** One-liner shown below a set value, for a value that needs a caveat attached. */
  caption?: string;
  /**
   * Set for rows whose controls unfold in place rather than opening a picker:
   * swaps the disclosure chevron for an up/down one.
   */
  expanded?: boolean;
  onPress: () => void;
  onClear?: () => void;
}

/**
 * The standard "icon — label — value ›" row shared by every editor sheet.
 * Lives here rather than in each editor so the task, project and template
 * forms can't drift apart in padding, chevron or clear-button behaviour.
 */
export function EditorRow({ icon, label, value, hint, caption, expanded, onPress, onClear }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const chevron = expanded === undefined
    ? 'chevron-forward'
    : expanded ? 'chevron-up' : 'chevron-down';

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => { haptics.tap(); onPress(); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${label}${value ? `: ${value}` : ''}${caption && value ? `. ${caption}` : ''}`}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
    >
      <Ionicons name={icon as never} size={18} color={value ? colors.accent : colors.textSecondary} />
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        {!!hint && !value && !hideHelpText && <Text style={styles.hint}>{hint}</Text>}
        {!!caption && !!value && <Text style={styles.hint}>{caption}</Text>}
      </View>
      {value ? (
        <View style={styles.valueRow}>
          <Text style={styles.value} numberOfLines={1}>{value}</Text>
          {onClear && (
            <TouchableOpacity
              onPress={onClear}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${label.toLowerCase()}`}
            >
              <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <Ionicons name={chevron} size={14} color={colors.textSecondary} />
        </View>
      ) : (
        <Ionicons name={chevron} size={14} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  // Grows to push the value column to the right when there's room, but never
  // shrinks below the label's natural width — a long value should give way
  // first (it already truncates via numberOfLines), not force the label to
  // wrap mid-word.
  content: { flexGrow: 1, flexShrink: 0 },
  label: { color: colors.text, fontSize: font.md },
  hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  value: { ...disclosureValue(colors), flexShrink: 1 },
});
