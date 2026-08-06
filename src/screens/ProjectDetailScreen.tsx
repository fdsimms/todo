import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { ProjectEditor } from '../components/ProjectEditor';
import { BulkActionBar } from '../components/BulkActionBar';
import { QuickAddModal } from '../components/QuickAddModal';
import { EmptyState } from '../components/EmptyState';
import { FabMenu, type FabMenuItem } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task, Project } from '../types';
import { SheetHeaderButton } from '../components/SheetHeaderButton';

type RootStackParamList = {
  ProjectDetail: { projectId: string };
};

export function ProjectDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ProjectDetail'>>();
  const { projectId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const projects = useProjectStore(useShallow(s => s.projects));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const addCategory = useTaskStore(s => s.addCategory);
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const justCreatedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
    painting,
    paintProps,
  } = useTaskSelection(allTasks);
  // This screen is a RootStack card, not a tab screen — it covers the tab bar
  // entirely, so the bulk bar sits above the home indicator, not above a tab
  // bar. (Asking for useBottomTabBarHeight() here throws outright.)
  const selectionListPadding = selectionMode ? insets.bottom + spacing.sm + bulkBarHeight + spacing.sm : undefined;
  // Every row's scrim shares this one animation, so the dim lands as a
  // single motion — see SpotlightOverlay.
  const spotlightProgress = useSpotlightProgress(expandedTaskId !== null && !selectionMode);

  const project = projects.find(p => p.id === projectId) ?? null;
  const projectTasks = project
    ? allTasks.filter(t => t.projectId === project.id && t.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  const incompleteProjectTasks = projectTasks.filter(t => !t.completed);
  const completedProjectTasks = projectTasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  // What "Select all" covers, and what the bar counts against to decide it has
  // everything: the rows actually on screen. Completed tasks are collapsed
  // behind a toggle, and counting hidden rows would leave the bar stuck
  // offering "Select all" after the user already had.
  const selectableTasks = showCompleted ? projectTasks : incompleteProjectTasks;

  const onClose = () => {
    if (selectionMode) exitSelection();
    navigation.goBack();
  };

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const listTouchStart = React.useRef<{ x: number; y: number } | null>(null);
  const handleListTouchStart = (e: GestureResponderEvent) => {
    const touch = e.nativeEvent.touches[0];
    listTouchStart.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
  };
  const handleListTouchEnd = (e: GestureResponderEvent) => {
    const start = listTouchStart.current;
    const touch = e.nativeEvent.changedTouches[0];
    const moved = start && touch ? Math.hypot(touch.pageX - start.x, touch.pageY - start.y) : 0;
    if (moved < interaction.tapMoveThreshold) setExpandedTaskId(null);
  };

  // Bottom-up: "New task" ends up closest to the button.
  const addMenuItems: FabMenuItem[] = [
    { key: 'existing', label: 'Add existing task', icon: 'albums-outline' },
    { key: 'new', label: 'New task', icon: 'checkmark-circle' },
  ];

  const handleAddMenuSelect = (key: string) => {
    if (key === 'new') {
      setQuickAddVisible(true);
      return;
    }
    setExistingSearch('');
    setShowExistingPicker(true);
  };

  // Quick add doesn't know about projects, so the task lands here right after
  // it's created — or resumed from the archive, which is just as much an "add"
  // from this screen. "More details" carries the project into the editor instead.
  const attachToProject = (task: Task) => {
    if (project) addExistingToProject(task.id, project.id);
    // Same brief highlight Today gives a freshly added row — the list is
    // sorted by sortOrder, so a new task doesn't necessarily land at the end.
    if (justCreatedTimeoutRef.current) clearTimeout(justCreatedTimeoutRef.current);
    setJustCreatedId(task.id);
    justCreatedTimeoutRef.current = setTimeout(() => setJustCreatedId(null), 1200);
  };

  React.useEffect(() => () => {
    if (justCreatedTimeoutRef.current) clearTimeout(justCreatedTimeoutRef.current);
  }, []);

  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialDraft({ ...draft, projectId: project?.id ?? null });
    setEditorVisible(true);
  };

  const eligibleForAdd = useMemo(() => {
    if (!project) return [];
    const q = existingSearch.trim().toLowerCase();
    return allTasks.filter(t =>
      !t.parentId &&
      !t.projectId &&
      !t.completed &&
      (q === '' || t.title.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [allTasks, existingSearch, project]);

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.detailTitleText} numberOfLines={1}>{project?.title}</Text>
          <TouchableOpacity
            onPress={() => project && setEditingProject(project)}
            accessibilityRole="button"
            accessibilityLabel="Edit project"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View
          style={{ flex: 1 }}
          onTouchStart={expandedTaskId !== null ? handleListTouchStart : undefined}
          onTouchEnd={expandedTaskId !== null ? handleListTouchEnd : undefined}
        >
        <PaintSelectionProvider {...paintProps}>
          <FlatList
            scrollEnabled={!painting}
            data={incompleteProjectTasks}
            keyExtractor={t => t.id}
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[{ flexGrow: 1 }, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]}
            renderItem={({ item }) => {
              const subs = allTasks.filter(t => t.parentId === item.id);
              return (
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
                  spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id && !selectionMode}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onSelect={() => toggleSelection(item.id)}
                  onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(item.id); }}
                  showCategory
                  showGroup
                  justCreated={item.id === justCreatedId}
                />
              );
            }}
            ListEmptyComponent={
              completedProjectTasks.length === 0 ? (
                <EmptyState
                  icon="briefcase-outline"
                  title="No tasks yet"
                  subtitle="Add a new task, or pull in one you've already written down"
                  actionLabel="New task"
                  onAction={() => setQuickAddVisible(true)}
                />
              ) : null
            }
            ListFooterComponent={
              <View style={styles.detailFooter}>
                {completedProjectTasks.length > 0 && (
                  <View style={styles.completedSection}>
                    <TouchableOpacity
                      style={styles.completedToggle}
                      onPress={() => { animateLayout(); setShowCompleted(v => !v); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${showCompleted ? 'Hide' : 'Show'} ${completedProjectTasks.length} completed tasks`}
                    >
                      <Ionicons name="checkmark-circle-outline" size={13} color={colors.textTertiary} />
                      <Text style={styles.completedToggleText}>
                        {showCompleted ? 'Hide' : 'Show'} {completedProjectTasks.length} completed
                      </Text>
                      <Ionicons name={showCompleted ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
                    </TouchableOpacity>
                    {showCompleted && completedProjectTasks.map(task => {
                      const subs = allTasks.filter(t => t.parentId === task.id);
                      return (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onPress={() => {
                            if (expandedTaskId !== null && expandedTaskId !== task.id) {
                              setExpandedTaskId(null);
                              return;
                            }
                            setExpandedTaskId(prev => prev === task.id ? null : task.id);
                          }}
                          expanded={expandedTaskId === task.id}
                          onEdit={() => openEditor(task)}
                          subtaskCount={subs.length}
                          subtaskDoneCount={subs.filter(t => t.completed).length}
                          subtasks={subs}
                          spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
                          selectionMode={selectionMode}
                          selected={selectedIds.has(task.id)}
                          onSelect={() => toggleSelection(task.id)}
                          onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(task.id); }}
                          showCategory
                          showGroup
                        />
                      );
                    })}
                  </View>
                )}
              </View>
            }
          />
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          // No onGroup: stacks are a Today/Later concept, and BulkActionBar
          // hides the action when the prop is absent.
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={selectableTasks.length}
            existingTags={allTags}
            existingCategories={allCategories}
            onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddCategory={addCategory}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onSelectAll={() => selectAll(selectableTasks.map(t => t.id))}
            onDeselectAll={deselectAll}
            onCancel={exitSelection}
            bottomInset={insets.bottom}
            onHeightChange={setBulkBarHeight}
          />
        )}

        {/* Add-existing-task picker — nested inside this screen's own tree
            (not a sibling top-level Modal), same nested-modal-stacking risk as
            the old Projects detail Modal. */}
        <Modal
          visible={showExistingPicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowExistingPicker(false)}
        >
          <View style={[styles.pickerRoot, { paddingTop: insets.top + spacing.md }]}>
            <View style={styles.detailHeader}>
              <SheetHeaderButton
                label="Cancel"
                role="cancel"
                onPress={() => setShowExistingPicker(false)}
                accessibilityLabel="Close"
              />
              <Text style={styles.detailTitleText}>Add Existing Task</Text>
              <View style={{ width: 48 }} />
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textTertiary} />
              <TextInput
                autoFocus
                style={styles.searchInput}
                value={existingSearch}
                onChangeText={setExistingSearch}
                placeholder="Search tasks"
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            <FlatList
              data={eligibleForAdd}
              keyExtractor={t => t.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    if (project) addExistingToProject(item.id, project.id);
                    haptics.tap();
                  }}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={styles.pickerRowText} numberOfLines={1}>{item.title}</Text>
                  <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <EmptyState icon="search" title="No matching tasks" subtitle="Tasks already in a project, or completed, won't show here" />
              }
            />
          </View>
        </Modal>

        <FabMenu
          items={addMenuItems}
          onSelect={handleAddMenuSelect}
          bottom={spacing.xl}
          size={48}
          accessibilityLabel="Add task to project"
        />

        <QuickAddModal
          visible={quickAddVisible}
          onClose={() => setQuickAddVisible(false)}
          onOpenFull={handleQuickAddOpenFull}
          // Project tasks are picked off over time rather than scheduled for
          // today, so the quick add opens with no due date.
          context="unscheduled"
          onCreated={attachToProject}
          onResumed={attachToProject}
        />

        <ProjectEditor
          visible={editingProject !== null}
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />

        <TaskEditor
          visible={editorVisible}
          task={editingTask}
          initialDraft={editorInitialDraft}
          onClose={() => {
            setEditorVisible(false);
            setEditorInitialDraft(null);
            setExpandedTaskId(null);
          }}
        />
      </View>
    </SpotlightProvider>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pickerRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  detailTitleText: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  detailFooter: {
    paddingTop: spacing.sm,
    // Clears the floating add button so the last row is never under it.
    paddingBottom: spacing.xl * 2 + spacing.lg,
  },
  completedSection: {
    paddingBottom: spacing.sm,
  },
  completedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  completedToggleText: {
    color: colors.textTertiary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  pickerRowText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },
});
