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
import { useTaskStore } from '../store/useTaskStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { SpotlightProvider, useSpotlightProgress } from '../components/SpotlightOverlay';
import { TaskEditor } from '../components/TaskEditor';
import { EmptyState } from '../components/EmptyState';
import { BulkActionBar } from '../components/BulkActionBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

type RootStackParamList = {
  CategoryDetail: { category: string };
};

export function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'CategoryDetail'>>();
  const { category } = route.params;
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const addCategory = useTaskStore(s => s.addCategory);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
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
  const keyboardScroll = useKeyboardInsetScroll<FlatList>();
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

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

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
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.detailTitle}>
            <View style={[styles.catIconSm, { backgroundColor: colors.accentSubtle }]}>
              {catObj?.emoji ? (
                <Text style={styles.catIconEmojiSm}>{catObj.emoji}</Text>
              ) : (
                <Ionicons name="folder" size={14} color={colors.accent} />
              )}
            </View>
            {/* The tile to the left already carries the emoji — repeating it
                in the title just doubles it up. */}
            <Text style={styles.detailTitleText} numberOfLines={1}>{category}</Text>
          </View>
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
        </View>

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
            scrollEnabled={!painting}
            data={categoryTasks}
            keyExtractor={t => t.id}
            {...keyboardScroll.props}
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
                />
              );
            }}
            ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
            ListFooterComponentStyle={categoryTasks.length === 0 ? undefined : styles.listFooterCell}
            ListEmptyComponent={
              <EmptyState icon="folder-outline" title="No active tasks" subtitle="No active tasks in this category" />
            }
          />
        </PaintSelectionProvider>
        </View>

        {selectionMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={categoryTasks.length}
            existingTags={allTags}
            existingCategories={allCategories}
            onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
            onDelete={handleBulkDelete}
            onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
            onSetCategory={cat => { bulkSetCategory(Array.from(selectedIds), cat); exitSelection(); }}
            onAddCategory={addCategory}
            onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
            onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
            onSelectAll={() => selectAll(categoryTasks.map(t => t.id))}
            onDeselectAll={deselectAll}
            onCancel={exitSelection}
            bottomInset={insets.bottom}
            onHeightChange={setBulkBarHeight}
          />
        )}

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
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  detailTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailTitleText: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: '600',
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
