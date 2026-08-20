import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCurrentDayStart } from '../utils/dateUtils';
import { useShallow } from 'zustand/react/shallow';
import { TaskEditor } from '../components/TaskEditor';
import { TaskBreakdownSheet } from '../components/TaskBreakdownSheet';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PostponeCheckActions, type PostponeCheckAction } from '../components/PostponeCheckBanner';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor } from '../utils/visibilityUtils';
import type { DriftEntry } from '../utils/postpone';
import type { Task } from '../types';

/**
 * Noon on the logical today, matching what WhenPicker's Today chip writes — a
 * date parked at midday can't be dragged across a day boundary by a timezone
 * or a DST hour, which is what "do it today" must not do on the one screen
 * about dates being wrong.
 */
const noonToday = () => {
  const n = getCurrentDayStart();
  n.setHours(12, 0, 0, 0);
  return n;
};

/**
 * The tasks you keep moving instead of doing.
 *
 * Same shape and same reasoning as WaitingScreen: a drawer-only screen for
 * tasks that need a decision rather than a place in today's list. The counting
 * already existed — utils/postpone.ts has recorded every push since the
 * postpone check shipped — but it was only ever *readable* from inside the date
 * picker, at the moment you were already pushing the task again. A task you've
 * stopped opening is exactly the one that drifts hardest, so the one surface
 * that knew was the one you'd never reach.
 *
 * The four ways out are the picker's, rendered per row through the shared
 * PostponeCheckActions rather than re-listed here: a screen that offered a
 * different set of choices than the prompt would be a second answer to the same
 * question.
 *
 * Framing, deliberately: "needs a decision", never "you failed at these". Every
 * row is a task the user chose to keep, and a screen that mostly reads as an
 * accusation is one that gets opened once. That's also why there's no total
 * across the top, no streak of shame, and no sort that rewards the app for
 * finding more of them.
 */
export function DriftScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  // Selected as the raw, stable Task[] rather than s.driftingTasks()'s
  // DriftEntry[] — that method rebuilds a fresh {task, count, since} wrapper
  // per task on every call, which useShallow can never find equal to the
  // previous render's, so the store re-notified on every render and the
  // screen spun into "Maximum update depth exceeded" (#1626). The wrapper
  // objects are built once here instead, memoized on the task list itself.
  const driftingTaskList = useTaskStore(useShallow(s => s.driftingTaskList()));
  const entries = useMemo<DriftEntry[]>(
    () => driftingTaskList.map(task => ({ task, count: task.postponeCount, since: task.driftingSince })),
    [driftingTaskList],
  );
  const updateTask = useTaskStore(s => s.updateTask);
  const archiveTask = useTaskStore(s => s.archiveTask);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const threshold = useSettingsStore(s => s.postponeCheckThreshold);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [breakdownId, setBreakdownId] = useState<string | null>(null);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // Same fallback TaskItem makes: with a key, "Break it up…" is the AI sheet;
  // without one it's the editor, where the subtask field lives.
  const breakUp = (task: Task) => {
    haptics.tap();
    if (anthropicApiKey) setBreakdownId(task.id);
    else openEditor(task);
  };

  const actionsFor = (task: Task): { primary: PostponeCheckAction; secondary: PostponeCheckAction[] } => ({
    primary: {
      key: 'today',
      label: 'Do it today',
      // Dating it to today is what clears the count — postponeOutcome reads a
      // pull back to today as 'resolved' — so this needs no bookkeeping of its
      // own, exactly as the picker's Today chip needs none.
      onPress: () => {
        haptics.success();
        animateLayout();
        updateTask(task.id, { dueDate: noonToday().toISOString(), deferUntil: null });
      },
    },
    secondary: [
      { key: 'break', label: 'Break it up…', onPress: () => breakUp(task) },
      {
        key: 'drop',
        label: 'Drop it',
        onPress: () => {
          haptics.warning();
          Alert.alert(
            'Archive this task?',
            `"${displayTitleFor(task)}" moves to Archived. Nothing is deleted, and you can restore it from there whenever you like.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                // Not destructive styling, for the reason the picker's copy of
                // this gives: archiving keeps the task.
                text: 'Archive',
                onPress: () => { animateLayout(); archiveTask(task.id); },
              },
            ],
          );
        },
      },
      {
        key: 'mute',
        label: 'Stop asking',
        onPress: () => {
          haptics.tap();
          animateLayout();
          updateTask(task.id, { postponeMuted: true });
        },
      },
    ],
  });

  const renderRow = ({ item }: { item: DriftEntry }) => {
    const { primary, secondary } = actionsFor(item.task);
    return (
      <View style={styles.row}>
        <TouchableOpacity
          activeOpacity={interaction.activeOpacity}
          onPress={() => openEditor(item.task)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${displayTitleFor(item.task)}`}
        >
          <Text style={styles.taskTitle} numberOfLines={2}>{displayTitleFor(item.task)}</Text>
          <Text style={styles.taskMeta}>
            {/* The count first because it's the fact the user has lost track
                of; the date is context for it, and absent on a run that
                started before the stamp shipped. */}
            Moved {item.count} times
            {item.since ? ` · first put off ${format(new Date(item.since), 'MMM d')}` : ''}
          </Text>
        </TouchableOpacity>
        <PostponeCheckActions primary={primary} secondary={secondary} />
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Drift"
        subtitle={
          entries.length === 0
            ? undefined
            : `${entries.length} ${entries.length === 1 ? 'task needs' : 'tasks need'} a decision`
        }
      />

      <FlatList
        data={entries}
        keyExtractor={item => item.task.id}
        contentContainerStyle={entries.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={renderRow}
        ListEmptyComponent={
          <EmptyState
            icon="trending-down-outline"
            title="Nothing is drifting"
            // Says why it can be empty on an install that has been rescheduling
            // things for years: the counting only starts when it starts, and a
            // blank screen otherwise reads as broken rather than as clean.
            subtitle={`Tasks you move to a later day ${threshold} or more times show up here. Counting starts from when a task is first moved, so this stays empty for a while on an existing list.`}
            bottomOffset={tabBarHeight}
          />
        }
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
      {breakdownId && (
        <TaskBreakdownSheet
          visible
          taskId={breakdownId}
          onClose={() => setBreakdownId(null)}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    // Top padding because the rows carry their own action strip and butt
    // straight up under the header's subtitle otherwise — WaitingScreen gets
    // this seam for free from its first section header, and this list has none.
    listContent: { paddingTop: spacing.sm, paddingBottom: 40 },
    emptyContainer: { flexGrow: 1 },
    row: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      gap: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    taskTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    taskMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  });
