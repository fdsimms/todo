import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { format } from 'date-fns/format';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCurrentDayStart } from '../utils/dateUtils';
import { rotationMembers } from '../utils/rotation';
import { spacing, radius, font, fontWeight, border, checkboxRadius, type Colors } from '../theme';
import type { Task } from '../types';

interface Props {
  /** The rotation whose period is being shown. */
  task: Task;
  /** The uppercase caption above the list. */
  label?: string;
  /**
   * The day the period is read against. Defaults to now, which is what a live
   * row wants; a completed occurrence passes its own `completedAt` so a week
   * finished a fortnight ago still reads as its own week rather than as an
   * empty current one.
   */
  asOf?: Date;
}

/**
 * A rotation's period, drawn as a checklist: every member, ticked if it was
 * covered, with the day it was done.
 *
 * **Read-only, and that is the feature rather than a limitation.** These are
 * options, not subtasks. Ticking one here would be exactly the bypass
 * rotations exist to close: the parent asking which one you did is what keeps
 * a single row on Today instead of five, so the only way to log is through the
 * picker. `RotationPickSheet` is that picker, and it is deliberately not this
 * component in another mode — a picker whose taps do nothing would be a worse
 * thing than two small components.
 *
 * Shared by the task row's expansion and the Logbook's week sheet, which want
 * the same list for opposite reasons: one asks "what's left", the other "what
 * did I do".
 */
export function RotationChecklist({ task, label = 'This week', asOf }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const dayStart = asOf ?? getCurrentDayStart();
  const members = rotationMembers(task, dayStart, weekStartsOn);

  return (
    <View style={styles.tray}>
      <Text style={styles.label}>{label}</Text>
      {members.map(member => (
        <View key={member.item.id} style={styles.row}>
          <View style={[styles.box, member.doneAt !== null && styles.boxDone]}>
            {member.doneAt !== null && (
              <Ionicons name="checkmark" size={10} color={colors.onAccent} />
            )}
          </View>
          <Text
            style={[styles.name, member.doneAt !== null && styles.nameDone]}
            numberOfLines={1}
          >
            {member.item.title}
          </Text>
          {member.doneAt !== null && (
            <Text style={styles.when}>{format(new Date(member.doneAt), 'EEE')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // A sunken region rather than a card, the same move TaskGroupTray makes: the
  // checklist belongs *to* whatever it sits under, and a card inside a card
  // reads as a second row rather than as this one's contents.
  tray: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xsm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  box: {
    width: 14,
    height: 14,
    borderRadius: checkboxRadius(14),
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxDone: { backgroundColor: colors.green, borderColor: colors.green },
  name: { flex: 1, color: colors.text, fontSize: font.sm },
  nameDone: { color: colors.textTertiary },
  when: { color: colors.textTertiary, fontSize: font.xxs },
});
