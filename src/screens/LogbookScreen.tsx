import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { isYesterday } from 'date-fns/isYesterday';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { LogbookEntryMenu } from '../components/LogbookEntryMenu';
import { SwipeableRow } from '../components/SwipeableRow';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

interface LogbookSection {
  title: string;
  dateKey: string;
  data: Task[];
}

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
  const tabBarHeight = useBottomTabBarHeight();
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const clearLogbook = useTaskStore(s => s.clearLogbook);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [menuTask, setMenuTask] = useState<Task | null>(null);

  const handleClearLogbook = () => {
    haptics.warning();
    Alert.alert(
      'Clear Logbook',
      `Delete all ${completedTasks.length} completed task${completedTasks.length === 1 ? '' : 's'} from the logbook? This can be undone with shake-to-undo.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            clearLogbook();
          },
        },
      ]
    );
  };

  const sections = useMemo((): LogbookSection[] => {
    const sorted = [...completedTasks].sort(
      (a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
    );

    const grouped = new Map<string, Task[]>();
    sorted.forEach(task => {
      const key = format(new Date(task.completedAt!), 'yyyy-MM-dd');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    });

    return Array.from(grouped.entries()).map(([dateKey, data]) => ({
      title: formatDayHeader(data[0].completedAt!),
      dateKey,
      data,
    }));
  }, [completedTasks]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Logbook"
        subtitle={`${completedTasks.length} completed`}
        actions={completedTasks.length > 0 ? [
          {
            icon: 'trash-outline',
            onPress: handleClearLogbook,
            accessibilityLabel: 'Clear logbook',
          },
        ] : undefined}
      />

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
          // Swipe right to move when it was completed — the same "when" slot
          // tasks use for rescheduling. No select side: there's no bulk mode
          // here, and "complete" would mean nothing to a completed row.
          // Square corners: these rows are deliberately flat and full-bleed
          // (see styles.row), so the panel shouldn't be rounded like a card.
          <SwipeableRow
            style={styles.rowSwipe}
            whenAction={{
              icon: 'calendar-outline',
              onAction: () => setMenuTask(item),
              accessibilityLabel: `Change when ${item.title} was completed`,
            }}
          >
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.checkCircle}
                onPress={() => {
                  haptics.tap();
                  animateLayout();
                  uncompleteTask(item.id);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: true }}
                accessibilityLabel={`Mark ${item.title} as not done`}
              >
                <Ionicons name="checkmark" size={14} color={colors.green} />
              </TouchableOpacity>
              <View
                style={styles.rowContent}
                accessible
                accessibilityLabel={`${item.title}, completed ${formatTime(item.completedAt!)}`}
              >
                <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.taskTime}>{formatTime(item.completedAt!)}</Text>
              </View>
              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => setMenuTask(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`More options for ${item.title}`}
              >
                <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </SwipeableRow>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="book-outline"
            title="No completed tasks"
            subtitle="Tasks you complete will appear here"
            bottomOffset={tabBarHeight}
          />
        }
      />

      <LogbookEntryMenu
        visible={!!menuTask}
        value={menuTask?.completedAt ? new Date(menuTask.completedAt) : null}
        onMarkIncomplete={() => {
          if (menuTask) {
            animateLayout();
            uncompleteTask(menuTask.id);
          }
          setMenuTask(null);
        }}
        onChangeDate={date => {
          if (menuTask) {
            animateLayout();
            updateTask(menuTask.id, { completedAt: date.toISOString() });
          }
          setMenuTask(null);
        }}
        onClose={() => setMenuTask(null)}
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
  rowSwipe: { borderRadius: 0 },
  // Deliberately flat, not the inset-grouped card TaskItem rows use — a
  // completed entry isn't draggable or tappable-to-edit like a live task,
  // so it shouldn't be styled to invite that interaction.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
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
  },
  taskTime: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: 2,
  },
  menuButton: {
    padding: 4,
    flexShrink: 0,
  },
});
