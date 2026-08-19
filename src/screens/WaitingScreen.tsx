import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskEditor } from '../components/TaskEditor';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { TaskGroupTray } from '../components/TaskGroupTray';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, lineHeight, fontWeight, iconSize, radius, border, checkboxRadius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor, isTaskBlocked } from '../utils/visibilityUtils';
import { describeBlockerWait } from '../utils/blockerStatus';
import { asksOnCompletion } from '../utils/deliverables';
import { formatTaskDate } from '../utils/dateUtils';
import type { Task } from '../types';

const CHECKBOX_SIZE = 22;

// Where a task lives while it's waiting on another one (see Task.blockedById).
// A blocked task is absent from Today, Later, Unscheduled and Inbox alike — it
// has no date to place it on and isn't actionable yet — so it needs somewhere
// to be seen and managed. Same shape and same reasoning as ArchivedScreen: a
// drawer-only screen for tasks deliberately held out of the daily lists.
//
// Grouped by blocker rather than listed flat: the useful question here is
// "what's queued behind this?", and a run of tasks under one heading answers it
// in a way a sorted list of individual waiters doesn't.
//
// The heading is a tray rather than a caption band because it now carries the
// answer to the screen's other question — *when* the run gets released — plus
// the one action that releases it. Enclosure is what says the cards belong to
// it (see TaskGroupTray, which this borrows wholesale rather than restating);
// giving the header a card of its own is the version that reads as a selected
// row, and was tried and rejected there.
export function WaitingScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const waitingTasks = useTaskStore(useShallow(s => s.waitingTasks()));
  const tasks = useTaskStore(s => s.tasks);
  const updateTask = useTaskStore(s => s.updateTask);
  const completeTask = useTaskStore(s => s.completeTask);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  // The blocker whose completion is waiting on an answer — a task that asks
  // one when it's ticked off (Task.deliverableKind) must ask here too, or
  // finishing it from this screen quietly loses the answer.
  const [promptTask, setPromptTask] = useState<Task | null>(null);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  // waitingTasks already sorts by blockedById, so equal keys arrive adjacent
  // and this only has to break the runs apart.
  //
  // The blocker is always resolvable: isWaitingTask gates on isTaskBlocked,
  // which resolves it through canBlock — a blocker that is deleted, completed
  // or archived frees its waiters rather than stranding them, so there is no
  // "waiting on nothing" state for this list to render.
  const sections = useMemo(() => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const grouped = new Map<string, { blockerId: string; blocker: Task; data: Task[] }>();
    for (const task of waitingTasks) {
      const blockerId = task.blockedById!;
      const blocker = byId.get(blockerId);
      if (!blocker) continue;
      if (!grouped.has(blockerId)) grouped.set(blockerId, { blockerId, blocker, data: [] });
      grouped.get(blockerId)!.data.push(task);
    }
    return Array.from(grouped.values());
  }, [waitingTasks, tasks]);

  const release = (task: Task) => {
    haptics.tap();
    animateLayout();
    updateTask(task.id, { blockedById: null });
  };

  const finishBlocker = (blocker: Task) => {
    if (asksOnCompletion(blocker)) {
      haptics.tap();
      setPromptTask(blocker);
      return;
    }
    haptics.success();
    animateLayout();
    completeTask(blocker.id);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Waiting"
        subtitle={
          waitingTasks.length === 0
            ? undefined
            : `${waitingTasks.length} ${waitingTasks.length === 1 ? 'task' : 'tasks'} blocked`
        }
      />

      <FlatList
        data={sections}
        keyExtractor={section => section.blockerId}
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item: section }) => {
          const blockerTitle = displayTitleFor(section.blocker);
          // A blocker waiting on something else can't be ticked off from here:
          // it isn't actionable yet, which is the whole meaning of being
          // blocked, and every list in the app already refuses to show it as
          // work. Its slot carries the same hourglass its own row does, so the
          // header still lines up with the ones that do offer the box.
          const blockedItself = isTaskBlocked(section.blocker);
          const wait = describeBlockerWait(section.blocker, { blockedItself, dayResetTime });
          return (
            <TaskGroupTray>
              <View style={styles.blockerHeader}>
                {blockedItself ? (
                  <View style={styles.checkboxSlot}>
                    <Ionicons name="hourglass-outline" size={iconSize.sm} color={colors.textTertiary} />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.checkbox}
                    onPress={() => finishBlocker(section.blocker)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false }}
                    accessibilityLabel={`Complete ${blockerTitle}, releasing ${section.data.length} ${section.data.length === 1 ? 'task' : 'tasks'}`}
                  />
                )}
                <TouchableOpacity
                  style={styles.blockerBody}
                  onPress={() => openEditor(section.blocker)}
                  activeOpacity={interaction.activeOpacity}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Waiting on ${blockerTitle}, ${wait.text}`}
                  accessibilityHint="Double tap to open the blocking task"
                >
                  <Text style={styles.blockerOverline}>Waiting on</Text>
                  <Text style={styles.blockerTitle} numberOfLines={2}>{blockerTitle}</Text>
                  <Text style={[styles.blockerWhen, wait.late && styles.blockerWhenLate]} numberOfLines={1}>
                    {wait.text}
                  </Text>
                </TouchableOpacity>
                <View style={styles.waitCount}>
                  <Text style={styles.waitCountText}>{section.data.length} waiting</Text>
                </View>
              </View>

              <View style={styles.trayBody}>
                {section.data.map(task => (
                  <WaiterRow
                    key={task.id}
                    task={task}
                    categoryLabel={labelForCategory(task.category, getCategoryByName)}
                    dateLabel={formatTaskDate(task, dayResetTime)}
                    onPress={() => openEditor(task)}
                    onRelease={() => release(task)}
                    styles={styles}
                    colors={colors}
                    cardShadow={shadows.card}
                  />
                ))}
              </View>
            </TaskGroupTray>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="hourglass-outline"
            title="Nothing is waiting"
            subtitle="Set a task to wait on another one from the task editor, and it stays out of your lists until that task is done."
            bottomOffset={tabBarHeight}
          />
        }
      />

      {promptTask && (
        <DeliverablePromptSheet
          visible
          task={promptTask}
          onConfirm={value => {
            const id = promptTask.id;
            setPromptTask(null);
            animateLayout();
            completeTask(id, { deliverableValue: value });
          }}
          // Same as the row's: cancelling takes the tap back rather than
          // completing the task with no answer.
          onCancel={() => setPromptTask(null)}
        />
      )}

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

interface WaiterRowProps {
  task: Task;
  categoryLabel: string | null;
  dateLabel: string | null;
  onPress: () => void;
  onRelease: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  cardShadow: object;
}

function WaiterRow({ task, categoryLabel, dateLabel, onPress, onRelease, styles, colors, cardShadow }: WaiterRowProps) {
  const title = displayTitleFor(task);
  return (
    <View style={[styles.card, cardShadow]}>
      <TouchableOpacity
        style={styles.cardBody}
        onPress={onPress}
        activeOpacity={interaction.activeOpacity}
        accessible
        accessibilityRole="button"
        accessibilityLabel={[title, categoryLabel, dateLabel].filter(Boolean).join(', ')}
        accessibilityHint="Double tap to open task"
      >
        <Text style={styles.taskTitle} numberOfLines={2}>{title}</Text>
        {(categoryLabel || dateLabel) && (
          <View style={styles.metaRow}>
            {categoryLabel && (
              <View style={styles.metaChip}>
                <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.metaText} numberOfLines={1}>{categoryLabel}</Text>
              </View>
            )}
            {dateLabel && (
              <View style={styles.metaChip}>
                <Ionicons name="calendar-outline" size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.metaText} numberOfLines={1}>{dateLabel}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.releaseButton}
        onPress={onRelease}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`Stop ${title} waiting`}
      >
        <Ionicons name="arrow-forward" size={iconSize.sm} color={colors.accent} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingTop: spacing.sm, paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  blockerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  // The blocker's own completion box, drawn the same way TaskItem draws one —
  // a rounded square in the completion green, empty because a blocker that
  // was ticked wouldn't be blocking anything and the section would be gone.
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.green,
    flexShrink: 0,
  },
  checkboxSlot: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  blockerBody: { flex: 1, minWidth: 0 },
  blockerOverline: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  blockerTitle: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
  },
  blockerWhen: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  // Orange is reserved for the one date a task can actually be late for — see
  // describeBlockerWait, which only ever sets `late` for a blown deadline.
  blockerWhenLate: { color: colors.orange, fontWeight: fontWeight.medium },
  waitCount: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    flexShrink: 0,
  },
  waitCountText: { color: colors.textSecondary, fontSize: font.xs },
  // The gap under the last card, matching TaskGroupTray's own convention of
  // keeping vertical padding on the body rather than on the tray.
  trayBody: { paddingBottom: spacing.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md - 2,
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
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },
  releaseButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
