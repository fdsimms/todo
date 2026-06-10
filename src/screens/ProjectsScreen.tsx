import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Project, Task } from '../types';

const PROJECT_COLORS = [
  '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2',
  '#5E5CE6', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68',
];

export function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const projects = useProjectStore(useShallow(s => s.projects));
  const addProject = useProjectStore(s => s.addProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const deleteProject = useProjectStore(s => s.deleteProject);
  const allTasks = useTaskStore(s => s.tasks);
  const tasksByProject = useTaskStore(s => s.tasksByProject);
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const [projectEditorVisible, setProjectEditorVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0]);
  const [projectDueDate, setProjectDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());

  const openNewProject = useCallback(() => {
    setEditingProject(null);
    setProjectName('');
    setProjectNotes('');
    setProjectColor(PROJECT_COLORS[0]);
    setProjectDueDate(null);
    setShowDatePicker(false);
    setProjectEditorVisible(true);
  }, []);

  const openEditProject = useCallback((project: Project) => {
    setEditingProject(project);
    setProjectName(project.name);
    setProjectNotes(project.notes);
    setProjectColor(project.color);
    setProjectDueDate(project.dueDate ? new Date(project.dueDate) : null);
    setShowDatePicker(false);
    setProjectEditorVisible(true);
  }, []);

  const saveProject = useCallback(() => {
    if (!projectName.trim()) return;
    const data = {
      name: projectName.trim(),
      notes: projectNotes,
      color: projectColor,
      dueDate: projectDueDate?.toISOString() ?? null,
      order: editingProject?.order ?? 0,
    };
    haptics.success();
    if (editingProject) {
      updateProject(editingProject.id, data);
      if (selectedProject?.id === editingProject.id) {
        setSelectedProject({ ...editingProject, ...data });
      }
    } else {
      animateLayout();
      addProject(data);
    }
    setProjectEditorVisible(false);
  }, [projectName, projectNotes, projectColor, projectDueDate, editingProject, addProject, updateProject, selectedProject]);

  const confirmDeleteProject = useCallback((project: Project) => {
    haptics.warning();
    Alert.alert(
      'Delete Project',
      `Delete "${project.name}"? Tasks in this project won't be deleted, just unassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteProject(project.id);
            if (selectedProject?.id === project.id) setSelectedProject(null);
          },
        },
      ]
    );
  }, [deleteProject, selectedProject]);

  const getProgress = useCallback((projectId: string) => {
    const rootTasks = allTasks.filter(t => t.projectId === projectId && !t.parentId);
    const done = rootTasks.filter(t => t.completed).length;
    return { done, total: rootTasks.length };
  }, [allTasks]);

  const detailTasks = selectedProject ? tasksByProject(selectedProject.id) : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Projects"
        actions={[{ icon: 'add', onPress: openNewProject }]}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon="folder-open"
          title="No projects yet"
          subtitle="Create a project to group related tasks"
          actionLabel="New Project"
          onAction={openNewProject}
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: project }) => {
            const { done, total } = getProgress(project.id);
            const progress = total > 0 ? done / total : 0;
            return (
              <TouchableOpacity
                style={styles.projectRow}
                onPress={() => setSelectedProject(project)}
                onLongPress={() => openEditProject(project)}
                activeOpacity={interaction.activeOpacity}
              >
                <View style={[styles.projectIcon, { backgroundColor: project.color + '22' }]}>
                  <Ionicons name="folder" size={20} color={project.color} />
                </View>
                <View style={styles.projectInfo}>
                  <View style={styles.projectNameRow}>
                    <Text style={styles.projectName}>{project.name}</Text>
                    {project.dueDate && (
                      <Text style={styles.projectDue}>
                        {format(new Date(project.dueDate), 'MMM d')}
                      </Text>
                    )}
                  </View>
                  <View style={styles.progressRow}>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.round(progress * 100)}%` as `${number}%`, backgroundColor: project.color },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressLabel}>{done}/{total}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => confirmDeleteProject(project)}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
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
        onRequestClose={() => setSelectedProject(null)}
      >
        {selectedProject && (
          <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedProject(null)}>
                <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.detailTitleBtn}
                onPress={() => openEditProject(selectedProject)}
                activeOpacity={interaction.activeOpacity}
              >
                <View style={[styles.detailIcon, { backgroundColor: selectedProject.color + '22' }]}>
                  <Ionicons name="folder" size={16} color={selectedProject.color} />
                </View>
                <Text style={styles.detailTitleText}>{selectedProject.name}</Text>
              </TouchableOpacity>
              <View style={{ width: 24 }} />
            </View>

            {(() => {
              const { done, total } = getProgress(selectedProject.id);
              return (
                <View style={styles.detailProgress}>
                  <View style={styles.detailProgressTrack}>
                    <View
                      style={[
                        styles.detailProgressFill,
                        {
                          width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` as `${number}%`,
                          backgroundColor: selectedProject.color,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.detailProgressLabel}>{done} of {total} done</Text>
                </View>
              );
            })()}

            {expandedTaskId !== null && (
              <TouchableOpacity
                style={styles.focusOverlay}
                activeOpacity={1}
                onPress={() => setExpandedTaskId(null)}
              />
            )}
            <View
              style={[styles.listWrapper, expandedTaskId !== null && styles.listWrapperElevated]}
              // The list sits above the spotlight overlay, so the overlay can't
              // see taps here — catch any touch in the list area instead. The
              // expanded card stops propagation so its own controls keep working.
              onTouchEnd={expandedTaskId !== null ? () => setExpandedTaskId(null) : undefined}
            >
              <FlatList
                data={detailTasks}
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
                      spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id}
                      onEdit={() => { setEditingTask(item); setEditorVisible(true); }}
                      subtaskCount={subs.length}
                      subtaskDoneCount={subs.filter(t => t.completed).length}
                      subtasks={subs}
                    />
                  );
                }}
                ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
                ListFooterComponentStyle={detailTasks.length === 0 ? undefined : styles.listFooterCell}
                ListEmptyComponent={
                  <EmptyState icon="folder-open-outline" title="No active tasks" subtitle="No active tasks in this project" />
                }
              />
            </View>
          </View>
        )}
      </Modal>

      {/* Project editor modal */}
      <Modal
        visible={projectEditorVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setProjectEditorVisible(false)}
      >
        <KeyboardAvoidingView
          style={[styles.editorRoot, { paddingTop: insets.top }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.editorHeader}>
            <TouchableOpacity onPress={() => setProjectEditorVisible(false)} hitSlop={8}>
              <Text style={styles.editorBtn}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.editorTitle}>
              {editingProject ? 'Edit Project' : 'New Project'}
            </Text>
            <TouchableOpacity onPress={saveProject} hitSlop={8}>
              <Text style={[styles.editorBtn, styles.editorSave, !projectName.trim() && styles.disabled]}>
                {editingProject ? 'Save' : 'Create'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
            <TextInput
              autoFocus
              style={styles.nameInput}
              value={projectName}
              onChangeText={setProjectName}
              placeholder="Project name"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
            />
            <TextInput
              style={styles.notesInput}
              value={projectNotes}
              onChangeText={setProjectNotes}
              placeholder="Notes"
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <View style={styles.editorSection}>
              <Text style={styles.editorLabel}>Color</Text>
              <View style={styles.colorRow}>
                {PROJECT_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.colorSwatch, { backgroundColor: c }, projectColor === c && styles.colorSwatchActive]}
                    onPress={() => {
                      haptics.tap();
                      setProjectColor(c);
                    }}
                  >
                    {projectColor === c && (
                      <Ionicons name="checkmark" size={14} color={colors.onAccent} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.optionsCard}>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  setPickerDate(projectDueDate ?? new Date());
                  setShowDatePicker(true);
                }}
                activeOpacity={interaction.activeOpacity}
              >
                <Ionicons name="calendar" size={18} color={projectDueDate ? colors.accent : colors.textSecondary} />
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Due date</Text>
                </View>
                {projectDueDate ? (
                  <View style={styles.optionValueRow}>
                    <Text style={styles.optionValue}>{format(projectDueDate, 'MMM d, yyyy')}</Text>
                    <TouchableOpacity onPress={() => setProjectDueDate(null)} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>

          {showDatePicker && (
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.pickerBtn}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>Due Date</Text>
                <TouchableOpacity onPress={() => { setProjectDueDate(pickerDate); setShowDatePicker(false); }}>
                  <Text style={[styles.pickerBtn, { color: colors.accent }]}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="spinner"
                onChange={(_e, d) => d && setPickerDate(d)}
                themeVariant={isDark ? 'dark' : 'light'}
                style={styles.picker}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

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
  list: { paddingTop: spacing.sm },
  // Same inset-grouped card footprint as TaskItem rows.
  projectRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md, marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    gap: spacing.md,
  },
  projectIcon: {
    width: 40, height: 40, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  projectInfo: { flex: 1, gap: 6 },
  projectNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projectName: { color: colors.text, fontSize: font.md, fontWeight: '500', flex: 1 },
  projectDue: { color: colors.textTertiary, fontSize: font.xs, marginLeft: spacing.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressTrack: {
    flex: 1, height: 4, borderRadius: 2,
    backgroundColor: colors.bgTertiary, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  progressLabel: { color: colors.textTertiary, fontSize: font.xs, minWidth: 32, textAlign: 'right' },
  deleteBtn: { padding: 4 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  focusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.backdrop,
    zIndex: 5,
  },
  detailRoot: { flex: 1, backgroundColor: colors.bg },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  detailTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailIcon: {
    width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
  },
  detailTitleText: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  detailProgress: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  detailProgressTrack: {
    height: 6, borderRadius: 3, backgroundColor: colors.bgTertiary, overflow: 'hidden',
  },
  detailProgressFill: { height: '100%', borderRadius: 3 },
  detailProgressLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '500', marginTop: 4,
  },
  editorRoot: { flex: 1, backgroundColor: colors.bg },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  editorTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  editorBtn: { color: colors.accent, fontSize: font.md },
  editorSave: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
  editorScroll: { flex: 1 },
  nameInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, minHeight: 50,
  },
  editorSection: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  editorLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  colorSwatch: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchActive: { borderWidth: 3, borderColor: colors.onAccent },
  optionsCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  optionValue: { color: colors.accent, fontSize: font.sm },
  pickerSheet: {
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
    paddingBottom: 20,
  },
  pickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  pickerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  pickerBtn: { color: colors.textSecondary, fontSize: font.md },
  picker: { height: 200 },
});
