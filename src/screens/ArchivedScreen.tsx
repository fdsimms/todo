import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, iconSize, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

// A quiet, out-of-the-way home for recurring tasks paused indefinitely (see
// archiveTask/unarchiveTask in useTaskStore) — reached only via the side
// drawer, same as Logbook/Stats, so it stays out of the way until sought out.
export function ArchivedScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const archivedTasks = useTaskStore(useShallow(s => s.archivedTasks()));
  const unarchiveTask = useTaskStore(s => s.unarchiveTask);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  const sorted = useMemo(
    () => [...archivedTasks].sort((a, b) => new Date(b.archivedAt ?? 0).getTime() - new Date(a.archivedAt ?? 0).getTime()),
    [archivedTasks]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Archived" subtitle={`${archivedTasks.length} paused`} />

      <FlatList
        data={sorted}
        keyExtractor={item => item.id}
        contentContainerStyle={sorted.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={1}
            onPress={() => { setEditingTask(item); setEditorVisible(true); }}
          >
            <Ionicons name="archive-outline" size={18} color={colors.textTertiary} />
            <View style={styles.rowContent}>
              <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.taskMeta}>
                {item.archivedAt ? `Archived ${format(new Date(item.archivedAt), 'MMM d, yyyy')}` : 'Archived'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.unarchiveButton}
              onPress={() => {
                haptics.tap();
                animateLayout();
                unarchiveTask(item.id);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Unarchive ${item.title}`}
            >
              <Ionicons name="play-outline" size={iconSize.sm} color={colors.accent} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="archive-outline"
            title="No archived tasks"
            subtitle="Pause a recurring task without losing its history — archive it from the task editor and pick back up any time."
            bottomOffset={tabBarHeight}
          />
        }
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  rowContent: { flex: 1 },
  taskTitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    fontWeight: '400',
  },
  taskMeta: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: 2,
  },
  unarchiveButton: {
    padding: 4,
    flexShrink: 0,
  },
});
