import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { SpotlightOverlay, useSpotlightElevation } from '../components/SpotlightOverlay';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import type { Task } from '../types';

export function TagsScreen() {
  const insets = useSafeAreaInsets();
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const tasksByTag = useTaskStore(s => s.tasksByTag);
  const addTag = useTaskStore(s => s.addTag);
  const deleteTag = useTaskStore(s => s.deleteTag);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const allTasks = useTaskStore(s => s.tasks);
  const inputRef = useRef<TextInput>(null);

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  const spotlightActive = expandedTaskId !== null;
  const listElevated = useSpotlightElevation(spotlightActive);

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

  const handleAddTag = () => {
    const trimmed = newTagText.trim().toLowerCase();
    if (trimmed) {
      haptics.success();
      animateLayout();
      addTag(trimmed);
    }
    setNewTagText('');
    setAddingTag(false);
  };

  const handleStartAdding = () => {
    animateLayout();
    setAddingTag(true);
    setTimeout(() => inputRef.current?.focus(), 50);
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Tags"
        actions={[{ icon: 'add', onPress: handleStartAdding, accessibilityLabel: 'Add tag' }]}
      />

      {addingTag && (
        <View style={styles.addRow}>
          <View style={[styles.tagIcon, { backgroundColor: colors.bgSecondary }]}>
            <Ionicons name="pricetag" size={18} color={colors.textTertiary} />
          </View>
          <TextInput
            ref={inputRef}
            style={styles.addInput}
            value={newTagText}
            onChangeText={setNewTagText}
            placeholder="New tag name"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleAddTag}
            onBlur={() => {
              if (!newTagText.trim()) setAddingTag(false);
            }}
          />
          <TouchableOpacity onPress={handleAddTag} style={styles.addConfirm} activeOpacity={interaction.activeOpacity} accessibilityRole="button" accessibilityLabel="Confirm new tag">
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewTagText(''); setAddingTag(false); }}
            style={styles.addCancel}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {allTags.length === 0 && !addingTag ? (
        <EmptyState
          icon="pricetag"
          title="No tags yet"
          subtitle="Tap + to create a tag, or add tags to tasks"
        />
      ) : (
        <FlatList
          data={allTags}
          keyExtractor={t => t}
          contentContainerStyle={styles.list}
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
      )}

      {/* Tag detail modal */}
      <Modal
        visible={selectedTag !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedTag(null)}
      >
        <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedTag(null)} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.detailTitle}>
              {selectedTag && (
                <View style={[styles.tagIconSm, { backgroundColor: tagColor(selectedTag) + '22' }]}>
                  <Ionicons name="pricetag" size={14} color={tagColor(selectedTag)} />
                </View>
              )}
              <Text style={styles.detailTitleText}>{selectedTag}</Text>
            </View>
            <View style={{ width: 24 }} />
          </View>

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
            <FlatList
              data={tagTasks}
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
                    onEdit={() => openEditor(item)}
                    subtaskCount={subs.length}
                    subtaskDoneCount={subs.filter(t => t.completed).length}
                    subtasks={subs}
                  />
                );
              }}
              ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
              ListFooterComponentStyle={tagTasks.length === 0 ? undefined : styles.listFooterCell}
              ListEmptyComponent={
                <EmptyState icon="pricetag-outline" title="No active tasks" subtitle="No active tasks with this tag" />
              }
            />
          </View>
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
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Mirrors the inset-grouped card footprint of the tag rows below.
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
    fontWeight: '500',
    paddingVertical: 0,
  },
  addConfirm: {
    padding: 4,
  },
  addCancel: {
    padding: 4,
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
  tagIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
