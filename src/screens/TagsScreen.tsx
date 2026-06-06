import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const tagTasks = selectedTag ? tasksByTag(selectedTag) : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Tags</Text>
      </View>

      {allTags.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="pricetag" size={48} color={colors.bgQuaternary} />
          <Text style={styles.emptyText}>No tags yet</Text>
          <Text style={styles.emptySubtext}>Add tags to tasks to organize them here</Text>
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

          <FlatList
            data={tagTasks}
            keyExtractor={t => t.id}
            renderItem={({ item }) => (
              <TaskItem task={item} onPress={() => openEditor(item)} />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptySubtext}>No active tasks with this tag</Text>
              </View>
            }
          />
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
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
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 36 + spacing.md,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 100,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: font.lg,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
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
