import React, { useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';
import type { Task } from '../types';

function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMMM d');
}

function formatTime(iso: string): string {
  return format(new Date(iso), 'h:mm a');
}

export function LogbookScreen() {
  const insets = useSafeAreaInsets();
  const completedTasks = useTaskStore(s => s.completedTasks());
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const sections = useMemo(() => {
    const sorted = [...completedTasks].sort(
      (a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
    );

    const grouped = new Map<string, Task[]>();
    sorted.forEach(task => {
      const key = formatDayHeader(task.completedAt!);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    });

    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [completedTasks]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Logbook</Text>
        <Text style={styles.subtitle}>{completedTasks.length} completed</Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.checkCircle}>
              <Ionicons name="checkmark" size={14} color={colors.green} />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.taskTime}>{formatTime(item.completedAt!)}</Text>
            </View>
            <TouchableOpacity
              style={styles.undoBtn}
              onPress={() => uncompleteTask(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-undo" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={52} color={colors.bgQuaternary} />
            <Text style={styles.emptyText}>No completed tasks</Text>
            <Text style={styles.emptySubtext}>Tasks you complete will appear here</Text>
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.textTertiary, fontSize: font.sm, fontWeight: '500', paddingBottom: 4 },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  listContent: { paddingBottom: 40 },
  emptyContainer: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: font.lg,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    gap: spacing.sm,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowContent: { flex: 1 },
  taskTitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    fontWeight: '400',
    textDecorationLine: 'line-through',
    textDecorationColor: colors.textTertiary,
  },
  taskTime: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: 2,
  },
  undoBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
