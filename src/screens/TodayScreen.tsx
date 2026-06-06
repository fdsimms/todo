import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useTaskStore } from '../store/useTaskStore';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { TagFilterBar } from '../components/TagFilterBar';
import { colors, spacing, font, radius } from '../theme';
import type { Task } from '../types';

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const visibleTasks = useTaskStore(s => s.visibleTasks());
  const allTags = useTaskStore(s => s.allTags());

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [groupByTag, setGroupByTag] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const initialize = useTaskStore(s => s.initialize);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initialize();
    setRefreshing(false);
  }, [initialize]);

  const filtered = selectedTag
    ? visibleTasks.filter(t => t.tags.includes(selectedTag))
    : visibleTasks;

  const openEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setEditorVisible(true);
  };

  const today = format(new Date(), 'EEEE, MMMM d');

  const renderSections = () => {
    if (!groupByTag) {
      return filtered;
    }

    const byTag: Record<string, Task[]> = {};
    const untagged: Task[] = [];

    filtered.forEach(task => {
      if (task.tags.length === 0) {
        untagged.push(task);
      } else {
        const primaryTag = task.tags[0];
        if (!byTag[primaryTag]) byTag[primaryTag] = [];
        byTag[primaryTag].push(task);
      }
    });

    const result: Array<{ type: 'header'; label: string } | { type: 'task'; task: Task }> = [];

    Object.entries(byTag).forEach(([tag, tasks]) => {
      result.push({ type: 'header', label: tag });
      tasks.forEach(task => result.push({ type: 'task', task }));
    });

    if (untagged.length > 0) {
      result.push({ type: 'header', label: 'Other' });
      untagged.forEach(task => result.push({ type: 'task', task }));
    }

    return result;
  };

  const data = groupByTag
    ? (renderSections() as Array<{ type: 'header'; label: string } | { type: 'task'; task: Task }>)
    : filtered.map(task => ({ type: 'task' as const, task }));

  const renderItem = ({ item }: { item: { type: string; task?: Task; label?: string } }) => {
    if (item.type === 'header') {
      return <SectionHeader label={item.label!} />;
    }
    return (
      <TaskItem
        task={item.task!}
        onPress={() => openEditor(item.task)}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.dateLabel}>{today}</Text>
          <Text style={styles.title}>Today</Text>
        </View>
        <TouchableOpacity
          style={[styles.groupToggle, groupByTag && styles.groupToggleActive]}
          onPress={() => setGroupByTag(g => !g)}
        >
          <Ionicons name="list" size={16} color={groupByTag ? colors.text : colors.textSecondary} />
          <Text style={[styles.groupToggleText, groupByTag && { color: colors.text }]}>Group</Text>
        </TouchableOpacity>
      </View>

      <TagFilterBar tags={allTags} selected={selectedTag} onSelect={setSelectedTag} />

      <FlatList
        data={data}
        keyExtractor={(item, i) =>
          item.type === 'header' ? `h-${item.label}-${i}` : item.task!.id
        }
        renderItem={renderItem}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textSecondary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle" size={48} color={colors.bgQuaternary} />
            <Text style={styles.emptyText}>All clear</Text>
            <Text style={styles.emptySubtext}>
              {selectedTag ? `No visible tasks tagged "${selectedTag}"` : 'Nothing to do right now'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => openEditor()}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={colors.text} />
      </TouchableOpacity>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  dateLabel: {
    color: colors.textTertiary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  title: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  groupToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgSecondary,
  },
  groupToggleActive: {
    backgroundColor: colors.bgTertiary,
  },
  groupToggleText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyContainer: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.sm,
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
    paddingHorizontal: spacing.xl,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
