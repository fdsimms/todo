import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useSavedViewStore } from '../store/useSavedViewStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useElevatedCellRenderer } from '../hooks/useElevatedCellRenderer';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor } from '../components/TaskEditor';
import { SavedViewEditorSheet } from '../components/SavedViewEditorSheet';
import { EmptyState } from '../components/EmptyState';
import { BulkActionBar } from '../components/BulkActionBar';
import { DetailHeader } from '../components/DetailHeader';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, interaction, type Colors } from '../theme';
import { getCurrentDayStart } from '../utils/dateUtils';
import { isHeldBack } from '../utils/visibilityUtils';
import { describeSavedView, filterTasksForView } from '../utils/savedViews';
import type { Task } from '../types';

type RootStackParamList = {
  SavedViewDetail: { viewId: string };
};

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];

/**
 * The tasks one saved view holds (#2679).
 *
 * Structurally CategoryDetailScreen with a predicate in place of a category
 * name, which is deliberate: a view is a lens over the same rows, so it gets
 * the same row treatment, the same selection mode and the same bulk bar rather
 * than a lighter list of its own.
 *
 * The one thing it does differently is where its tasks come from. A category
 * screen asks the store for one category's rows; this filters every live
 * top-level task, because the whole point of a view is that it crosses Today,
 * Later, Unscheduled and Inbox — see the note on filterTasksForView.
 */
export function SavedViewDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'SavedViewDetail'>>();
  const { viewId } = route.params;
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const view = useSavedViewStore(s => s.views.find(v => v.id === viewId) ?? null);
  const projects = useProjectStore(useShallow(s => s.projects));
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewEditorVisible, setViewEditorVisible] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // True while a subtask inside the expanded row is mid-drag; the list has to
  // stop scrolling for the duration (see TaskItem.onSubtaskDragStateChange).
  const [draggingSubtask, setDraggingSubtask] = useState(false);
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
    completableCount,
    painting,
    paintProps,
  } = useTaskSelection(allTasks);

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
  const keyboardScroll = useKeyboardInsetScroll<FlatList>();
  const elevatedCell = useElevatedCellRenderer<Task>(t => t.id, expandedTaskId);
  // A RootStack card covers the tab bar entirely, so the bulk bar sits above
  // the home indicator rather than above a tab bar.
  const selectionListPadding = selectionMode ? insets.bottom + spacing.sm + bulkBarHeight + spacing.sm : undefined;
  const spotlightProgress = useSpotlightProgress(expandedTaskId !== null && !selectionMode);

  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

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

  // The rows this view holds. `isHeldBack` is handed to the matcher rather than
  // imported by it, so savedViews.ts stays out of the stores — see its header.
  const clauses = view?.clauses;
  const viewTasks = useMemo(() => {
    if (!clauses) return [];
    const ordered = [...allTasks].sort((a, b) => a.sortOrder - b.sortOrder);
    return filterTasksForView(ordered, clauses, {
      todayStart: getCurrentDayStart(),
      heldBack: isHeldBack,
    });
  }, [allTasks, clauses]);

  const projectNames = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects],
  );

  // The row handlers take the row's own id rather than closing over it, so one
  // callback serves every row — TaskItem is memoized and a fresh arrow per row
  // per render defeats its shallow compare silently. Empty deps throughout:
  // the expand toggle reaches state only through the functional form of
  // setState, and the editor resolves its task from the store at call time.
  const handleRowPress = useCallback((id: string) => {
    setExpandedTaskId(prev => {
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

  const handleOpenProject = useCallback((projectId: string) => {
    navigation.navigate({ name: 'ProjectDetail', params: { projectId } } as never);
  }, [navigation]);

  const handleRowSwipeSelect = useCallback((id: string) => {
    setExpandedTaskId(null);
    enterSelectionMode(id);
  }, [enterSelectionMode]);

  const listTouchStart = useRef<{ x: number; y: number } | null>(null);
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

  const onClose = () => {
    if (selectionMode) exitSelection();
    navigation.goBack();
  };

  // A view deleted from another screen while this one is open. Going back is
  // the honest answer; rendering an empty list would claim the view still
  // exists and simply matches nothing.
  if (!view) {
    return (
      <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
        <DetailHeader title="Saved view" onBack={onClose} />
        <EmptyState
          icon="bookmark-outline"
          title="This view is gone"
          subtitle="It was deleted. Your tasks are untouched — a view only ever filtered them."
        />
      </View>
    );
  }

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
        <DetailHeader
          title={view.name}
          onBack={onClose}
          leading={
            <View style={[styles.viewIcon, { backgroundColor: colors.accentSubtle }]}>
              <Ionicons name={view.icon as never} size={14} color={colors.accent} />
            </View>
          }
          actions={
            <TouchableOpacity
              onPress={() => setViewEditorVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit the ${view.name} view`}
            >
              <Ionicons name="options-outline" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          }
        />

        {/* What the view actually selects. Under the header rather than in it:
            DetailHeader has no subtitle slot, and five other screens share
            it. */}
        <Text style={styles.description} numberOfLines={2}>
          {describeSavedView(view.clauses, { projectNames })}
        </Text>

        <View
          style={{ flex: 1 }}
          onTouchStart={expandedTaskId !== null ? handleListTouchStart : undefined}
          onTouchEnd={expandedTaskId !== null ? handleListTouchEnd : undefined}
        >
        <PaintSelectionProvider {...paintProps}>
          <FlatList
            ref={keyboardScroll.ref}
            scrollEnabled={!painting && !draggingSubtask}
            data={viewTasks}
            keyExtractor={t => t.id}
            CellRendererComponent={elevatedCell}
            {...keyboardScroll.props}
            contentContainerStyle={[{ flexGrow: 1 }, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]}
            renderItem={({ item }) => {
              const subs = subtasksOf(item.id);
              return (
                <TaskItem
                  task={item}
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
                  showDate
                  showProject
                  onOpenProject={handleOpenProject}
                />
              );
            }}
            ListFooterComponent={
              viewTasks.length === 0
                ? null
                : <TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />
            }
            ListFooterComponentStyle={viewTasks.length === 0 ? undefined : styles.listFooterCell}
            ListEmptyComponent={
              <EmptyState
                icon="bookmark-outline"
                title="Nothing matches"
                subtitle="This view filters every task that isn't done or archived. Edit it from the button in the header."
              />
            }
          />
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={viewTasks.length}
            existingTags={allTags}
            onComplete={handleBulkComplete}
            completableCount={completableCount}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onMarkMissed={() => { bulkMarkMissed(Array.from(selectedIds)); exitSelection(); }}
            onSelectAll={() => selectAll(viewTasks.map(t => t.id))}
            onDeselectAll={deselectAll}
            onCancel={exitSelection}
            bottomInset={insets.bottom}
            onHeightChange={setBulkBarHeight}
          />
        )}

        <DeliverablePromptQueue {...queueProps} />

        <SavedViewEditorSheet
          visible={viewEditorVisible}
          view={view}
          onClose={() => setViewEditorVisible(false)}
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
    </SpotlightProvider>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Both margins on purpose: the list below has no top margin of its own, so
  // without the bottom one the first card sits flush against this line.
  description: {
    fontSize: font.sm,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  viewIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
});
