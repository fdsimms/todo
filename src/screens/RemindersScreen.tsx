import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, lineHeight, fontWeight, iconSize, radius, interaction, type Colors } from '../theme';
import { displayTitleFor } from '../utils/visibilityUtils';
import { upcomingReminders } from '../utils/notifications';
import type { Task } from '../types';

/**
 * Every task with a reminder still ahead, across the whole app, soonest
 * first — not filtered to what Today happens to be showing.
 *
 * The "Has reminder" chip on Today/Later/Unscheduled/Inbox narrows whichever
 * list is already on screen to the tasks in it with a reminder set, which is
 * right for those screens but can't answer "what's coming up" on its own: a
 * reminder set three weeks out sits on a day none of those views are showing
 * today, so it never appears in any of them. This screen is the other half —
 * one flat, date-ordered list of every reminder there is, reusing the exact
 * eligibility rule (`upcomingReminders`) the app already schedules real
 * notifications from, so "what will ring" and "what's listed here" can't
 * drift apart.
 */
export function RemindersScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const tasks = useTaskStore(useShallow(s => s.tasks));
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const projects = useProjectStore(useShallow(s => s.projects));
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  const reminders = useMemo(() => upcomingReminders(tasks), [tasks]);

  const projectTitlesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects],
  );

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Reminders"
        subtitle={
          reminders.length === 0
            ? undefined
            : `${reminders.length} upcoming`
        }
      />

      <FlatList
        data={reminders}
        keyExtractor={item => item.id}
        contentContainerStyle={reminders.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => (
          <ReminderRow
            task={item}
            categoryLabel={labelForCategory(item.category, getCategoryByName)}
            projectTitle={item.projectId ? projectTitlesById.get(item.projectId) ?? null : null}
            onPress={() => openEditor(item)}
            styles={styles}
            colors={colors}
            cardShadow={shadows.card}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="alarm-outline"
            title="No reminders set"
            subtitle="Tasks with a reminder or alarm show up here, soonest first, whatever day they're on."
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

/** The category chip's text — emoji-prefixed where the category has one, as everywhere else. */
function labelForCategory(
  category: string | null,
  getCategoryByName: (name: string) => { emoji?: string | null } | undefined | null,
): string | null {
  if (!category) return null;
  const emoji = getCategoryByName(category)?.emoji;
  return emoji ? `${emoji} ${category}` : category;
}

interface RowProps {
  task: Task;
  categoryLabel: string | null;
  projectTitle: string | null;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  cardShadow: object;
}

function ReminderRow({ task, categoryLabel, projectTitle, onPress, styles, colors, cardShadow }: RowProps) {
  const title = displayTitleFor(task);
  // reminderTime is guaranteed set by upcomingReminders' own filter.
  const when = format(new Date(task.reminderTime!), 'EEE, MMM d · h:mm a');

  return (
    <TouchableOpacity
      style={[styles.card, cardShadow]}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessible
      accessibilityRole="button"
      accessibilityLabel={[title, when, categoryLabel, projectTitle].filter(Boolean).join(', ')}
      accessibilityHint="Double tap to open task"
    >
      <View style={styles.cardBody}>
        <Text style={styles.taskTitle} numberOfLines={2}>{title}</Text>
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons name="alarm-outline" size={iconSize.xs} color={colors.textSecondary} />
            <Text style={styles.metaText} numberOfLines={1}>{when}</Text>
          </View>
          {categoryLabel && (
            <View style={styles.metaChip}>
              <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={styles.metaText} numberOfLines={1}>{categoryLabel}</Text>
            </View>
          )}
          {projectTitle && (
            <View style={styles.metaChip}>
              <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={styles.metaText} numberOfLines={1}>{projectTitle}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingTop: 2, paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  // The same inset-grouped card footprint as TaskItem rows / ArchivedScreen's.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  cardBody: { flex: 1, minWidth: 0 },
  taskTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
});
