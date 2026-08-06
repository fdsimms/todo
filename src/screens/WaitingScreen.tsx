import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

// Where a task lives while it's waiting on another one (see Task.blockedById).
// A blocked task is absent from Today, Later, Unscheduled and Inbox alike — it
// has no date to place it on and isn't actionable yet — so it needs somewhere
// to be seen and managed. Same shape and same reasoning as ArchivedScreen: a
// drawer-only screen for tasks deliberately held out of the daily lists.
//
// Grouped by blocker rather than listed flat: the useful question here is
// "what's queued behind this?", and a run of tasks under one heading answers it
// in a way a sorted list of individual waiters doesn't.
export function WaitingScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const waitingTasks = useTaskStore(useShallow(s => s.waitingTasks()));
  const tasks = useTaskStore(s => s.tasks);
  const updateTask = useTaskStore(s => s.updateTask);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // waitingTasks already sorts by blockedById, so equal keys arrive adjacent
  // and this only has to break the runs apart.
  const sections = useMemo(() => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const grouped = new Map<string, { blockerId: string; blocker: Task | undefined; data: Task[] }>();
    for (const task of waitingTasks) {
      const blockerId = task.blockedById!;
      if (!grouped.has(blockerId)) {
        grouped.set(blockerId, { blockerId, blocker: byId.get(blockerId), data: [] });
      }
      grouped.get(blockerId)!.data.push(task);
    }
    return Array.from(grouped.values());
  }, [waitingTasks, tasks]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Waiting"
        subtitle={`${waitingTasks.length} ${waitingTasks.length === 1 ? 'task' : 'tasks'} blocked`}
      />

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
        renderSectionHeader={({ section }) => (
          <TouchableOpacity
            style={styles.sectionHeader}
            activeOpacity={interaction.activeOpacity}
            disabled={!section.blocker}
            onPress={() => section.blocker && openEditor(section.blocker)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${section.blocker?.title ?? 'blocking task'}`}
          >
            <Text style={styles.sectionTitle} numberOfLines={1}>
              After {section.blocker?.title ?? 'another task'}
            </Text>
          </TouchableOpacity>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={interaction.activeOpacity}
            onPress={() => openEditor(item)}
          >
            <Ionicons name="hourglass-outline" size={18} color={colors.textTertiary} />
            <View style={styles.rowContent}>
              <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
            </View>
            <TouchableOpacity
              style={styles.releaseButton}
              onPress={() => {
                haptics.tap();
                animateLayout();
                updateTask(item.id, { blockedById: null });
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Stop ${item.title} waiting`}
            >
              <Ionicons name="play-outline" size={iconSize.sm} color={colors.accent} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="hourglass-outline"
            title="Nothing is waiting"
            subtitle="Set a task to wait on another one from the task editor, and it stays out of your lists until that task is done."
            bottomOffset={tabBarHeight}
          />
        }
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  rowContent: { flex: 1 },
  taskTitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    fontWeight: '400',
  },
  releaseButton: {
    padding: 4,
    flexShrink: 0,
  },
});
