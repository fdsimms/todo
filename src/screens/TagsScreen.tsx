import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { PaintSelectionProvider } from '../components/PaintSelection';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { BulkActionBar } from '../components/BulkActionBar';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { Fab, FAB_SIZE } from '../components/Fab';
import { DetailHeader } from '../components/DetailHeader';
import {
  SpotlightOverlay,
  SpotlightProvider,
  useSpotlightElevation,
  useSpotlightProgress,
} from '../components/SpotlightOverlay';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import type { Task } from '../types';

export function TagsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const tasksByTag = useTaskStore(s => s.tasksByTag);
  const addTag = useTaskStore(s => s.addTag);
  const deleteTag = useTaskStore(s => s.deleteTag);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const addCategory = useTaskStore(s => s.addCategory);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const allTasks = useTaskStore(s => s.tasks);
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
  // Extra bottom padding so the last rows aren't hidden behind the floating BulkActionBar.
  const selectionListPadding = selectionMode ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm : undefined;

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  const spotlightActive = expandedTaskId !== null && !selectionMode;
  const listElevated = useSpotlightElevation(spotlightActive);
  // Every scrim on the screen shares this one animation — see SpotlightOverlay.
  const spotlightProgress = useSpotlightProgress(spotlightActive);

  // The spotlight overlay sits behind the elevated list (zIndex 10), so it
  // never sees taps over the list; the wrapper's onTouchEnd below catches
  // them instead. Raw touch events fire on release regardless of whether the
  // list itself claimed the gesture as a scroll, so without this distance
  // check, scrolling the list would dismiss the spotlight just like an
  // intentional tap outside it.
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

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const tagTasks = selectedTag ? tasksByTag(selectedTag) : [];

  // Tags are always stored lowercase, so "Errands" and "errands" can't split
  // into two entries.
  const handleAddTag = (name: string) => {
    animateLayout();
    addTag(name.toLowerCase());
  };

  const handleDeleteTag = (tag: string) => {
    haptics.warning();
    Alert.alert(
      'Delete Tag',
      `Remove "${tag}" from all tasks?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteTag(tag);
          },
        },
      ]
    );
  };

  return (
    <SpotlightProvider progress={spotlightProgress}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader
          title="Tags"
          subtitle={allTags.length > 0 ? `${allTags.length} ${allTags.length === 1 ? 'tag' : 'tags'}` : undefined}
        />

        <FlatList
          data={allTags}
          keyExtractor={t => t}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
          ListEmptyComponent={
            <EmptyState
              icon="pricetag"
              title="No tags yet"
              subtitle="Tags cut across categories — one task can carry as many as you like"
              actionLabel="New tag"
              onAction={() => setQuickAddVisible(true)}
              bottomOffset={tabBarHeight}
            />
          }
          renderItem={({ item: tag }) => {
            const count = tasksByTag(tag).length;
            const color = tagColor(tag);
            return (
              <TouchableOpacity
                style={styles.tagRow}
                onPress={() => {
                  setExpandedTaskId(null);
                  setSelectedTag(tag);
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${tag}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
                accessibilityHint="Double tap to view tasks with this tag"
              >
                <View style={[styles.tagIcon, { backgroundColor: color + '22' }]}>
                  <Ionicons name="pricetag" size={18} color={color} />
                </View>
                <Text style={styles.tagName}>{tag}</Text>
                <Text style={styles.tagCount}>{count}</Text>
                <TouchableOpacity
                  onPress={() => handleDeleteTag(tag)}
                  style={styles.deleteButton}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete tag ${tag}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
        />

        <Fab
          onPress={() => setQuickAddVisible(true)}
          accessibilityLabel="Add tag"
          bottom={insets.bottom + tabBarHeight + spacing.md}
        />

        <QuickAddNameSheet
          visible={quickAddVisible}
          placeholder="New tag…"
          autoCapitalize="none"
          onSubmit={handleAddTag}
          onClose={() => setQuickAddVisible(false)}
        />

        {/* Tag detail modal */}
        <Modal
          visible={selectedTag !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => { setSelectedTag(null); if (selectionMode) exitSelection(); }}
        >
          <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
            <DetailHeader
              title={selectedTag ?? ''}
              backIcon="close"
              onBack={() => { setSelectedTag(null); if (selectionMode) exitSelection(); }}
              leading={selectedTag ? (
                <View style={[styles.tagIconSm, { backgroundColor: tagColor(selectedTag) + '22' }]}>
                  <Ionicons name="pricetag" size={14} color={tagColor(selectedTag)} />
                </View>
              ) : undefined}
            />

            <SpotlightOverlay
              visible={spotlightActive}
              onPress={() => setExpandedTaskId(null)}
            />
            <View
              style={[styles.listWrapper, listElevated && styles.listWrapperElevated]}
              // The list sits above the spotlight overlay, so the overlay can't
              // see taps here — catch any touch in the list area instead. The
              // expanded card stops propagation so its own controls keep working.
              onTouchStart={spotlightActive ? handleListTouchStart : undefined}
              onTouchEnd={spotlightActive ? handleListTouchEnd : undefined}
            >
            <PaintSelectionProvider {...paintProps}>
              <FlatList
                ref={keyboardScroll.ref}
                scrollEnabled={!painting}
                data={tagTasks}
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
                      spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id && !selectionMode}
                      onEdit={() => openEditor(item)}
                      subtaskCount={subs.length}
                      subtaskDoneCount={subs.filter(t => t.completed).length}
                      subtasks={subs}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(item.id)}
                      onSelect={() => toggleSelection(item.id)}
                      onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(item.id); }}
                      showProject
                    />
                  );
                }}
                ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
                ListFooterComponentStyle={tagTasks.length === 0 ? undefined : styles.listFooterCell}
                ListEmptyComponent={
                  <EmptyState icon="pricetag-outline" title="No active tasks" subtitle="No active tasks with this tag" />
                }
              />
            </PaintSelectionProvider>
            </View>

            {selectionMode && (
              <BulkActionBar
                selectedCount={selectedIds.size}
                totalCount={tagTasks.length}
                existingTags={allTags}
                existingCategories={allCategories}
                onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
                onDelete={handleBulkDelete}
                onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
                onSetCategory={category => { bulkSetCategory(Array.from(selectedIds), category); exitSelection(); }}
                onAddCategory={addCategory}
                onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
                onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
                onSelectAll={() => selectAll(tagTasks.map(t => t.id))}
                onDeselectAll={deselectAll}
                onCancel={exitSelection}
                bottomInset={tabBarHeight}
                onHeightChange={setBulkBarHeight}
              />
            )}
          </View>
        </Modal>

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
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    paddingTop: spacing.sm,
  },
  // Same inset-grouped card footprint as TaskItem rows.
  tagRow: {
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
  tagIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagName: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  tagCount: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  deleteButton: {
    padding: 4,
  },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  tagIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
