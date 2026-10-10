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
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useElevatedCellRenderer } from '../hooks/useElevatedCellRenderer';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { EmptyState } from '../components/EmptyState';
import { BulkActionBar } from '../components/BulkActionBar';
import { DetailHeader } from '../components/DetailHeader';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { confirmBulkSetWhen } from '../utils/scheduleMovePrompt';
import { groupRoster } from '../utils/visibilityUtils';
import type { Task } from '../types';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

type RootStackParamList = {
  StackDetail: { groupId: string };
};

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];

/**
 * One stack's whole roster on a screen of its own: the same rows Today draws
 * under the stack's header, but every member rather than only the ones due
 * today, so a long list (a packing list) can be read and checked off in one
 * place. The roster is `groupRoster`, never the raw child rows (see Stacks in
 * CLAUDE.md), so completed occurrences of a repeating member don't pile up.
 */
export function StackDetailScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'StackDetail'>>();
  const { groupId } = route.params;
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetDifficulty = useTaskStore(s => s.bulkSetDifficulty);
  const rewardsEnabled = useSettingsStore(s => s.rewardsEnabled);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const group = useTaskGroupStore(s => s.groups.find(g => g.id === groupId) ?? null);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
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
  const keyboardScroll = useKeyboardInsetScroll<FlatList>({ refreshing: pullSearch.pulling });
  const scrollTop = useListScrollToTop(keyboardScroll);
  // Lifts the expanded row's cell above the row below it — see
  // useElevatedCellRenderer for why a genuine FlatList needs this and
  // ReorderableList's own lists don't.
  const elevatedCell = useElevatedCellRenderer<Task>(t => t.id, expandedTaskId);
  // This screen is a RootStack card, not a tab screen — it covers the tab bar
  // entirely, so the bulk bar sits above the home indicator, not above a tab
  // bar. (Asking for useBottomTabBarHeight() here throws outright.)
  const selectionListPadding = selectionMode ? insets.bottom + spacing.sm + bulkBarHeight + spacing.sm : undefined;
  // Every row's scrim shares this one animation, so the dim lands as a
  // single motion — see SpotlightOverlay.
  const spotlightProgress = useSpotlightProgress(expandedTaskId !== null && !selectionMode);

  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

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

  // Ordered the way Today orders a stack's rows (`sortOrder`), so dragging
  // there reads the same here.
  const roster = useMemo(
    () => groupRoster(allTasks.filter(t => t.groupId === groupId && !t.parentId).sort((x, y) => x.sortOrder - y.sortOrder)),
    [allTasks, groupId],
  );
  const doneCount = roster.filter(t => t.completed).length;

  const onClose = () => {
    if (selectionMode) exitSelection();
    navigation.goBack();
  };

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
        {/* The tile already carries the emoji — repeating it in the title
            just doubles it up. */}
        <DetailHeader
          title={group?.title ?? 'Stack'}
          onBack={onClose}
          actions={
            roster.length > 0 ? (
              <Text style={styles.tally} accessibilityLabel={`${doneCount} of ${roster.length} done`}>
                {doneCount}/{roster.length}
              </Text>
            ) : undefined
          }
        />

        <View
          style={{ flex: 1 }}
          // Catch any touch in the list area to dismiss the expanded-task
          // spotlight; the expanded card stops propagation so its own
          // controls keep working.
          onTouchStart={expandedTaskId !== null ? handleListTouchStart : undefined}
          onTouchEnd={expandedTaskId !== null ? handleListTouchEnd : undefined}
        >
        <PaintSelectionProvider {...paintProps}>
          <FlatList
            ref={scrollTop.ref}
            refreshControl={pullSearch.refreshControl}
            scrollEnabled={!painting && !draggingSubtask}
            data={roster}
            keyExtractor={t => t.id}
            CellRendererComponent={elevatedCell}
            {...keyboardScroll.props}
            {...scrollTop.listProps}
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
                  showProject
                  onOpenProject={handleOpenProject}
                />
              );
            }}
            // The footer is only a tap target for dismissing an expanded row,
            // so it has no job on an empty list — and its minHeight would push
            // the empty state off centre.
            ListFooterComponent={
              roster.length === 0
                ? null
                : <TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />
            }
            ListFooterComponentStyle={roster.length === 0 ? undefined : styles.listFooterCell}
            ListEmptyComponent={
              <EmptyState
                icon="layers-outline"
                title="No tasks in this stack"
                subtitle="Add tasks from the stack’s editor, or drag them onto it on Today."
              />
            }
          />
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={roster.length}
            existingTags={allTags}
            onComplete={handleBulkComplete}
            completableCount={completableCount}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => confirmBulkSetWhen(Array.from(selectedIds), date, segs, exitSelection)}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onSetDifficulty={rewardsEnabled ? d => { bulkSetDifficulty(Array.from(selectedIds), d); exitSelection(); } : undefined}
            onMarkMissed={() => { bulkMarkMissed(Array.from(selectedIds)); exitSelection(); }}
            onSelectAll={() => selectAll(roster.map(t => t.id))}
            onDeselectAll={deselectAll}
            onCancel={exitSelection}
            bottomInset={insets.bottom}
            onHeightChange={setBulkBarHeight}
          />
        )}

        <DeliverablePromptQueue {...queueProps} />

        <TaskEditor
          visible={editorVisible}
          task={editingTask}
          initialDraft={editorInitialDraft}
          onClose={() => {
            setEditorVisible(false);
            setExpandedTaskId(null);
            setEditorInitialDraft(null);
          }}
        />

        <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
      </View>
    </SpotlightProvider>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  tally: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
});
