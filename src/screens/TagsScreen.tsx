import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';
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

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const tagTasks = selectedTag ? tasksByTag(selectedTag) : [];

  const handleAddTag = () => {
    const trimmed = newTagText.trim().toLowerCase();
    if (trimmed) addTag(trimmed);
    setNewTagText('');
    setAddingTag(false);
  };

  const handleStartAdding = () => {
    setAddingTag(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleDeleteTag = (tag: string) => {
    Alert.alert(
      'Delete Tag',
      `Remove "${tag}" from all tasks?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTag(tag),
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Tags</Text>
        <TouchableOpacity onPress={handleStartAdding} style={styles.addButton} activeOpacity={0.7}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

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
          <TouchableOpacity onPress={handleAddTag} style={styles.addConfirm} activeOpacity={0.7}>
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewTagText(''); setAddingTag(false); }}
            style={styles.addCancel}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {allTags.length === 0 && !addingTag ? (
        <View style={styles.empty}>
          <Ionicons name="pricetag" size={48} color={colors.bgQuaternary} />
          <Text style={styles.emptyText}>No tags yet</Text>
          <Text style={styles.emptySubtext}>Tap + to create a tag, or add tags to tasks</Text>
        </View>
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
                onPress={() => setSelectedTag(tag)}
                activeOpacity={0.7}
              >
                <View style={[styles.tagIcon, { backgroundColor: color + '22' }]}>
                  <Ionicons name="pricetag" size={18} color={color} />
                </View>
                <Text style={styles.tagName}>{tag}</Text>
                <Text style={styles.tagCount}>{count}</Text>
                <TouchableOpacity
                  onPress={() => handleDeleteTag(tag)}
                  style={styles.deleteButton}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
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
            <TouchableOpacity onPress={() => setSelectedTag(null)}>
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

          {expandedTaskId !== null && (
            <TouchableOpacity
              style={styles.focusOverlay}
              activeOpacity={1}
              onPress={() => setExpandedTaskId(null)}
            />
          )}
          <View style={[styles.listWrapper, expandedTaskId !== null && styles.listWrapperElevated]}>
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
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptySubtext}>No active tasks with this tag</Text>
                </View>
              }
            />
          </View>
        </View>
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
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  addButton: {
    padding: 4,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
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
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
    backgroundColor: colors.bg,
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
    fontWeight: '500',
  },
  tagCount: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  deleteButton: {
    padding: 4,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 36 + spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: font.lg,
    fontWeight: '600',
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  focusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 5,
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
