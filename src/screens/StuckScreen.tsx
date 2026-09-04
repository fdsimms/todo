import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useProjectStore } from '../store/useProjectStore';
import { resolvePerson } from '../utils/peopleRegistry';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { TaskEditor } from '../components/TaskEditor';
import { TaskBreakdownSheet } from '../components/TaskBreakdownSheet';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { TaskGroupTray } from '../components/TaskGroupTray';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { PostponeCheckActions, type PostponeCheckAction } from '../components/PostponeCheckBanner';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, lineHeight, fontWeight, iconSize, radius, border, checkboxRadius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor, isTaskBlocked } from '../utils/visibilityUtils';
import { describeBlockerWait } from '../utils/blockerStatus';
import { asksOnCompletion } from '../utils/deliverables';
import { formatTaskDate, getCurrentDayStart } from '../utils/dateUtils';
import type { DriftEntry } from '../utils/postpone';
import type { Person, Task } from '../types';

const CHECKBOX_SIZE = 22;

/**
 * Everything that has stopped moving, in one place.
 *
 * This was two menu rows and two screens, Waiting and Drift, and `DriftScreen`
 * opened by describing itself as "the same shape and same reasoning as
 * WaitingScreen" — both were drawer-only lists of tasks deliberately held out
 * of Today, Later, Unscheduled and Inbox alike, each row offering the one
 * action that ends the hold. Two rows in a menu for one question is what made
 * that menu eighteen rows long, so they are two sections of one screen now.
 *
 * The two halves differ in **who is holding the task**, which is exactly what
 * the section headings say:
 *
 * - *Waiting* is held by something outside you: another task, or a person you
 *   have asked for something. It ends when that finishes, or when you release
 *   it by hand. Grouped by blocker rather than listed flat, because the useful
 *   question is "what's queued behind this?" and a run of tasks under one
 *   heading answers it in a way a sorted list of individual waiters doesn't.
 * - *Drifting* is held by you: a task you keep moving instead of doing. It
 *   needs a decision, not a release, so its rows carry the picker's own four
 *   ways out through the shared `PostponeCheckActions` rather than a second
 *   answer to the same question.
 *
 * Framing, deliberately, and inherited from `DriftScreen` unchanged: "needs a
 * decision", never "you failed at these". Every row is a task the user chose
 * to keep, and a screen that mostly reads as an accusation is one that gets
 * opened once. That is also why nothing here sorts in a way that rewards the
 * app for finding more of them, and why the menu row carries no count badge —
 * a number in the menu is a running tally of your own backlog, on screen
 * whether or not you came to look at it.
 *
 * Backfill was the third row grouped with these two and is deliberately not
 * here: it is not a task list at all. It fills in empty fields across tasks,
 * categories, projects, people and grocery items, so it moved to Settings,
 * where the app's other maintenance tools live.
 */

/**
 * One waiting heading and the tasks under it. Two kinds, because there are two
 * things a task can be held by — see `Task.waitingOnPersonId` for how they
 * differ.
 */
type WaitSection =
  | { kind: 'task'; key: string; blocker: Task; data: Task[] }
  | { kind: 'person'; key: string; person: Person; data: Task[] };

/**
 * What the one list actually holds. A heading is a row rather than a
 * `SectionList` section because the two halves render nothing alike — a
 * waiting entry is a whole tray of cards and a drifting entry is a single row
 * with an action strip — and `SectionList`'s per-section `renderItem` would be
 * this same union with extra ceremony around it.
 */
type StuckRow =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'wait'; key: string; section: WaitSection }
  | { kind: 'drift'; key: string; entry: DriftEntry };

/**
 * Noon on the logical today, matching what WhenPicker's Today chip writes — a
 * date parked at midday can't be dragged across a day boundary by a timezone
 * or a DST hour, which is what "do it today" must not do on the one screen
 * about dates being wrong.
 */
const noonToday = () => {
  const n = getCurrentDayStart();
  n.setHours(12, 0, 0, 0);
  return n;
};

/** The category chip's text — emoji-prefixed where the category has one, as everywhere else. */
function labelForCategory(
  category: string | null,
  getCategoryByName: (name: string) => { emoji?: string | null } | undefined | null,
): string | null {
  if (!category) return null;
  const emoji = getCategoryByName(category)?.emoji;
  return emoji ? `${emoji} ${category}` : category;
}

export function StuckScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const tabBarHeight = useBottomTabBarHeight();

  const waitingTasks = useTaskStore(useShallow(s => s.waitingTasks()));
  // Selected as the raw, stable Task[] rather than s.driftingTasks()'s
  // DriftEntry[] — that method rebuilds a fresh {task, count, since} wrapper
  // per task on every call, which useShallow can never find equal to the
  // previous render's, so the store re-notified on every render and the screen
  // spun into "Maximum update depth exceeded" (#1626). The wrapper objects are
  // built once here instead, memoized on the task list itself.
  const driftingTaskList = useTaskStore(useShallow(s => s.driftingTaskList()));
  const driftEntries = useMemo<DriftEntry[]>(
    () => driftingTaskList.map(task => ({ task, count: task.postponeCount, since: task.driftingSince })),
    [driftingTaskList],
  );
  // Subscribed so the waiting sections rebuild when somebody is archived or
  // deleted — either frees their waiters (see canWaitOn), and a stale list
  // would keep showing a heading for a person who no longer holds anything.
  const people = usePersonStore(useShallow(s => s.people));
  const tasks = useTaskStore(s => s.tasks);
  const updateTask = useTaskStore(s => s.updateTask);
  const completeTask = useTaskStore(s => s.completeTask);
  const archiveTask = useTaskStore(s => s.archiveTask);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const threshold = useSettingsStore(s => s.postponeCheckThreshold);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const projects = useProjectStore(useShallow(s => s.projects));
  const projectTitlesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects],
  );
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [breakdownId, setBreakdownId] = useState<string | null>(null);
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
  const waitSections = useMemo(() => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const byTask = new Map<string, WaitSection>();
    const byPerson = new Map<string, WaitSection>();
    for (const task of waitingTasks) {
      // A task can be held by both at once. It is filed under the blocker task,
      // because that is the wait that ends on its own — listing it under the
      // person too would show one row twice and offer to release it from a
      // wait that isn't the one actually holding it.
      if (task.blockedById) {
        const blocker = byId.get(task.blockedById);
        if (!blocker) continue;
        const key = task.blockedById;
        if (!byTask.has(key)) byTask.set(key, { kind: 'task', key, blocker, data: [] });
        byTask.get(key)!.data.push(task);
        continue;
      }
      const person = task.waitingOnPersonId ? resolvePerson(task.waitingOnPersonId) : undefined;
      if (!person) continue;
      const key = person.id;
      if (!byPerson.has(key)) byPerson.set(key, { kind: 'person', key, person, data: [] });
      byPerson.get(key)!.data.push(task);
    }
    // Tasks first, then people in the user's own People order. Deliberately not
    // interleaved: the two answer the same question but there is no shared key
    // to sort a task and a person by, and inventing one would mean ranking
    // people against tasks.
    return [
      ...Array.from(byTask.values()),
      ...Array.from(byPerson.values()).sort((a, b) =>
        (a.kind === 'person' ? a.person.sortOrder : 0) - (b.kind === 'person' ? b.person.sortOrder : 0)),
    ];
  }, [waitingTasks, tasks, people]);

  /**
   * A heading is emitted only for a half that has something in it, so a screen
   * holding only drifting tasks doesn't carry an empty "Waiting" label — and a
   * screen holding both still says which rows are which, which is the whole
   * reason the two halves can share one screen.
   */
  const rows = useMemo<StuckRow[]>(() => {
    const out: StuckRow[] = [];
    if (waitSections.length > 0) {
      out.push({ kind: 'heading', key: 'h:waiting', label: 'Waiting' });
      for (const section of waitSections) {
        out.push({ kind: 'wait', key: `wait:${section.kind}:${section.key}`, section });
      }
    }
    if (driftEntries.length > 0) {
      out.push({ kind: 'heading', key: 'h:drifting', label: 'Drifting' });
      for (const entry of driftEntries) {
        out.push({ kind: 'drift', key: `drift:${entry.task.id}`, entry });
      }
    }
    return out;
  }, [waitSections, driftEntries]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (waitingTasks.length > 0) parts.push(`${waitingTasks.length} waiting`);
    if (driftEntries.length > 0) parts.push(`${driftEntries.length} drifting`);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }, [waitingTasks.length, driftEntries.length]);

  const release = (task: Task) => {
    haptics.tap();
    animateLayout();
    // Both, always: a task held by a person and a task alike leaves this screen
    // by the same button, and clearing only the one the row happened to be
    // filed under would leave it waiting on the other with nothing on screen.
    updateTask(task.id, { blockedById: null, waitingOnPersonId: null });
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

  // Same fallback TaskItem makes: with a key, "Break it up" is the AI sheet;
  // without one it's the editor, where the subtask field lives.
  const breakUp = (task: Task) => {
    haptics.tap();
    if (anthropicApiKey) setBreakdownId(task.id);
    else openEditor(task);
  };

  const actionsFor = (task: Task): { primary: PostponeCheckAction; secondary: PostponeCheckAction[] } => ({
    primary: {
      key: 'today',
      label: 'Do it today',
      // Dating it to today is what clears the count — postponeOutcome reads a
      // pull back to today as 'resolved' — so this needs no bookkeeping of its
      // own, exactly as the picker's Today chip needs none.
      onPress: () => {
        haptics.success();
        animateLayout();
        updateTask(
          task.id,
          { dueDate: noonToday().toISOString(), deferUntil: null },
          { markSeenOnBecomeVisible: true },
        );
      },
    },
    secondary: [
      { key: 'break', label: 'Break it up', onPress: () => breakUp(task) },
      {
        key: 'drop',
        label: 'Drop it',
        onPress: () => {
          haptics.warning();
          Alert.alert(
            'Archive this task?',
            `"${displayTitleFor(task)}" moves to Archived. Nothing is deleted, and you can restore it from there whenever you like.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                // Not destructive styling, for the reason the picker's copy of
                // this gives: archiving keeps the task.
                text: 'Archive',
                onPress: () => { animateLayout(); archiveTask(task.id); },
              },
            ],
          );
        },
      },
      {
        key: 'mute',
        label: 'Stop asking',
        onPress: () => {
          haptics.tap();
          animateLayout();
          updateTask(task.id, { postponeMuted: true });
        },
      },
    ],
  });

  const renderWaitSection = (section: WaitSection) => {
    if (section.kind === 'person') {
      const name = displayNameOf(section.person);
      return (
        <TaskGroupTray>
          <View style={styles.blockerHeader}>
            {/* No checkbox: nobody completes a person, so there is no
                "finish this and release them" here. The glyph is the
                same slot a blocker that is itself blocked gets, which
                keeps every header's title column aligned. */}
            <View style={styles.checkboxSlot}>
              <Ionicons name="person-outline" size={iconSize.sm} color={colors.textTertiary} />
            </View>
            <TouchableOpacity
              style={styles.blockerBody}
              onPress={() => navigation.navigate('People', { personId: section.person.id, openPerson: Date.now() })}
              activeOpacity={interaction.activeOpacity}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Waiting on ${name}`}
              accessibilityHint="Double tap to open their page"
            >
              <Text style={styles.blockerOverline}>Waiting on</Text>
              <Text style={styles.blockerTitle} numberOfLines={2}>{name}</Text>
            </TouchableOpacity>
            {/* Deliberately no "N waiting" badge, unlike a blocker task.
                docs/arch/people.md rules out a header count about people,
                and a number under somebody's name reads as a tally
                against them rather than as a fact about your own list. */}
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
    }

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
  };

  const renderDriftRow = (entry: DriftEntry) => {
    const { primary, secondary } = actionsFor(entry.task);
    const categoryLabel = labelForCategory(entry.task.category, getCategoryByName);
    const projectTitle = entry.task.projectId ? projectTitlesById.get(entry.task.projectId) ?? null : null;
    const title = displayTitleFor(entry.task);
    return (
      <View style={styles.driftRow}>
        <TouchableOpacity
          activeOpacity={interaction.activeOpacity}
          onPress={() => openEditor(entry.task)}
          accessibilityRole="button"
          accessibilityLabel={[`Open ${title}`, categoryLabel, projectTitle].filter(Boolean).join(', ')}
        >
          <Text style={styles.driftTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.driftMeta}>
            {/* The count first because it's the fact the user has lost track
                of; the date is context for it, and absent on a run that
                started before the stamp shipped. */}
            Moved {entry.count} times
            {entry.since ? ` · first put off ${format(new Date(entry.since), 'MMM d')}` : ''}
          </Text>
          {(categoryLabel || projectTitle) && (
            <View style={styles.metaRow}>
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
          )}
        </TouchableOpacity>
        <PostponeCheckActions primary={primary} secondary={secondary} />
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Stuck" subtitle={subtitle} />

      <FlatList
        data={rows}
        keyExtractor={row => row.key}
        contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => {
          if (item.kind === 'heading') {
            return <Text style={styles.sectionHeading}>{item.label}</Text>;
          }
          if (item.kind === 'wait') return renderWaitSection(item.section);
          return renderDriftRow(item.entry);
        }}
        ListEmptyComponent={
          <EmptyState
            icon="file-tray-full-outline"
            title="Nothing is stuck"
            // Says why it can be empty on an install that has been rescheduling
            // things for years: the drift counting only starts when it starts,
            // and a blank screen otherwise reads as broken rather than as clean.
            subtitle={`Tasks waiting on another task or on somebody show up here, and so do tasks you have moved to a later day ${threshold} or more times. Counting starts from when a task is first moved, so this stays empty for a while on an existing list.`}
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
      {breakdownId && (
        <TaskBreakdownSheet
          visible
          taskId={breakdownId}
          onClose={() => setBreakdownId(null)}
        />
      )}
    </View>
  );
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
  listContent: { paddingTop: spacing.xs, paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  // The app's section header everywhere: uppercase, semibold, textSecondary.
  // `textTertiary` is the other grey and measures under the contrast bar on
  // these — see the note in CLAUDE.md on list rows.
  sectionHeading: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
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
  driftRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  driftTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  driftMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
});
