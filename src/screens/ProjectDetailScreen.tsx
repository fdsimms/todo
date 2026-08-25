import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  type GestureResponderEvent,
} from 'react-native';
import { ReorderableList } from '../components/ReorderableList';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectDecisions, projectProgress } from '../store/useProjectStore';
import { OfferBanner } from '../components/OfferBanner';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { ProjectEditor } from '../components/ProjectEditor';
import { BulkActionBar } from '../components/BulkActionBar';
import { QuickAddModal } from '../components/QuickAddModal';
import { TemplatePickerSheet } from '../components/TemplatePickerSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { EmptyState } from '../components/EmptyState';
import { ProjectDecisions } from '../components/ProjectDecisions';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { FabMenu, type FabMenuItem } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task, Project, TaskTemplate } from '../types';
import { SheetHeaderButton } from '../components/SheetHeaderButton';
import { SearchField } from '../components/SearchField';
import { DetailHeader } from '../components/DetailHeader';

type RootStackParamList = {
  ProjectDetail: { projectId: string };
};

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];

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
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);
  const reorderProjectTasks = useTaskStore(s => s.reorderProjectTasks);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const setDeliverableValue = useTaskStore(s => s.setDeliverableValue);
  const completeProject = useTaskStore(s => s.completeProject);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // True while a subtask inside the expanded row is mid-drag; the list has to
  // stop scrolling for the duration (see TaskItem.onSubtaskDragStateChange).
  const [draggingSubtask, setDraggingSubtask] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState<TaskTemplate | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  // Not-now only, like every OfferBanner — reopening the project re-offers it,
  // which is right since nothing else marks the project done for the user.
  const [completeOfferDismissed, setCompleteOfferDismissed] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [flashTaskId, setFlashTaskId] = useState<string | null>(null);
  // The decision whose answer is being corrected. Held by id and read back off
  // the live list, so the sheet re-seeds from the store rather than from a
  // snapshot taken when the row was tapped — same as the Logbook's.
  const [answerTaskId, setAnswerTaskId] = useState<string | null>(null);
  const flashTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Bulk completion asks before it drops an answer — see
  // useAnswerFirstCompletion. Selection is left alone until something actually
  // happens: `complete` runs on every path out of the confirm except Cancel,
  // so backing out leaves the selection exactly as it was rather than making
  // the user rebuild it.
  const { requestComplete, queueProps } = useAnswerFirstCompletion();
  const handleBulkComplete = () => {
    const ids = Array.from(selectedIds);
    requestComplete({
      ids,
      complete: skipIds => {
        bulkCompleteTasks(ids.filter(id => !skipIds.includes(id)));
        exitSelection();
      },
    });
  };
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
  // The rows the order actually applies to — archived members are filed away,
  // and holding a sequence open on one nobody can see would strand the rest.
  // Matches liveProjectSteps, which is what the visibility gate ranks.
  const steps = incompleteProjectTasks.filter(t => !t.archived);
  const sequential = project?.sequential ?? false;
  const completedProjectTasks = projectTasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  // Same identity-grouped count the Projects list badges its quick-complete
  // action with — a recurring member never reads done here either.
  const progress = project ? projectProgress(project.id, allTasks) : { done: 0, total: 0 };
  const allDone = progress.total > 0 && progress.done === progress.total && !project?.completed;

  const handleMarkComplete = () => {
    if (!project) return;
    haptics.success();
    // Nothing open to ask about archiving — allDone already means every
    // unarchived member is done, same guarantee ProjectsScreen's quick action
    // relies on.
    completeProject(project.id, { archiveRemaining: false });
  };
  // What "Select all" covers, and what the bar counts against to decide it has
  // everything: the rows actually on screen. Completed tasks are collapsed
  // behind a toggle, and counting hidden rows would leave the bar stuck
  // offering "Select all" after the user already had.
  const selectableTasks = showCompleted ? projectTasks : incompleteProjectTasks;
  // What this project has already decided — one row per member, most recent
  // answer first. It does its own filtering (members, unarchived, collapsed by
  // identity), so it takes the whole task list rather than projectTasks.
  const decisions = useMemo(() => projectDecisions(projectId, allTasks), [projectId, allTasks]);
  const answerTask = answerTaskId !== null ? allTasks.find(t => t.id === answerTaskId) ?? null : null;

  const onClose = () => {
    if (selectionMode) exitSelection();
    navigation.goBack();
  };

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // Every subtask on this screen, grouped once. Each row used to filter the
  // whole task list for its own children inline, which is O(tasks) per row and
  // — worse — handed the memoized row a fresh array on every render.
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const list = map.get(t.parentId);
      if (list) list.push(t);
      else map.set(t.parentId, [t]);
    }
    return map;
  }, [allTasks]);
  const subtasksOf = (id: string): Task[] => subtasksByParent.get(id) ?? NO_SUBTASKS;

  // The row handlers take the row's own id rather than closing over it, so one
  // callback serves every row — TaskItem is memoized and a fresh arrow per row
  // per render defeats its shallow compare silently, putting every mounted row
  // back to re-rendering on each store write. Empty deps throughout: the expand
  // toggle reaches state only through the functional form of setState, and the
  // editor resolves its task from the store at call time rather than capturing
  // it, so neither can read a stale value from its frozen closure.
  const handleRowPress = useCallback((id: string) => {
    setExpandedTaskId(prev => {
      // A tap landing while a *different* row is spotlighted just dismisses
      // that one, rather than expanding the row that was tapped.
      if (prev !== null && prev !== id) return null;
      return prev === id ? null : id;
    });
  }, []);

  const handleRowEdit = useCallback((id: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === id);
    if (!task) return;
    setEditingTask(task);
    setEditorVisible(true);
  }, []);

  const handleRowSwipeSelect = useCallback((id: string) => {
    setExpandedTaskId(null);
    enterSelectionMode(id);
  }, [enterSelectionMode]);

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
    { key: 'template', label: 'Template', icon: 'copy' },
    { key: 'new', label: 'New task', icon: 'checkbox' },
  ];

  const handleAddMenuSelect = (key: string) => {
    if (key === 'new') {
      setQuickAddVisible(true);
      return;
    }
    if (key === 'template') {
      setTemplatePickerVisible(true);
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
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setFlashTaskId(task.id);
    flashTimeoutRef.current = setTimeout(() => setFlashTaskId(null), 1200);
  };

  React.useEffect(() => () => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
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
        <DetailHeader
          title={project?.title ?? ''}
          onBack={onClose}
          actions={
            <TouchableOpacity
              onPress={() => project && setEditingProject(project)}
              accessibilityRole="button"
              accessibilityLabel="Edit project"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          }
        />

        {allDone && !completeOfferDismissed && (
          <OfferBanner
            lead="Every task in this project"
            rest="is complete."
            actionLabel="Mark Complete"
            onAction={handleMarkComplete}
            onDismiss={() => setCompleteOfferDismissed(true)}
            accessibilityLabel="Every task in this project is complete"
            actionAccessibilityLabel={`Mark ${project?.title ?? 'this project'} complete`}
            dismissAccessibilityLabel="Dismiss project complete notice"
          />
        )}

        {!!project?.notes && (
          // Collapsed to one line by default — the notes are a reference, not
          // the point of this screen, and a multi-paragraph note shouldn't push
          // the task list below the fold. Tap to unfold in place.
          <TouchableOpacity
            style={styles.notesPreview}
            onPress={() => { animateLayout(); setNotesExpanded(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${notesExpanded ? 'Collapse' : 'Expand'} project notes`}
          >
            <Ionicons name="document-text-outline" size={13} color={colors.textTertiary} style={styles.notesPreviewIcon} />
            <Text style={styles.notesPreviewText} numberOfLines={notesExpanded ? undefined : 1}>
              {project.notes}
            </Text>
          </TouchableOpacity>
        )}

        {sequential && steps.length > 1 && (
          // Says why every row but one is wearing a padlock. Only worth the
          // line when something is actually held back — a one-step project
          // looks identical either way.
          <View style={styles.sequenceNote}>
            <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />
            <Text style={styles.sequenceNoteText}>
              In order · the next step unlocks when you finish this one
            </Text>
          </View>
        )}

        <View
          style={{ flex: 1 }}
          onTouchStart={expandedTaskId !== null ? handleListTouchStart : undefined}
          onTouchEnd={expandedTaskId !== null ? handleListTouchEnd : undefined}
        >
        <PaintSelectionProvider {...paintProps}>
          <ReorderableList
            scrollEnabled={!painting && !draggingSubtask}
            data={incompleteProjectTasks}
            keyExtractor={t => t.id}
            // An expanded row's card shadow falls across the row below it, so
            // the row has to be lifted over its neighbours — see
            // ReorderableList's own note on why this can't live on the card.
            rowElevated={t => t.id === expandedTaskId}
            contentContainerStyle={[{ flexGrow: 1, paddingTop: spacing.sm }, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]}
            onHoverChange={haptics.dragTick}
            onReorder={reordered => reorderProjectTasks(projectId, reordered.map(t => t.id))}
            // Inside the scroll content, not pinned above the list: it's
            // reference material, so it should scroll out of the way once
            // you're working through the tasks. Not tappable while selecting —
            // these rows aren't selectable, and a tap that opened a sheet
            // mid-selection would be the odd one out.
            ListHeaderComponent={
              <ProjectDecisions
                decisions={decisions}
                onPress={selectionMode ? undefined : task => setAnswerTaskId(task.id)}
              />
            }
            renderItem={({ item, drag, isActive }) => {
              const subs = subtasksOf(item.id);
              // Position in the live order, 1-based — the same ranking
              // isSequenceBlocked gates on, so the number on the row and the
              // lock on it can't disagree.
              const step = steps.indexOf(item);
              return (
                <TaskItem
                  task={item}
                  drag={selectionMode ? undefined : drag}
                  isActive={isActive}
                  stepNumber={sequential && step >= 0 ? step + 1 : null}
                  locked={sequential && step > 0}
                  onPress={handleRowPress}
                  expanded={expandedTaskId === item.id}
                  onEdit={handleRowEdit}
                  subtaskCount={subs.length}
                  subtaskDoneCount={subs.filter(t => t.completed).length}
                  subtasks={subs}
                  onSubtaskDragStateChange={setDraggingSubtask}
                  spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id && !selectionMode}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onSelect={toggleSelection}
                  onSwipeSelect={handleRowSwipeSelect}
                  showCategory
                  showGroup
                  showDate
                  showPin={false}
                  highlighted={item.id === flashTaskId}
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
            // Only the completed section lives down here, so with nothing
            // completed the footer is bare padding — and that padding comes off
            // the box the empty state centres in.
            ListFooterComponent={
              completedProjectTasks.length === 0 ? null : (
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
                      const subs = subtasksOf(task.id);
                      return (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onPress={handleRowPress}
                          expanded={expandedTaskId === task.id}
                          onEdit={handleRowEdit}
                          subtaskCount={subs.length}
                          subtaskDoneCount={subs.filter(t => t.completed).length}
                          subtasks={subs}
                          onSubtaskDragStateChange={setDraggingSubtask}
                          spotlightDisabled={expandedTaskId !== null && expandedTaskId !== task.id && !selectionMode}
                          selectionMode={selectionMode}
                          selected={selectedIds.has(task.id)}
                          onSelect={toggleSelection}
                          onSwipeSelect={handleRowSwipeSelect}
                          showCategory
                          showGroup
                          showPin={false}
                        />
                      );
                    })}
                  </View>
                )}
              </View>
              )
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
            onComplete={handleBulkComplete}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onMarkMissed={() => { bulkMarkMissed(Array.from(selectedIds)); exitSelection(); }}
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
            {/* Deliberately not `DetailHeader`: that's the back-chevron bar a
                pushed screen gets, and this is the Cancel/title/confirm bar
                every sheet in the app gets (fourteen of them, all built the
                same way out of `SheetHeaderButton`). Two idioms, already
                decomposed — the button is the shared part, the row isn't. */}
            <View style={styles.detailHeader}>
              <SheetHeaderButton
                label="Cancel"
                role="cancel"
                onPress={() => setShowExistingPicker(false)}
                accessibilityLabel="Close"
              />
              <Text style={styles.detailTitleText}>Add Existing Task</Text>
              {/* Balances Cancel so the title stays optically centered. */}
              <View style={styles.headerSpacer} />
            </View>
            <SearchField
              autoFocus
              style={styles.searchBar}
              value={existingSearch}
              onChangeText={setExistingSearch}
              placeholder="Search tasks"
              accessibilityLabel="Search tasks to add"
            />
            <FlatList
              data={eligibleForAdd}
              keyExtractor={t => t.id}
              contentContainerStyle={eligibleForAdd.length === 0 ? styles.emptyContainer : undefined}
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

        {/* Add from a template: pick one here, then the apply sheet below —
            same two-step flow as Today, but the applied tasks land directly
            in this project instead of the template's own container. */}
        <TemplatePickerSheet
          visible={templatePickerVisible}
          onClose={() => setTemplatePickerVisible(false)}
          onSelect={setApplyTemplate}
        />

        <ApplyTemplateSheet
          visible={applyTemplate !== null}
          template={applyTemplate}
          onClose={() => setApplyTemplate(null)}
          projectId={project?.id}
          onApplied={tasks => { if (tasks[0]) openEditor(tasks[0]); }}
        />

        {/* Correcting a decision from where it's read — the same sheet in the
            same mode the Logbook's ⋯ menu opens, so there's one place an
            answer is written and one way it's written. */}
        {answerTask && (
          <DeliverablePromptSheet
            visible
            task={answerTask}
            mode="edit"
            onConfirm={value => {
              setDeliverableValue(answerTask.id, value);
              setAnswerTaskId(null);
            }}
            onCancel={() => setAnswerTaskId(null)}
          />
        )}

        <ProjectEditor
          visible={editingProject !== null}
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />

        <DeliverablePromptQueue {...queueProps} />

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
  headerSpacer: { width: 48 },
  detailTitleText: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  // A full-height content container, so the empty state's `flex: 1` centres in
  // the list's viewport rather than collapsing to its own height at the top.
  emptyContainer: { flexGrow: 1 },
  detailFooter: {
    paddingTop: spacing.sm,
    // Clears the floating add button so the last row is never under it.
    paddingBottom: spacing.xl * 2 + spacing.lg,
  },
  notesPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  notesPreviewIcon: {
    // Nudged down to sit on the text's cap height instead of its vertical
    // center, matching sequenceNote's baseline alignment with a one-line icon.
    marginTop: 2,
  },
  notesPreviewText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  sequenceNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  sequenceNoteText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
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
  searchBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
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
