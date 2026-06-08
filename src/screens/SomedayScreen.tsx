import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { BulkActionBar } from '../components/BulkActionBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';
import type { Task } from '../types';

export function SomedayScreen() {
  const insets = useSafeAreaInsets();
  const allSomedayTasks = useTaskStore(useShallow(s => s.somedayTasks()));
  const allProjects = useProjectStore(useShallow(s => s.projects));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const initialize = useTaskStore(s => s.initialize);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialTitle, setEditorInitialTitle] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initialize();
    setRefreshing(false);
  }, [initialize]);

  const openEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setEditorInitialTitle('');
    setEditorVisible(true);
  };

  const handleQuickAddOpenFull = (title: string) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialTitle(title);
    setEditorVisible(true);
  };

  const somedayTasks = selectedProject
    ? allSomedayTasks.filter(t => t.projectId === selectedProject)
    : allSomedayTasks;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Someday</Text>
        </View>
        <Text style={styles.subtitle}>{allSomedayTasks.length} parked</Text>
      </View>

      {allProjects.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.projectFilterBar}
        >
          <TouchableOpacity
            style={[styles.projectChip, selectedProject === null && styles.projectChipActive]}
            onPress={() => setSelectedProject(null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.projectChipText, selectedProject === null && styles.projectChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {allProjects.map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.projectChip, selectedProject === p.id && { backgroundColor: p.color }]}
              onPress={() => setSelectedProject(prev => prev === p.id ? null : p.id)}
              activeOpacity={0.7}
            >
              {selectedProject !== p.id && <View style={[styles.projectChipDot, { backgroundColor: p.color }]} />}
              <Text style={[styles.projectChipText, selectedProject === p.id && styles.projectChipTextActive]}>
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <DraggableFlatList
        data={somedayTasks}
        keyExtractor={item => item.id}
        onDragEnd={({ data: reordered }) => reorderTasks(reordered.map(t => t.id))}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item, drag, isActive }: RenderItemParams<Task>) => {
          const subs = allTasks.filter(t => t.parentId === item.id);
          return (
            <ScaleDecorator>
              <TaskItem
                task={item}
                onPress={() => {
                  if (expandedTaskId !== null && expandedTaskId !== item.id) {
                    setExpandedTaskId(null);
                    return;
                  }
                  setExpandedTaskId(prev => prev === item.id ? null : item.id);
                }}
                expanded={expandedTaskId === item.id}
                onEdit={() => openEditor(item)}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                drag={selectionMode ? undefined : drag}
                isActive={isActive}
                showDragHandle={!selectionMode}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                onLongPress={() => enterSelection(item.id)}
                onSelect={() => toggleSelection(item.id)}
                spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id}
              />
            </ScaleDecorator>
          );
        }}
        contentContainerStyle={somedayTasks.length === 0 ? styles.emptyContainer : styles.listContent}
        ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
        onScrollBeginDrag={() => setExpandedTaskId(null)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textSecondary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="moon" size={52} color={colors.bgQuaternary} />
            <Text style={styles.emptyText}>Nothing parked here</Text>
            <Text style={styles.emptySubtext}>
              Add tasks you want to do someday but aren't committing to yet
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => setQuickAddVisible(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={colors.text} />
      </TouchableOpacity>

      <QuickAddModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={handleQuickAddOpenFull}
        initialSomeday
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialSomeday={!editingTask}
        initialTitle={editorInitialTitle}
        onClose={() => setEditorVisible(false)}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={somedayTasks.length}
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={() => { bulkDeleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => setSelectedIds(new Set(somedayTasks.map(t => t.id)))}
          onDeselectAll={() => setSelectedIds(new Set())}
          onCancel={exitSelection}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.sm,
  },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.textTertiary, fontSize: font.sm, paddingBottom: 4 },
  listContent: { paddingTop: spacing.xs, paddingBottom: 20 },
  listFooter: { height: 120 },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: font.lg, fontWeight: '600' },
  emptySubtext: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center', paddingHorizontal: spacing.xl },
  fab: {
    position: 'absolute', right: spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  projectFilterBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.sm,
  },
  projectChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  projectChipActive: { backgroundColor: colors.accent },
  projectChipDot: { width: 6, height: 6, borderRadius: 3 },
  projectChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  projectChipTextActive: { color: colors.text, fontWeight: '700', letterSpacing: 0.1 },
});
