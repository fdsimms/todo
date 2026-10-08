import React, { useCallback, useMemo } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Task, TaskGroup } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { TaskGroupHeader } from './TaskGroupHeader';
import { TaskGroupBody } from './TaskGroupBody';
import { TaskGroupTray } from './TaskGroupTray';

/** Rows shown under an opened stack before "Show N more". */
export const LATER_STACK_PREVIEW = 5;

interface Props {
  /** The list item's key, which names this stack on this day (one stack can fold on several). */
  itemKey: string;
  group: TaskGroup;
  /** Only this day's members of the stack, in Later order. */
  tasks: Task[];
  open: boolean;
  showAll: boolean;
  selectionMode: boolean;
  onToggle: (itemKey: string) => void;
  onShowAll: (itemKey: string) => void;
  onCompleteIds: (ids: string[]) => void;
  onDeferIds: (ids: string[], date: Date) => void;
  onSelectIds: (ids: string[]) => void;
  onPressEdit: (groupId: string) => void;
  renderTask: (task: Task) => React.ReactNode;
}

/**
 * A stack's tasks that share one Later day, folded to a single row.
 *
 * Every action here is scoped to `tasks`, not the stack's roster: the stack's
 * other members sit on other days or on Today, and rescheduling or completing
 * "all of Pack for Poconos" from Saturday's row must not touch them. That is
 * why this binds its own callbacks around the header's id-based ones instead
 * of handing it TodayScreen's whole-stack handlers.
 */
export function LaterStackRow({
  itemKey,
  group,
  tasks,
  open,
  showAll,
  selectionMode,
  onToggle,
  onShowAll,
  onCompleteIds,
  onDeferIds,
  onSelectIds,
  onPressEdit,
  renderTask,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const liveIds = useMemo(() => tasks.filter(t => !t.completed).map(t => t.id), [tasks]);

  const handleToggle = useCallback(() => onToggle(itemKey), [onToggle, itemKey]);
  const handleComplete = useCallback(
    (_groupId: string, onlyIds?: string[]) => onCompleteIds(onlyIds ?? liveIds),
    [onCompleteIds, liveIds],
  );
  const handleDefer = useCallback(
    (_groupId: string, date: Date) => onDeferIds(liveIds, date),
    [onDeferIds, liveIds],
  );
  const handleSelect = useCallback(() => onSelectIds(liveIds), [onSelectIds, liveIds]);

  const shown = showAll ? tasks : tasks.slice(0, LATER_STACK_PREVIEW);
  const hidden = tasks.length - shown.length;

  return (
    <TaskGroupTray collapsed={!open}>
      <TaskGroupHeader
        group={group}
        allChildren={tasks}
        dueTodayOverride={tasks}
        tallyScope="all"
        expanded={open}
        selectionMode={selectionMode}
        onToggleCollapse={handleToggle}
        onComplete={handleComplete}
        onDefer={handleDefer}
        onSwipeSelect={handleSelect}
        onPressEdit={onPressEdit}
      />
      <TaskGroupBody expanded={open} hasChildren={tasks.length > 0}>
        {shown.map(task => (
          <React.Fragment key={task.id}>{renderTask(task)}</React.Fragment>
        ))}
        {hidden > 0 && (
          <TouchableOpacity
            onPress={() => onShowAll(itemKey)}
            activeOpacity={interaction.activeOpacity}
            style={styles.more}
            accessibilityRole="button"
            accessibilityLabel={`Show ${hidden} more tasks in ${group.title}`}
          >
            <Text style={styles.moreText}>Show {hidden} more</Text>
          </TouchableOpacity>
        )}
      </TaskGroupBody>
    </TaskGroupTray>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  more: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
  },
  moreText: {
    color: colors.accentText,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
});
