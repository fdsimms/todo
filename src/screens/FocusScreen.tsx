import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { FocusSelector } from '../components/FocusSelector';
import { colors, spacing, font, radius } from '../theme';
import type { Task } from '../types';

export function FocusScreen() {
  const insets = useSafeAreaInsets();
  const focusedTasks = useTaskStore(s => s.focusedTasks());
  const allTasks = useTaskStore(s => s.tasks);
  const clearAllFocus = useTaskStore(s => s.clearAllFocus);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectorVisible, setSelectorVisible] = useState(false);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Focus</Text>
          {focusedTasks.length > 0 && (
            <Text style={styles.subtitle}>{focusedTasks.length} task{focusedTasks.length !== 1 ? 's' : ''}</Text>
          )}
        </View>
        <View style={styles.headerButtons}>
          {focusedTasks.length > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearAllFocus}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.selectBtn}
            onPress={() => setSelectorVisible(true)}
          >
            <Ionicons name="add" size={16} color={colors.text} />
            <Text style={styles.selectText}>Select</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={focusedTasks}
        keyExtractor={t => t.id}
        renderItem={({ item }) => {
          const subs = allTasks.filter(t => t.parentId === item.id);
          return (
            <TaskItem
              task={item}
              onPress={() => openEditor(item)}
              subtaskCount={subs.length}
              subtaskDoneCount={subs.filter(t => t.completed).length}
            />
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="star" size={52} color={colors.bgQuaternary} />
            <Text style={styles.emptyTitle}>No focus set</Text>
            <Text style={styles.emptyText}>
              Tap "Select" to pick a few tasks to focus on.{'\n'}
              Or star any task from the Today list.
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => setSelectorVisible(true)}
            >
              <Text style={styles.emptyBtnText}>Select tasks</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <FocusSelector
        visible={selectorVisible}
        onClose={() => setSelectorVisible(false)}
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.sm,
  },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.textTertiary, fontSize: font.sm, marginTop: 2 },
  headerButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  clearBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  clearText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  selectText: { color: colors.text, fontSize: font.sm, fontWeight: '600' },
  empty: {
    alignItems: 'center', paddingTop: 100, paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textSecondary, fontSize: font.lg, fontWeight: '600',
    marginTop: spacing.md,
  },
  emptyText: {
    color: colors.textTertiary, fontSize: font.sm, textAlign: 'center', lineHeight: 21,
  },
  emptyBtn: {
    marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  emptyBtnText: { color: colors.text, fontSize: font.md, fontWeight: '600' },
});
