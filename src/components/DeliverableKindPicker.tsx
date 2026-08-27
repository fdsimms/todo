import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DeliverableKind } from '../types';
import { DELIVERABLE_META } from '../utils/deliverables';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, border, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  value: DeliverableKind | null;
  /** Called with the picked kind, or null for "Nothing". */
  onChange: (kind: DeliverableKind | null) => void;
}

/**
 * The "Ask on completion" pill grid — Nothing / Text / Date / Number.
 *
 * Shared because a template item declares the same question a task does
 * (#1471): both editors show one grid over one `DELIVERABLE_META`, so neither
 * can end up offering a kind the other doesn't. The row it sits in stays with
 * the caller — the two editors word their hints and summaries themselves, and
 * TaskEditor's row also collapses its field on a pick.
 */
export function DeliverableKindPicker({ value, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.pillRow}>
      <TouchableOpacity
        style={[styles.pill, !value && styles.pillActive]}
        onPress={() => { haptics.tap(); onChange(null); }}
        accessibilityRole="button"
        accessibilityState={{ selected: !value }}
      >
        <Text style={[styles.pillText, !value && styles.pillTextActive]}>Nothing</Text>
      </TouchableOpacity>
      {DELIVERABLE_META.map(meta => (
        <TouchableOpacity
          key={meta.key}
          style={[styles.pill, styles.pillWithIcon, value === meta.key && styles.pillActive]}
          onPress={() => { haptics.tap(); onChange(meta.key); }}
          accessibilityRole="button"
          accessibilityState={{ selected: value === meta.key }}
          accessibilityLabel={`${meta.label}. ${meta.hint}`}
        >
          <Ionicons
            name={meta.icon as never}
            size={iconSize.sm}
            color={value === meta.key ? colors.text : colors.textSecondary}
          />
          <Text style={[styles.pillText, value === meta.key && styles.pillTextActive]}>
            {meta.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, minHeight: interaction.pillHeight,
    justifyContent: 'center',
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActive: { backgroundColor: colors.bgQuaternary },
  pillWithIcon: { flexDirection: 'row', gap: 6, borderWidth: border.sm, borderColor: 'transparent' },
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
});
