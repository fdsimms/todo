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
import { PinIcon } from '../components/PinIcon';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useElevatedCellRenderer } from '../hooks/useElevatedCellRenderer';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor } from '../components/TaskEditor';
import { EmptyState } from '../components/EmptyState';
import { BulkActionBar } from '../components/BulkActionBar';
import { DetailHeader } from '../components/DetailHeader';
import { useColors } from '../theme/ThemeContext';
import { spacing, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

type RootStackParamList = {
  CategoryDetail: { category: string };
};

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];

export function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'CategoryDetail'>>();
  const { category } = route.params;
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkMarkMissed = useTaskStore(s => s.bulkMarkMissed);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const pinCategory = useTaskStore(s => s.pinCategory);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
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
  const keyboardScroll = useKeyboardInsetScroll<FlatList>();
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

  const categoryTasks = tasksByCategory(category);
  const categoryAllPinned = categoryTasks.length > 0 && categoryTasks.every(t => t.pinned);
  const catObj = categories.find(c => c.name === category) ?? null;

  const handlePinCategory = () => {
    if (categoryTasks.length === 0) return;
    haptics.tap();
    animateLayout();
    pinCategory(category);
  };

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
          title={category}
          onBack={onClose}
          leading={
            <View style={[styles.catIconSm, { backgroundColor: colors.accentSubtle }]}>
              {catObj?.emoji ? (
                <Text style={styles.catIconEmojiSm}>{catObj.emoji}</Text>
              ) : (
                <Ionicons name="folder" size={14} color={colors.accent} />
              )}
            </View>
          }
          actions={
            <TouchableOpacity
              onPress={handlePinCategory}
              disabled={categoryTasks.length === 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityState={{ disabled: categoryTasks.length === 0, selected: categoryAllPinned }}
              accessibilityLabel={categoryAllPinned ? `Unpin all tasks in ${category}` : `Pin all tasks in ${category}`}
            >
              <PinIcon
                filled={categoryAllPinned}
                size={22}
                color={categoryTasks.length === 0 ? colors.textTertiary : (categoryAllPinned ? colors.orange : colors.textSecondary)}
              />
            </TouchableOpacity>
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
            ref={keyboardScroll.ref}
            scrollEnabled={!painting && !draggingSubtask}
            data={categoryTasks}
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
                  showProject
                />
              );
            }}
            // The footer is only a tap target for dismissing an expanded row,
            // so it has no job on an empty list — and its minHeight would push
            // the empty state off centre.
            ListFooterComponent={
              categoryTasks.length === 0
                ? null
                : <TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />
            }
            ListFooterComponentStyle={categoryTasks.length === 0 ? undefined : styles.listFooterCell}
            ListEmptyComponent={
              <EmptyState icon="folder-outline" title="No active tasks" subtitle="Tasks filed under this category show up here. Completed ones are in the Logbook." />
            }
          />
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={categoryTasks.length}
            existingTags={allTags}
            onComplete={handleBulkComplete}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onMarkMissed={() => { bulkMarkMissed(Array.from(selectedIds)); exitSelection(); }}
            onSelectAll={() => selectAll(categoryTasks.map(t => t.id))}
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
  catIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catIconEmojiSm: {
    fontSize: 14,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
});
