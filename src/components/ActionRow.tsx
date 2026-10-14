import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';

export type ActionTone = 'plain' | 'muted' | 'action' | 'error';

/**
 * One tappable question inside an open row's editor: an icon, what it is
 * currently set to, and a quieter line saying where that came from. Each is its
 * own tinted block rather than a line in a table, so a row that has three of
 * them reads as three separate things to decide instead of one dense form.
 *
 * The scan sheet and the receipt sheet both ask a scanned line which item it is,
 * and this is how each asks it, so the two read the same.
 *
 * Without `onPress` it is a plain statement (nothing to change, so no chevron),
 * with a check when `done`. `extra` is the single pill that may sit beside the
 * text, kept a sibling of the tap area so touchables never nest.
 */
export function ActionRow({
  icon, title, note, tone, onPress, accessibilityLabel, extra, done, role, checked,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  note?: string | null;
  tone: ActionTone;
  onPress?: () => void;
  accessibilityLabel: string;
  extra?: React.ReactNode;
  done?: boolean;
  /** `'switch'` for an on/off row, which then reports `checked`. */
  role?: 'switch';
  checked?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const titleStyle =
    tone === 'action'
      ? styles.titleAction
      : tone === 'error'
        ? styles.titleError
        : tone === 'muted'
          ? styles.titleMuted
          : styles.title;
  const body = (
    <>
      <Ionicons
        name={icon}
        size={iconSize.md}
        color={checked || tone === 'action' ? colors.accent : colors.textTertiary}
      />
      <View style={styles.text}>
        <Text style={titleStyle} numberOfLines={3}>{title}</Text>
        {!!note && <Text style={styles.note}>{note}</Text>}
      </View>
    </>
  );
  return (
    <View style={styles.row}>
      {onPress ? (
        <TouchableOpacity
          style={styles.tap}
          activeOpacity={interaction.activeOpacity}
          onPress={onPress}
          accessibilityRole={role ?? 'button'}
          accessibilityState={role ? { checked: !!checked } : undefined}
          accessibilityLabel={accessibilityLabel}
        >
          {body}
        </TouchableOpacity>
      ) : (
        <View style={styles.tap} accessible accessibilityLabel={accessibilityLabel}>
          {body}
        </View>
      )}
      {extra}
      {onPress && !role ? (
        <Ionicons name="chevron-forward" size={iconSize.xs} color={colors.textTertiary} />
      ) : done ? (
        <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.greenText} />
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.smd,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
    },
    tap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 48, paddingVertical: spacing.sm },
    text: { flex: 1 },
    title: { color: colors.text, fontSize: font.sm },
    titleMuted: { color: colors.textSecondary, fontSize: font.sm },
    titleError: { color: colors.orangeText, fontSize: font.sm },
    titleAction: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
    note: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  });
}
