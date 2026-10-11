import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, type Colors } from '../theme';
import { formatDeadlineLabel, formatTaskDate } from '../utils/dateUtils';
import { unlockProjects } from '../hooks/useProjectAccess';
import { InlineAction } from './InlineAction';

/**
 * A task in a locked project, drawn in place of its real row. The title, notes,
 * tags, project and everything else are left out; the date and deadline stay,
 * since "something is due Friday" is the part that is useful without Face ID.
 *
 * It has no checkbox, swipe, drag or editor: completing or rescheduling a task
 * you can't read is how the wrong thing gets done. The one control is Unlock,
 * which opens every locked project for the session (`unlockProjects`).
 */
export function LockedTaskRow({ task, indented = false }: { task: Task; indented?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const date = formatTaskDate(task);
  const deadline = task.deadline ? formatDeadlineLabel(task.deadline, task.deadlineTime) : null;
  const when = [date, deadline ? `Due ${deadline}` : null].filter(Boolean).join(' · ');

  return (
    <View
      style={[styles.wrapper, indented && styles.wrapperIndented]}
      accessible
      accessibilityLabel={`Locked task${when ? `, ${when}` : ''}`}
    >
      <View style={styles.iconSlot}>
        <Ionicons name="lock-closed" size={16} color={colors.textTertiary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>Locked task</Text>
        {when !== '' && <Text style={styles.when} numberOfLines={1}>{when}</Text>}
      </View>
      <InlineAction
        label="Unlock"
        onPress={() => { unlockProjects(); }}
        accessibilityLabel="Unlock locked projects with Face ID"
        haptic
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // The same card as TaskItem.itemWrapper, so a locked row sits among the
  // others rather than reading as a different kind of list.
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  wrapperIndented: { marginHorizontal: 0 },
  // The width of a checkbox, so a locked title lines up with the real ones.
  iconSlot: { width: 22, alignItems: 'center' },
  body: { flex: 1 },
  title: {
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
  },
  when: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xxs },
});
