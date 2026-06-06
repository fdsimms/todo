import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { BulkActionBar } from '../components/BulkActionBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';
import { getVisibleAt } from '../utils/visibilityUtils';
import { formatGroupHeader } from '../utils/dateUtils';
import type { Task } from '../types';

export function LaterScreen() {
  const insets = useSafeAreaInsets();
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const enterSelection = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
    setExpandedTaskId(null);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
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
        contentContainerStyle={sections.length === 0 ? undefined : styles.listContent}
        renderItem={({ item }) => {
          const subs = allTasks.filter(t => t.parentId === item.id);
          return (
            <TaskItem
              task={item}
              onPress={() => setExpandedTaskId(prev => prev === item.id ? null : item.id)}
              expanded={expandedTaskId === item.id}
              onEdit={() => openEditor(item)}
              subtaskCount={subs.length}
              subtaskDoneCount={subs.filter(t => t.completed).length}
              subtasks={subs}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onLongPress={() => enterSelection(item.id)}
              onSelect={() => toggleSelection(item.id)}
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

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={deferredTasks.length}
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={() => { bulkDeleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => setSelectedIds(new Set(deferredTasks.map(t => t.id)))}
          onDeselectAll={() => setSelectedIds(new Set())}
          onCancel={exitSelection}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  listContent: { paddingTop: spacing.xs, paddingBottom: 40 },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
