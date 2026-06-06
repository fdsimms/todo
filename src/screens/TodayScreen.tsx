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
import type { Task, SortOption, Priority, Effort } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { SettingsScreen } from './SettingsScreen';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { TagFilterBar } from '../components/TagFilterBar';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { colors, spacing, font, radius } from '../theme';

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const visibleTasks = useTaskStore(s => s.visibleTasks());
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(s => s.allTags());
  const initialize = useTaskStore(s => s.initialize);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [groupByTag, setGroupByTag] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  // Sort & filter state
  const [sort, setSort] = useState<SortOption>('default');
  const [filterPriorities, setFilterPriorities] = useState<Priority[]>([]);
  const [filterEfforts, setFilterEfforts] = useState<Effort[]>([]);

  const activeFilterCount =
    (sort !== 'default' ? 1 : 0) + filterPriorities.length + filterEfforts.length;

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initialize();
    setRefreshing(false);
  }, [initialize]);

  const openEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setEditorVisible(true);
  };

  const applyFiltersAndSort = (tasks: Task[]): Task[] => {
    let result = tasks;
    if (selectedTag) result = result.filter(t => t.tags.includes(selectedTag));
    if (filterPriorities.length > 0) result = result.filter(t => filterPriorities.includes(t.priority));
    if (filterEfforts.length > 0) result = result.filter(t => filterEfforts.includes(t.effort));

    switch (sort) {
      case 'priority': return [...result].sort((a, b) => b.priority - a.priority);
      case 'effort-asc': return [...result].sort((a, b) => (a.effort || 99) - (b.effort || 99));
      case 'effort-desc': return [...result].sort((a, b) => b.effort - a.effort);
      case 'due-date': return [...result].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
      case 'streak': return [...result].sort((a, b) => b.streakCount - a.streakCount);
      default: return result;
    }
  };

  const filtered = applyFiltersAndSort(visibleTasks);

  type ListItem =
    | { type: 'header'; label: string }
    | { type: 'task'; task: Task };

  const buildGroupedData = (): ListItem[] => {
    const byTag: Record<string, Task[]> = {};
    const untagged: Task[] = [];

    filtered.forEach(task => {
      if (task.tags.length === 0) {
        untagged.push(task);
      } else {
        const key = task.tags[0];
        if (!byTag[key]) byTag[key] = [];
        byTag[key].push(task);
      }
    });

    const items: ListItem[] = [];
    Object.entries(byTag).forEach(([tag, tasks]) => {
      items.push({ type: 'header', label: tag });
      tasks.forEach(task => items.push({ type: 'task', task }));
    });
    if (untagged.length > 0) {
      items.push({ type: 'header', label: 'Other' });
      untagged.forEach(task => items.push({ type: 'task', task }));
    }
    return items;
  };

  const data: ListItem[] = groupByTag
    ? buildGroupedData()
    : filtered.map(task => ({ type: 'task' as const, task }));

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    const subs = allTasks.filter(t => t.parentId === item.task.id);
    return (
      <TaskItem
        task={item.task}
        onPress={() => openEditor(item.task)}
        subtaskCount={subs.length}
        subtaskDoneCount={subs.filter(t => t.completed).length}
      />
    );
  };

  const today = format(new Date(), 'EEEE, MMMM d');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.dateLabel}>{today}</Text>
          <Text style={styles.title}>Today</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={[styles.iconBtn, groupByTag && styles.iconBtnActive]}
            onPress={() => setGroupByTag(g => !g)}
          >
            <Ionicons name="list" size={18} color={groupByTag ? colors.text : colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, activeFilterCount > 0 && styles.iconBtnAccent]}
            onPress={() => setFilterVisible(true)}
          >
            <Ionicons
              name="options"
              size={18}
              color={activeFilterCount > 0 ? colors.text : colors.textSecondary}
            />
            {activeFilterCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setSettingsVisible(true)}>
            <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <TagFilterBar tags={allTags} selected={selectedTag} onSelect={setSelectedTag} />

      <FlatList
        data={data}
        keyExtractor={(item, i) =>
          item.type === 'header' ? `h-${item.label}-${i}` : item.task.id
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
            <Ionicons name="checkmark-circle" size={52} color={colors.bgQuaternary} />
            <Text style={styles.emptyText}>All clear</Text>
            <Text style={styles.emptySubtext}>
              {activeFilterCount > 0
                ? 'No tasks match these filters'
                : selectedTag
                  ? `No visible tasks tagged "${selectedTag}"`
                  : 'Nothing to do right now'}
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

      <TaskEditor visible={editorVisible} task={editingTask} onClose={() => setEditorVisible(false)} />

      <SortFilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        sort={sort}
        onSortChange={setSort}
        priorities={filterPriorities}
        onPrioritiesChange={setFilterPriorities}
        efforts={filterEfforts}
        onEffortsChange={setFilterEfforts}
      />

      <SettingsScreen visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.sm,
  },
  dateLabel: { color: colors.textTertiary, fontSize: font.sm, fontWeight: '500' },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
  headerButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: colors.bgTertiary },
  iconBtnAccent: { backgroundColor: colors.accent },
  badge: {
    position: 'absolute', top: -3, right: -3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.text, fontSize: 9, fontWeight: '700' },
  sectionHeader: {
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: font.lg, fontWeight: '600', marginTop: spacing.sm },
  emptySubtext: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center', paddingHorizontal: spacing.xl },
  fab: {
    position: 'absolute', right: spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
});
