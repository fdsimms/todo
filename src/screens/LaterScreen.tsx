import React, { useState } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { colors, spacing, font } from '../theme';
import { getVisibleAt } from '../utils/visibilityUtils';
import { formatGroupHeader } from '../utils/dateUtils';
import type { Task } from '../types';

export function LaterScreen() {
  const insets = useSafeAreaInsets();
  const deferredTasks = useTaskStore(s => s.deferredTasks());
  const allTasks = useTaskStore(s => s.tasks);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // Group by the date they'll become visible
  const grouped = new Map<string, Task[]>();
  [...deferredTasks]
    .sort((a, b) => getVisibleAt(a).getTime() - getVisibleAt(b).getTime())
    .forEach(task => {
      const key = formatGroupHeader(getVisibleAt(task).toISOString());
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    });

  const sections = Array.from(grouped.entries()).map(([title, data]) => ({
    title,
    data,
  }));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Later</Text>
        <Text style={styles.subtitle}>{deferredTasks.length} waiting</Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const subs = allTasks.filter(t => t.parentId === item.id);
          return (
            <TaskItem
              task={item}
              onPress={() => openEditor(item)}
              subtaskCount={subs.length}
              subtaskDoneCount={subs.filter(t => t.completed).length}
            />
          );
        }}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="moon" size={48} color={colors.bgQuaternary} />
            <Text style={styles.emptyText}>Nothing deferred</Text>
            <Text style={styles.emptySubtext}>
              Swipe right on a task or set a "Show after" time to stash things here
            </Text>
          </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: font.sm,
    marginTop: 2,
  },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: font.lg,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
