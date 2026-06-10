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
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
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
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
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
      <ScreenHeader title="Logbook" subtitle={`${completedTasks.length} completed`} />

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
            <TouchableOpacity
              style={styles.checkCircle}
              onPress={() => {
                haptics.tap();
                animateLayout();
                uncompleteTask(item.id);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="checkmark" size={14} color={colors.green} />
            </TouchableOpacity>
            <View style={styles.rowContent}>
              <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.taskTime}>{formatTime(item.completedAt!)}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="book-outline"
            title="No completed tasks"
            subtitle="Tasks you complete will appear here"
          />
        }
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  listContent: { paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  // Same inset-grouped card footprint as TaskItem rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
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
});
