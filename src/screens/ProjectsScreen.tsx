import React, { useState, useMemo, useCallback } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectProgress, isProjectPastWindow } from '../store/useProjectStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { ProjectEditor } from '../components/ProjectEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { ReorderableList } from '../components/ReorderableList';
import { ProgressBar } from '../components/ProgressBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatDueDate } from '../utils/dateUtils';
import { TITLE_MAX_LENGTH } from '../types';
import type { Task, Project } from '../types';

function dateRangeLabel(project: Project): string | null {
  if (project.targetStartDate && project.targetEndDate) {
    return `${formatDueDate(project.targetStartDate)} – ${formatDueDate(project.targetEndDate)}`;
  }
  if (project.targetEndDate) return `By ${formatDueDate(project.targetEndDate)}`;
  if (project.targetStartDate) return `From ${formatDueDate(project.targetStartDate)}`;
  return null;
}

export function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const projects = useProjectStore(useShallow(s => s.projects));
  const createProject = useProjectStore(s => s.createProject);
  const reorderProjects = useProjectStore(s => s.reorderProjects);
  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addTask = useTaskStore(s => s.addTask);
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);

  const [showArchived, setShowArchived] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      return () => {
        setExpandedTaskId(null);
        setShowCompleted(false);
      };
    }, [])
  );

  const visibleProjects = useMemo(
    () => projects.filter(p => p.archived === showArchived),
    [projects, showArchived]
  );

  const [showCompleted, setShowCompleted] = useState(false);

  const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) ?? null : null;
  const projectTasks = selectedProject
    ? allTasks.filter(t => t.projectId === selectedProject.id && t.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  const incompleteProjectTasks = projectTasks.filter(t => !t.completed);
  const completedProjectTasks = projectTasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  const handleStartAdding = () => {
    animateLayout();
    setAddingProject(true);
  };

  const handleAddProject = () => {
    const trimmed = newProjectTitle.trim();
    if (trimmed) {
      haptics.success();
      animateLayout();
      createProject(trimmed, null, null);
    }
    setNewProjectTitle('');
    setAddingProject(false);
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

  const eligibleForAdd = useMemo(() => {
    if (!selectedProject) return [];
    const q = existingSearch.trim().toLowerCase();
    return allTasks.filter(t =>
      !t.parentId &&
      !t.projectId &&
      !t.completed &&
      (q === '' || t.title.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [allTasks, existingSearch, selectedProject]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Projects"
        actions={[
          { icon: 'add', onPress: handleStartAdding, accessibilityLabel: 'Add project' },
          {
            icon: 'archive-outline',
            onPress: () => setShowArchived(v => !v),
            active: showArchived,
            accessibilityLabel: showArchived ? 'Show active projects' : 'Show archived projects',
          },
        ]}
      />

      {addingProject && (
        <View style={styles.addRow}>
          <TextInput
            autoFocus
            style={styles.addInput}
            value={newProjectTitle}
            onChangeText={setNewProjectTitle}
            placeholder="Project name"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={handleAddProject}
            onBlur={() => { if (!newProjectTitle.trim()) setAddingProject(false); }}
          />
          <TouchableOpacity onPress={handleAddProject} style={styles.addConfirm} activeOpacity={interaction.activeOpacity} accessibilityRole="button" accessibilityLabel="Confirm new project">
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewProjectTitle(''); setAddingProject(false); }}
            style={styles.addCancel}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {visibleProjects.length === 0 && !addingProject ? (
        <EmptyState
          icon={showArchived ? 'archive-outline' : 'briefcase-outline'}
          title={showArchived ? 'No archived projects' : 'No projects yet'}
          subtitle={showArchived ? 'Projects you archive will show up here' : 'Tap + to start a themed collection, like a summer bucket list'}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={visibleProjects}
          keyExtractor={p => p.id}
          contentContainerStyle={styles.list}
          placeholderStyle={styles.dropSlot}
          onHoverChange={haptics.tap}
          onReorder={reordered => reorderProjects(reordered.map(p => p.id))}
          renderItem={({ item: project, drag, isActive }) => {
            const progress = projectProgress(project.id, allTasks);
            const pastWindow = isProjectPastWindow(project, progress);
            const rangeLabel = dateRangeLabel(project);
            return (
              <TouchableOpacity
                style={[styles.projectRow, isActive && styles.projectRowActive]}
                onPress={() => setSelectedProjectId(project.id)}
                onLongPress={drag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${project.title}, ${progress.done} of ${progress.total} done`}
                accessibilityHint="Double tap to view tasks in this project. Long press to reorder."
              >
                <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                <View style={styles.projectInfo}>
                  <View style={styles.projectTitleRow}>
                    <Text style={styles.projectName} numberOfLines={1}>{project.title}</Text>
                    <TouchableOpacity
                      onPress={() => setEditingProject(project)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${project.title}`}
                    >
                      <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                  {project.category && (
                    <View style={styles.categoryRow}>
                      <Ionicons name="folder-outline" size={12} color={colors.textTertiary} />
                      <Text style={styles.categoryLabel} numberOfLines={1}>
                        {categoryLabel(project.category, categories)}
                      </Text>
                    </View>
                  )}
                  {progress.total > 0 && (
                    <View style={styles.progressRow}>
                      <ProgressBar progress={progress.done / progress.total} />
                      <Text style={styles.progressText}>{progress.done}/{progress.total}</Text>
                    </View>
                  )}
                  {rangeLabel && (
                    <Text style={[styles.rangeText, pastWindow && { color: colors.orange }]} numberOfLines={1}>
                      {pastWindow ? `Past window · ${rangeLabel}` : rangeLabel}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Project detail modal */}
      <Modal
        visible={selectedProject !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedProjectId(null)}
      >
        <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedProjectId(null)} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.detailTitleText} numberOfLines={1}>{selectedProject?.title}</Text>
            <TouchableOpacity
              onPress={() => selectedProject && setEditingProject(selectedProject)}
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
            <FlatList
              data={incompleteProjectTasks}
              keyExtractor={t => t.id}
              contentContainerStyle={{ flexGrow: 1 }}
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
                    spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id}
                  />
                );
              }}
              ListEmptyComponent={
                completedProjectTasks.length === 0 ? (
                  <EmptyState icon="briefcase-outline" title="No tasks yet" subtitle="Add tasks below to start tracking this project" />
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
                            spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id}
                          />
                        );
                      })}
                    </View>
                  )}
                  {addingTask ? (
                    <View style={styles.addRow}>
                      <TextInput
                        autoFocus
                        style={styles.addInput}
                        value={newTaskTitle}
                        onChangeText={setNewTaskTitle}
                        placeholder="New task title"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={TITLE_MAX_LENGTH}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          const t = newTaskTitle.trim();
                          if (t && selectedProject) addTask({ title: t, projectId: selectedProject.id });
                          setNewTaskTitle('');
                          haptics.tap();
                        }}
                        onBlur={() => {
                          const t = newTaskTitle.trim();
                          if (t && selectedProject) addTask({ title: t, projectId: selectedProject.id });
                          setNewTaskTitle('');
                          setAddingTask(false);
                        }}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.footerBtn} onPress={() => setAddingTask(true)} activeOpacity={interaction.activeOpacity}>
                      <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                      <Text style={styles.footerBtnText}>New task</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.footerBtn}
                    onPress={() => { setExistingSearch(''); setShowExistingPicker(true); }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                    <Text style={styles.footerBtnText}>Add existing task</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Add-existing-task picker */}
      <Modal
        visible={showExistingPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowExistingPicker(false)}
      >
        <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setShowExistingPicker(false)} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.headerBtnText}>Cancel</Text>
            </TouchableOpacity>
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
                  if (selectedProject) addExistingToProject(item.id, selectedProject.id);
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

      <ProjectEditor
        visible={editingProject !== null}
        project={editingProject}
        onClose={() => setEditingProject(null)}
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => {
          setEditorVisible(false);
          setExpandedTaskId(null);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
  },
  addInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
    paddingVertical: 0,
  },
  addConfirm: { padding: 4 },
  addCancel: { padding: 4 },
  list: {
    paddingTop: spacing.sm,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  projectRowActive: {
    backgroundColor: colors.bgTertiary,
  },
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  projectInfo: {
    flex: 1,
    gap: 6,
  },
  projectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  projectName: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  rangeText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  detailRoot: {
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
  headerBtnText: {
    color: colors.accent,
    fontSize: font.md,
  },
  detailFooter: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
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
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    paddingVertical: 10,
  },
  footerBtnText: {
    color: colors.accent,
    fontSize: font.md,
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
