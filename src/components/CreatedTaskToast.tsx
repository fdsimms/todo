import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InlineAction } from './InlineAction';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';
import type { Task } from '../types';
import {
  describeCreatedTaskPlacement,
  describeMovedTaskPlacement,
  type CreatedTaskDestination,
} from '../utils/createdTaskPlacement';

interface Props {
  task: Task;
  destination: CreatedTaskDestination;
  /**
   * 'created' (the default) is a task that just came into existence;
   * 'moved' is one that was already in the Inbox and left it by taking an
   * in-row suggestion — see TodayScreen's presentMovedFromInbox. Only the
   * wording and the Undo action differ; Undo restores the row rather than
   * deleting it, which is TodayScreen's call, not this component's.
   */
  mode?: 'created' | 'moved';
  dayResetTime?: string;
  bottom: number;
  onGoToTask: () => void;
  onUndo: () => void;
}

/**
 * Toast TodayScreen shows when a newly created task lands somewhere other
 * than Today (Later, Unscheduled, Inbox) — see `handleTaskCreated`. Used to
 * switch the screen to that sub-view outright, which cost anyone quickly
 * adding several tasks their place on Today after every one that wasn't
 * due today. This names where the task went and offers a way to it and a
 * way to undo the creation, so staying put costs nothing either.
 */
export function CreatedTaskToast({ task, destination, mode = 'created', dayResetTime, bottom, onGoToTask, onUndo }: Props) {
  const { colors, shadows } = useTheme();
  const styles = makeStyles(colors);
  const message = mode === 'moved'
    ? describeMovedTaskPlacement(task, destination, dayResetTime)
    : describeCreatedTaskPlacement(task, destination, dayResetTime);
  const undoHint = mode === 'moved'
    ? `Undo moving "${task.title}"`
    : `Undo creating "${task.title}"`;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, shadows.fab]}>
        <Text style={styles.label} numberOfLines={2}>
          {message}
        </Text>
        <View style={styles.actions}>
          <InlineAction label="Go to it" onPress={onGoToTask} accessibilityLabel={`Go to "${task.title}"`} />
          <InlineAction
            label="Undo"
            onPress={onUndo}
            variant="neutral"
            accessibilityLabel={undoHint}
          />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  label: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
