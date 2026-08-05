import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
  StyleSheet,
  Alert,
  Keyboard,
  LayoutChangeEvent,
  Linking,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
  Extrapolation,
} from 'react-native-reanimated';
import { Swipeable } from 'react-native-gesture-handler';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../types';
import { PRIORITY_COLORS, TITLE_MAX_LENGTH } from '../types';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, animation, interaction, type Colors } from '../theme';
import { formatDueDate, formatHHMM, formatWindowRemaining, getDeadlineCountdown } from '../utils/dateUtils';
import { formatDuration, formatStopwatch } from '../utils/effort';
import { isTaskWindowActive, isTaskExpired, isRecurrenceNotYetDue, isTaskNew } from '../utils/visibilityUtils';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { WhenPicker } from './WhenPicker';
import { PressableScale } from './PressableScale';
import { SortableList } from './SortableList';
import { SpotlightScrim, useSpotlightLinger } from './SpotlightOverlay';

interface Props {
  task: Task;
  onPress: () => void;
  onEdit?: () => void;
  expanded?: boolean;
  subtaskCount?: number;
  subtaskDoneCount?: number;
  subtasks?: Task[];
  drag?: () => void;
  isActive?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onSwipeSelect?: () => void;
  spotlightDisabled?: boolean;
  hideTodayLabel?: boolean;
  showCategory?: boolean;
  showProject?: boolean;
  showActions?: boolean;
  /** Extra left indent for a group's expanded children, so they read as nested under the group header rather than as ordinary top-level rows. */
  indented?: boolean;
  /** Briefly tints the row on mount to draw the eye to a task that was just created. */
  justCreated?: boolean;
  /** Plays the same checkbox-tap complete animation as a real tap, then completes the task — used for a completion that happened in the Today widget so the user can watch it happen here too. */
  autoComplete?: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Steps shown on each side of the active chain step before truncating with '…'.
const CHAIN_PREVIEW_RADIUS = 2;

const MONTH_DAY_SUFFIXES: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd', 21: 'st', 22: 'nd', 23: 'rd', 31: 'st' };
function ordinalMonthDay(n: number): string {
  return `${n}${MONTH_DAY_SUFFIXES[n] ?? 'th'}`;
}

function describeRecurrence(task: Task): string {
  const { recurrenceType, recurrenceInterval, recurrenceDays, recurrenceMonthDay, recurrenceFromCompletion } = task;
  let text = '';
  if (recurrenceType === 'daily') {
    text = recurrenceInterval === 1 ? 'Daily' : `Every ${recurrenceInterval} days`;
  } else if (recurrenceType === 'weekly') {
    const dayStr = recurrenceDays.map(d => DAY_NAMES[d]).join(', ');
    const base = recurrenceInterval === 1 ? 'Weekly' : `Every ${recurrenceInterval} weeks`;
    text = dayStr ? `${base} on ${dayStr}` : base;
  } else if (recurrenceType === 'monthly') {
    const base = recurrenceInterval === 1 ? 'Monthly' : `Every ${recurrenceInterval} months`;
    text = recurrenceMonthDay === -1
      ? 'Monthly on the last day'
      : recurrenceMonthDay
        ? `Monthly on the ${ordinalMonthDay(recurrenceMonthDay)}`
        : base;
  } else if (recurrenceType === 'yearly') {
    text = recurrenceInterval === 1 ? 'Yearly' : `Every ${recurrenceInterval} years`;
  }
  if (recurrenceFromCompletion) text += ' · from completion';
  return text;
}

export function TaskItem({
  task,
  onPress,
  onEdit,
  expanded = false,
  subtaskCount = 0,
  subtaskDoneCount = 0,
  subtasks = [],
  drag,
  isActive = false,
  selectionMode = false,
  selected = false,
  onSelect,
  onSwipeSelect,
  spotlightDisabled = false,
  hideTodayLabel = false,
  showCategory = false,
  showProject = false,
  showActions = true,
  indented = false,
  justCreated = false,
  autoComplete = false,
}: Props) {
  const categoryEmoji = useCategoryStore(s => task.category ? s.getCategoryByName(task.category)?.emoji ?? null : null);
  const projectTitle = useProjectStore(s => task.projectId ? s.getProjectById(task.projectId)?.title ?? null : null);
  const completeTask = useTaskStore(s => s.completeTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const markTaskSeen = useTaskStore(s => s.markTaskSeen);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const togglePin = useTaskStore(s => s.togglePin);
  const startTimer = useTaskStore(s => s.startTimer);
  const stopTimer = useTaskStore(s => s.stopTimer);
  const discardTimer = useTaskStore(s => s.discardTimer);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const deleteSubtask = useTaskStore(s => s.deleteSubtask);
  const reorderSubtasks = useTaskStore(s => s.reorderSubtasks);
  const duplicateTask = useTaskStore(s => s.duplicateTask);
  const handleOpenLink = async () => {
    if (!task.linkUrl) return;
    haptics.tap();
    try {
      const supported = await Linking.canOpenURL(task.linkUrl);
      if (supported) await Linking.openURL(task.linkUrl);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const [showWhenPicker, setShowWhenPicker] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [subtaskTitleEdit, setSubtaskTitleEdit] = useState('');
  // Natural height of the expansion panel content, measured off-screen so the
  // expansion can animate to the real height instead of an arbitrary cap.
  const [panelHeight, setPanelHeight] = useState(0);
  // Drives the live-counting timer display. We only re-render on a 1s tick while
  // this task's timer is actually running, so idle rows never spin an interval.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const timerRunning = task.timerStartedAt !== null;
  const completingRef = useRef(false);
  const completeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const circleScale = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  // Drives the whole row's height to 0 once the completion fade finishes, so
  // the space it took up collapses right away instead of sitting there
  // invisible for the rest of completeTask's completionHoldIds window (see
  // useTaskStore) — that hold keeps the row mounted briefly so a burst of
  // completions doesn't reflow the list after every tap, but with no
  // visual collapse of its own it just reads as the app freezing. Runs on the
  // UI thread for the same reason the expand panel below does: a JS-driven
  // height change stutters once other rows have to re-layout under it.
  const collapseProgress = useSharedValue(1);
  const collapseStartedRef = useRef(false);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  // Tints the row briefly right after it mounts as the result of task
  // creation, so the user can tell which row is the one that just appeared.
  const highlightOpacity = useRef(new Animated.Value(justCreated && !reduceMotion ? 0.35 : 0)).current;
  // Reanimated (UI-thread) shared value drives the expand/collapse. The panel
  // animates `height`, which forces a re-layout of every row below it on each
  // frame — doing that from a JS-thread Animated.Value stutters once the list
  // is long and the JS thread is busy, which is what made the collapse read as
  // two discrete steps. Running it on the UI thread keeps it smooth regardless
  // of how many tasks sit below.
  const expansionProgress = useSharedValue(expanded ? 1 : 0);
  // The spotlighted row stays bright while the rest of the screen dims, and
  // has to keep doing so until the mask has faded back out — dropping the
  // exemption the moment it collapses would flash a scrim over it at full
  // strength and fade *that* out instead.
  const isSpotlighted = useSpotlightLinger(expanded);
  const swipeableRef = useRef<Swipeable>(null);
  const titleInputRef = useRef<TextInput>(null);
  const subtaskTitleInputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Timing rather than a spring: a spring is underdamped, so it overshoots
    // past 0 on collapse (clamped by the height interpolation), which reads as
    // a jitter at the end. inOut easing accelerates and decelerates so the
    // height change settles as one continuous motion.
    expansionProgress.value = withTiming(expanded ? 1 : 0, {
      duration: animation.duration.normal,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [expanded]);

  // Height interpolates to the measured panel height; opacity fades only in the
  // first sliver next to the closed state, so the bulk of the motion is a clean
  // height change rather than a half-duration cross-fade overlapping the shrink
  // (the latter is what made collapse look like two separate phases).
  const expandedPanelStyle = useAnimatedStyle(() => ({
    height: interpolate(expansionProgress.value, [0, 1], [0, panelHeight], Extrapolation.CLAMP),
    opacity: interpolate(expansionProgress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  // Left at `{}` (auto height) until a completion actually starts collapsing
  // the row — locking in `rowHeight` any earlier would clip normal content
  // changes (expanding notes, adding subtasks, etc).
  const collapseStyle = useAnimatedStyle(() => {
    if (rowHeight === null || collapseProgress.value >= 1) return {};
    return {
      height: interpolate(collapseProgress.value, [0, 1], [0, rowHeight], Extrapolation.CLAMP),
      overflow: 'hidden' as const,
    };
  });

  const handleItemLayout = (e: LayoutChangeEvent) => {
    if (!collapseStartedRef.current) setRowHeight(e.nativeEvent.layout.height);
  };

  useEffect(() => {
    if (isActive) {
      haptics.impactMedium();
    }
  }, [isActive]);

  useEffect(() => {
    if (!justCreated || reduceMotion) return;
    Animated.timing(highlightOpacity, {
      toValue: 0,
      duration: animation.duration.slow,
      delay: 350,
      useNativeDriver: true,
    }).start();
  }, [justCreated]);

  // Tick once a second only while this task's timer runs, so the elapsed clock
  // updates live without keeping an interval alive on every idle row.
  useEffect(() => {
    if (!timerRunning) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timerRunning, task.timerStartedAt]);

  const elapsedSeconds = timerRunning
    ? Math.max(0, (nowTick - new Date(task.timerStartedAt as string).getTime()) / 1000)
    : 0;

  const handleTimerToggle = async () => {
    if (timerRunning) {
      await haptics.success();
      stopTimer(task.id);
    } else {
      await haptics.impactMedium();
      startTimer(task.id);
    }
  };

  const handleDiscardTimer = () => {
    Alert.alert(
      'Discard Timer',
      `Discard the running timer for "${task.title}"? The elapsed time won't be saved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await haptics.warning();
            discardTimer(task.id);
          },
        },
      ]
    );
  };

  // Save and dismiss keyboard whenever the task collapses while title is being edited
  useEffect(() => {
    if (!expanded && isEditingTitle) {
      const trimmed = titleEdit.trim();
      if (trimmed && trimmed !== task.title) {
        updateTask(task.id, { title: trimmed });
      }
      setIsEditingTitle(false);
      Keyboard.dismiss();
    }
  }, [expanded, isEditingTitle]);

  const priorityColor = PRIORITY_COLORS[task.priority];
  const windowActive = isTaskWindowActive(task);
  const windowExpired = isTaskExpired(task);
  const deadlineDays = task.deadline ? getDeadlineCountdown(task.deadline) : null;
  const deadlineColor =
    deadlineDays === null ? colors.textTertiary
    : deadlineDays < 0 ? colors.red
    : deadlineDays <= 2 ? colors.orange
    : colors.textTertiary;
  const isNew = isTaskNew(task);

  const handleContentPress = () => {
    if (isNew) markTaskSeen(task.id);
    if (selectionMode) { onSelect?.(); } else { onPress(); }
  };
  // A recurring task showing early in Later (its day hasn't arrived yet)
  // can't be completed ahead of schedule — see isRecurrenceNotYetDue.
  const recurrenceNotYetDue = isRecurrenceNotYetDue(task);

  const activeChainItem =
    task.chainEnabled && task.chainItems.length > 0
      ? task.chainItems[task.chainIndex % task.chainItems.length]
      : null;
  // A multi-step chain drives the collapsed row's title: we show the current
  // step's title with a compact step-count badge beside it, instead of a
  // second subtitle line, so the row stays the same height as the others.
  const chainStep = activeChainItem && task.chainItems.length > 1 ? activeChainItem : null;
  const chainPosition = chainStep ? `${(task.chainIndex % task.chainItems.length) + 1}/${task.chainItems.length}` : '';

  const hasExpandContent =
    task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none' || activeChainItem !== null;

  const handleComplete = async () => {
    if (completingRef.current) return;
    if (recurrenceNotYetDue) {
      await haptics.error();
      return;
    }
    if (isNew) markTaskSeen(task.id);
    completingRef.current = true;
    await haptics.success();
    setCompleting(true);
    // Checkmark springs in while the circle pops, then the row fades to
    // invisible but keeps its place in the list — completeTask holds it
    // there (see useTaskStore's completionHoldIds) so completing several
    // tasks in a row doesn't reflow the list after every tap. The row only
    // collapses once completions pause for about a second. The task isn't
    // actually marked complete in the store until this sequence finishes,
    // so a tap during the window (handleUndoComplete) can cancel it outright.
    checkScale.setValue(0);
    Animated.spring(checkScale, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
    const sequence = Animated.sequence([
      Animated.spring(circleScale, { toValue: 1.35, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.spring(circleScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.delay(120),
      Animated.timing(rowOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]);
    completeAnimRef.current = sequence;
    sequence.start(({ finished }) => {
      completeAnimRef.current = null;
      if (!finished) return;
      setCompleting(false);
      completingRef.current = false;
      completeTask(task.id);
      collapseStartedRef.current = true;
      collapseProgress.value = withTiming(0, {
        duration: animation.duration.normal,
        easing: Easing.inOut(Easing.cubic),
      });
    });
  };

  // Widget checkbox taps queue a completion and open the app (see
  // useWidgetCompletionStore) rather than completing the task directly, so
  // that when Today mounts with this task still incomplete, the user sees
  // the same pop-checkmark-and-fade animation a real tap gets instead of the
  // row just silently vanishing.
  useEffect(() => {
    if (autoComplete) handleComplete();
  }, [autoComplete]);

  const handleUndoComplete = async () => {
    completeAnimRef.current?.stop();
    completeAnimRef.current = null;
    completingRef.current = false;
    await haptics.tap();
    checkScale.setValue(0);
    circleScale.setValue(1);
    rowOpacity.setValue(1);
    setCompleting(false);
    collapseStartedRef.current = false;
    collapseProgress.value = 1;
  };

  const handleTitleTap = () => {
    if (selectionMode) { onSelect?.(); return; }
    setTitleEdit(task.title);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  };

  const saveTitle = () => {
    setIsEditingTitle(false);
    const trimmed = titleEdit.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
    }
  };

  const handleSwipeSelect = () => {
    haptics.impactMedium();
    swipeableRef.current?.close();
    onSwipeSelect?.();
  };

  const handleSubtaskTitleTap = (sub: Task) => {
    setSubtaskTitleEdit(sub.title);
    setEditingSubtaskId(sub.id);
    setTimeout(() => subtaskTitleInputRef.current?.focus(), 50);
  };

  const saveSubtaskTitle = (sub: Task) => {
    setEditingSubtaskId(null);
    const trimmed = subtaskTitleEdit.trim();
    if (trimmed && trimmed !== sub.title) {
      updateTask(sub.id, { title: trimmed });
    }
  };

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.selectAction}
      onPress={handleSwipeSelect}
      accessibilityRole="button"
      accessibilityLabel={`Select ${task.title}`}
    >
      <Ionicons name="checkbox-outline" size={iconSize.md} color={colors.onAccent} />
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.deferAction}
      onPress={() => {
        haptics.impactMedium();
        swipeableRef.current?.close();
        setShowWhenPicker(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Reschedule ${task.title}`}
    >
      <Ionicons name="time" size={iconSize.md} color={colors.text} />
    </TouchableOpacity>
  );

  const rowBody = (
    <View style={[styles.row, isActive && styles.rowActive]}>
      {task.priority > 0 && (
        <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />
      )}

      <TouchableOpacity
        onPress={selectionMode ? onSelect : (completing ? handleUndoComplete : handleComplete)}
        hitSlop={10}
        style={styles.circleWrapper}
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: selectionMode ? selected : completing,
          disabled: !selectionMode && recurrenceNotYetDue,
        }}
        accessibilityLabel={
          selectionMode
            ? (selected ? `Deselect ${task.title}` : `Select ${task.title}`)
            : recurrenceNotYetDue
              ? `${task.title}, not due yet`
              : (completing ? `Undo complete ${task.title}` : `Complete ${task.title}`)
        }
      >
        <Animated.View style={[
          styles.circle,
          !selectionMode && completing && styles.circleCompleting,
          !selectionMode && recurrenceNotYetDue && styles.circleLocked,
          selectionMode && selected && styles.circleSelected,
          { transform: selectionMode ? [] : [{ scale: circleScale }] },
        ]}>
          {selectionMode && selected && (
            <Ionicons name="checkmark" size={14} color={colors.onAccent} />
          )}
          {!selectionMode && completing && (
            <Animated.View style={{ transform: [{ scale: checkScale }] }}>
              <Ionicons name="checkmark" size={14} color={colors.onAccent} />
            </Animated.View>
          )}
          {!selectionMode && !completing && recurrenceNotYetDue && (
            <Ionicons name="repeat" size={iconSize.sm} color={colors.textTertiary} />
          )}
        </Animated.View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.content}
        onPress={handleContentPress}
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        // Content only hugs its text height, leaving the row's own vertical
        // padding and the flex gaps to either side untappable — this slop
        // extends the hit target out to cover that dead space so the whole
        // card row responds, not just the text itself.
        hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityState={selectionMode ? { checked: selected } : { expanded }}
        accessibilityLabel={task.title}
        accessibilityHint={
          selectionMode
            ? undefined
            : expanded
              ? 'Double tap to collapse details'
              : 'Double tap to expand details'
        }
      >
        {isEditingTitle ? (
          <TextInput
            ref={titleInputRef}
            style={styles.titleInput}
            value={titleEdit}
            onChangeText={setTitleEdit}
            onBlur={saveTitle}
            onSubmitEditing={saveTitle}
            returnKeyType="done"
            maxLength={TITLE_MAX_LENGTH}
            blurOnSubmit
            autoFocus
          />
        ) : (
          <View style={styles.titleRow}>
            {isNew && <View style={styles.newDot} />}
            {expanded ? (
              // Only tappable for edit when already expanded — avoids intercepting expand taps
              <TouchableOpacity style={styles.titleFlex} onPress={handleTitleTap} activeOpacity={interaction.activeOpacity}>
                <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.title, styles.titleFlex]} numberOfLines={1} ellipsizeMode="tail">
                {chainStep ? chainStep.title : task.title}
              </Text>
            )}
            {chainStep && (
              <View style={styles.chainBadge}>
                <Ionicons name="link" size={9} color={colors.accent} />
                <Text style={styles.chainBadgeText}>{chainPosition}</Text>
              </View>
            )}
            {subtaskCount > 0 && (
              <View
                style={styles.subtaskBadge}
                accessibilityLabel={`${subtaskDoneCount} of ${subtaskCount} subtasks done`}
              >
                <Ionicons name="list-outline" size={9} color={colors.textTertiary} />
                <Text style={styles.subtaskBadgeText}>{subtaskDoneCount}/{subtaskCount}</Text>
              </View>
            )}
            {deadlineDays !== null && (
              <View
                style={styles.deadlineBadge}
                accessibilityLabel={
                  deadlineDays < 0
                    ? `Deadline was ${formatDueDate(task.deadline!)}`
                    : `Deadline ${formatDueDate(task.deadline!)}`
                }
              >
                <Ionicons name="flag" size={9} color={deadlineColor} />
                <Text style={[styles.deadlineBadgeText, { color: deadlineColor }]}>
                  {formatDueDate(task.deadline!)}
                </Text>
              </View>
            )}
          </View>
        )}
        {showCategory && task.category && (
          <View style={styles.categoryRow}>
            <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textTertiary} />
            <Text style={styles.categoryLabel} numberOfLines={1}>
              {categoryEmoji ? `${categoryEmoji} ${task.category}` : task.category}
            </Text>
          </View>
        )}
        {showProject && projectTitle && (
          <View style={styles.projectRow}>
            <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textTertiary} />
            <Text style={styles.projectLabel} numberOfLines={1}>{projectTitle}</Text>
          </View>
        )}
        {windowActive && task.windowEnd && (
          <View style={styles.windowRow}>
            <Ionicons name="time" size={iconSize.xs} color={colors.red} />
            <Text style={styles.windowLabel} numberOfLines={1}>
              {formatWindowRemaining(task.windowEnd)}
            </Text>
          </View>
        )}
        {!windowActive && windowExpired && (
          <View style={styles.windowRow}>
            <Ionicons name="time-outline" size={iconSize.xs} color={colors.textTertiary} />
            <Text style={styles.windowLabelExpired} numberOfLines={1}>
              Expired at {formatHHMM(task.windowEnd!)}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {!selectionMode && showActions && task.linkUrl && (
        <TouchableOpacity
          onPress={handleOpenLink}
          hitSlop={8}
          style={styles.linkBtn}
          accessibilityRole="button"
          accessibilityLabel={`Open link for ${task.title}`}
        >
          <Ionicons name="link" size={iconSize.sm} color={colors.accent} />
        </TouchableOpacity>
      )}

      {!selectionMode && showActions && (
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            togglePin(task.id);
          }}
          hitSlop={8}
          style={styles.starBtn}
          accessibilityRole="button"
          accessibilityState={{ selected: task.pinned }}
          accessibilityLabel={
            task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`
          }
        >
          <Ionicons
            name={task.pinned ? 'pin' : 'pin-outline'}
            size={iconSize.sm}
            color={task.pinned ? colors.orange : colors.textTertiary}
          />
        </TouchableOpacity>
      )}

    </View>
  );

  const expandedPanel = (
    <Reanimated.View style={[expandedPanelStyle, styles.expandedPanelClip]}>
      {/* Absolutely positioned so it always lays out at natural height for
          measurement, independent of the animated clipping height above.
          Top-anchored: the growing card uncovers the content in place, and
          cardClip keeps the slice edge's corners rounded. */}
      <View
        style={styles.panelMeasure}
        onLayout={e => setPanelHeight(e.nativeEvent.layout.height)}
      >
      <View style={styles.expandedPanel}>
        {!selectionMode && (
          <>
            {task.notes.length > 0 && (
              <Text style={styles.expandNotes}>{task.notes}</Text>
            )}

            {subtasks.length > 0 && (
              <View style={[
                styles.expandSection,
                styles.subtaskSection,
                task.notes.length > 0 && styles.sectionDivider,
              ]}>
                <SortableList
                  data={subtasks}
                  onReorder={(newData) => reorderSubtasks(task.id, newData.map(s => s.id))}
                  renderItem={(sub, i, drag) => (
                    <View style={[
                      styles.subtaskRow,
                      i === subtasks.length - 1 && styles.subtaskRowLast,
                    ]}>
                      <TouchableOpacity
                        onPress={() => {
                          haptics.tap();
                          toggleSubtask(sub.id);
                        }}
                        hitSlop={8}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: sub.completed }}
                        accessibilityLabel={sub.title}
                      >
                        <View style={[styles.subtaskCheck, sub.completed && styles.subtaskCheckDone]}>
                          {sub.completed && (
                            <Ionicons name="checkmark" size={9} color={colors.onAccent} />
                          )}
                        </View>
                      </TouchableOpacity>
                      {editingSubtaskId === sub.id ? (
                        <TextInput
                          ref={subtaskTitleInputRef}
                          style={styles.subtaskTitleInput}
                          value={subtaskTitleEdit}
                          onChangeText={setSubtaskTitleEdit}
                          onBlur={() => saveSubtaskTitle(sub)}
                          onSubmitEditing={() => saveSubtaskTitle(sub)}
                          returnKeyType="done"
                          maxLength={TITLE_MAX_LENGTH}
                          blurOnSubmit
                          autoFocus
                        />
                      ) : (
                        <TouchableOpacity
                          style={styles.subtaskTitleWrapper}
                          onPress={() => handleSubtaskTitleTap(sub)}
                          activeOpacity={interaction.activeOpacity}
                        >
                          <Text style={[
                            styles.subtaskTitle,
                            sub.completed && styles.subtaskTitleDone,
                          ]} numberOfLines={2}>
                            {sub.title}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onLongPress={(e) => drag(e.nativeEvent.pageY)}
                        delayLongPress={interaction.delayLongPress}
                        hitSlop={8}
                        style={styles.subtaskDragHandle}
                        accessibilityLabel={`Reorder ${sub.title}`}
                      >
                        <Ionicons name="reorder-three" size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          haptics.tap();
                          deleteSubtask(sub.id);
                        }}
                        hitSlop={8}
                        style={styles.subtaskDeleteBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${sub.title}`}
                      >
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              </View>
            )}

            {task.recurrenceType !== 'none' && (
              <View style={[
                styles.recurrenceRow,
                (task.notes.length > 0 || subtasks.length > 0) && styles.sectionDivider,
              ]}>
                <Ionicons name="repeat" size={12} color={colors.textTertiary} />
                <Text style={styles.expandMeta}>{describeRecurrence(task)}</Text>
                {task.streakCount > 0 && (
                  <>
                    <Text style={styles.expandMeta}> · </Text>
                    <View style={styles.streakBadge}>
                      <Ionicons name="flame" size={12} color={colors.orange} />
                      <Text style={styles.expandMeta}>{task.streakCount}</Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {activeChainItem && task.chainItems.length > 0 && (() => {
              const total = task.chainItems.length;
              const currentIdx = task.chainIndex % total;
              // Long chains overflow the row unreadably, so only show a
              // window of steps around the current one, with ellipses
              // standing in for whatever's trimmed off each end.
              const start = Math.max(0, currentIdx - CHAIN_PREVIEW_RADIUS);
              const end = Math.min(total - 1, currentIdx + CHAIN_PREVIEW_RADIUS);
              const visibleItems = task.chainItems.slice(start, end + 1);
              return (
                <View style={[
                  styles.recurrenceRow,
                  (task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none') && styles.sectionDivider,
                ]}>
                  <Ionicons name="link" size={12} color={colors.textTertiary} />
                  <Text style={styles.expandMeta} numberOfLines={1}>
                    Chain {currentIdx + 1}/{total}:{start > 0 ? ' … →' : ''}
                    {visibleItems.map((item, i) => {
                      const actualIdx = start + i;
                      return (
                        <Text
                          key={item.id}
                          style={actualIdx === currentIdx && styles.expandMetaActive}
                        >
                          {actualIdx > 0 ? ' → ' : ' '}{item.title}
                        </Text>
                      );
                    })}
                    {end < total - 1 ? ' → …' : ''}
                  </Text>
                </View>
              );
            })()}

            {task.actualMinutes != null && (
              <View style={[
                styles.recurrenceRow,
                hasExpandContent && styles.sectionDivider,
              ]}>
                <Ionicons name="stopwatch-outline" size={12} color={colors.textTertiary} />
                <Text style={styles.expandMeta}>Timed · {formatDuration(task.actualMinutes)}</Text>
              </View>
            )}

            {onEdit && (
              <View style={[
                styles.editSection,
                (hasExpandContent || task.actualMinutes != null) && styles.sectionDivider,
              ]}>
                <View style={styles.editSectionLeft}>
                  {showActions && (
                    timerRunning ? (
                    <View style={styles.timerRunningGroup}>
                      <TouchableOpacity
                        onPress={handleTimerToggle}
                        hitSlop={8}
                        style={styles.timerPill}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Stop timer for ${task.title}`}
                        accessibilityValue={{ text: formatStopwatch(elapsedSeconds) }}
                      >
                        <Ionicons name="stop" size={10} color={colors.onAccent} />
                        <Text style={styles.timerPillText}>{formatStopwatch(elapsedSeconds)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDiscardTimer}
                        hitSlop={8}
                        style={styles.timerDeleteBtn}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Discard timer for ${task.title}`}
                      >
                        <Ionicons name="trash-outline" size={iconSize.xs} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                    ) : (
                    <PressableScale
                      style={styles.iconActionBtn}
                      onPress={handleTimerToggle}
                      hitSlop={8}
                      accessibilityLabel={`Start timer for ${task.title}`}
                    >
                      <Ionicons name="stopwatch-outline" size={iconSize.sm} color={colors.textSecondary} />
                    </PressableScale>
                    )
                  )}
                  {task.recurrenceType !== 'none' && (
                    <PressableScale
                      style={styles.iconActionBtn}
                      onPress={async () => {
                        await haptics.impactMedium();
                        skipNextRecurrence(task.id);
                        // The task disappears from the list immediately, but nothing
                        // else clears the parent's expanded-row state — collapse it
                        // ourselves so the spotlight overlay doesn't get stuck.
                        if (expanded) onPress();
                      }}
                      hitSlop={8}
                      accessibilityLabel={`Skip next occurrence of ${task.title}`}
                    >
                      <Ionicons name="play-skip-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
                    </PressableScale>
                  )}
                </View>
                <View style={styles.editSectionRight}>
                  <TouchableOpacity
                    style={[styles.editBtn, !task.dueDate && styles.editBtnIconOnly]}
                    onPress={() => setShowWhenPicker(true)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityLabel={task.dueDate ? `Change date, currently ${formatDueDate(task.dueDate)}` : 'Set date'}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={iconSize.sm}
                      color={task.dueDate ? colors.accent : colors.textSecondary}
                    />
                    {task.dueDate && (
                      <Text style={styles.editBtnText}>{formatDueDate(task.dueDate)}</Text>
                    )}
                  </TouchableOpacity>
                  <PressableScale
                    style={styles.iconActionBtn}
                    onPress={async () => {
                      await haptics.tap();
                      duplicateTask(task.id);
                    }}
                    hitSlop={8}
                    accessibilityLabel="Duplicate task"
                  >
                    <Ionicons name="copy-outline" size={iconSize.sm} color={colors.textSecondary} />
                  </PressableScale>
                  <PressableScale
                    style={[styles.iconActionBtn, styles.iconActionBtnAccent]}
                    onPress={onEdit}
                    hitSlop={8}
                    accessibilityLabel="Edit task"
                  >
                    <Ionicons name="pencil-outline" size={iconSize.sm} color={colors.accent} />
                  </PressableScale>
                </View>
              </View>
            )}
          </>
        )}
      </View>
      </View>
      {/* Continues the urgency bar from the row down through the expanded
          panel, so it reads as one strip along the whole card's left edge
          instead of stopping at the collapsed row's height. Sized against
          this view's own animated height, so it grows/shrinks in lockstep.
          Rendered last so it draws on top of the panel's opaque background. */}
      {task.priority > 0 && (
        <View style={[styles.priorityBarPanel, { backgroundColor: priorityColor }]} />
      )}
    </Reanimated.View>
  );

  return (
    <>
      <Reanimated.View style={collapseStyle} onLayout={handleItemLayout}>
        <Animated.View
          style={[
            styles.itemWrapper,
            shadows.card,
            { opacity: isActive ? 1 : rowOpacity },
            isActive && styles.itemWrapperActive,
            expanded && styles.itemWrapperElevated,
            indented && styles.itemWrapperIndented,
          ]}
          // Screens collapse the spotlight on any touch in the list area;
          // touches inside the expanded card must not bubble up to that.
          onTouchEnd={expanded ? e => e.stopPropagation() : undefined}
        >
          {/* Clips the row + panel together as one card. Because this view is
              never shorter than the row, its corner radius never clamps, so
              the card silhouette stays rounded at every animation frame.
              (Separate from itemWrapper: overflow hidden there would clip the
              card shadow on iOS.) */}
          <View style={styles.cardClip}>
          {selectionMode ? (
            <View style={styles.swipeContainer}>
              {rowBody}
            </View>
          ) : (
            // Swipeable stays mounted regardless of spotlightDisabled — toggling
            // between it and a plain View/Pressable here used to remount rowBody
            // (a different element type at this tree position) every time any
            // other task got tapped, which read as the whole row flashing.
            // Disabling the gesture and overlaying a dismiss-tap Pressable keeps
            // the same tree shape across that toggle.
            <Swipeable
              ref={swipeableRef}
              renderRightActions={renderRightActions}
              renderLeftActions={renderLeftActions}
              overshootRight={false}
              overshootLeft={false}
              enabled={!spotlightDisabled}
              onSwipeableWillOpen={() => {
                haptics.impactMedium();
              }}
              onSwipeableOpen={(direction) => {
                if (direction === 'right') {
                  handleSwipeSelect();
                } else {
                  swipeableRef.current?.close();
                  setShowWhenPicker(true);
                }
              }}
            >
              <View style={styles.swipeContainer}>
                <View pointerEvents={spotlightDisabled ? 'none' : 'auto'}>
                  {rowBody}
                </View>
                {spotlightDisabled && (
                  // While another task is spotlighted this row must not react
                  // to touches itself — any tap on it just dismisses the spotlight.
                  <Pressable style={StyleSheet.absoluteFill} onPress={onPress} />
                )}
              </View>
            </Swipeable>
          )}
          {expandedPanel}
          {/* A scrim drawn on top of the row rather than fading the row's own
              opacity — fading the whole card washes out low-contrast text
              (e.g. category labels) far less than high-contrast text, since
              both just blend toward the same light background in light mode.
              A flat scrim darkens every pixel underneath by the same amount
              regardless of its original color. The spotlighted card is the one
              row that skips it. */}
          {!isSpotlighted && <SpotlightScrim />}
          {justCreated && !reduceMotion && (
            <Animated.View
              style={[styles.highlightScrim, { opacity: highlightOpacity }]}
              pointerEvents="none"
            />
          )}
          </View>
        </Animated.View>
      </Reanimated.View>

      {!selectionMode && (
        <WhenPicker
          visible={showWhenPicker}
          value={task.dueDate ? new Date(task.dueDate) : null}
          timeSegments={task.timeSegments}
          taskTitle={task.title}
          taskNotes={task.notes}
          taskEffort={task.effort}
          taskEstimatedMinutes={task.estimatedMinutes}
          onConfirm={(date, segs) => {
            const snapshot = { ...task };
            updateTask(task.id, {
              dueDate: date ? date.toISOString() : null,
              timeSegments: segs,
            });
            setLastAction({
              label: 'Task rescheduled',
              undo: () => updateTask(snapshot.id, snapshot),
            });
            setShowWhenPicker(false);
          }}
          onClear={() => {
            const snapshot = { ...task };
            updateTask(task.id, { dueDate: null, timeSegments: [] });
            setLastAction({
              label: 'Task rescheduled',
              undo: () => updateTask(snapshot.id, snapshot),
            });
            setShowWhenPicker(false);
          }}
          onCancel={() => setShowWhenPicker(false)}
        />
      )}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  itemWrapper: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  // Nests a group's expanded children visually under the group header, which
  // otherwise shares the exact same card treatment as a top-level task row.
  itemWrapperIndented: {
    marginLeft: spacing.md + spacing.lg,
  },
  // Lifted look while being dragged: elevated background so the floating card
  // reads as clearly distinct from the resting rows.
  itemWrapperActive: {
    backgroundColor: colors.bgTertiary,
  },
  rowActive: {
    backgroundColor: colors.bgTertiary,
  },
  itemWrapperElevated: {
    zIndex: 10,
    elevation: 10,
  },
  cardClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  highlightScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.accent,
  },
  swipeContainer: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    paddingVertical: 10,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  // Flush to the row's full height with no radius of its own: cardClip's
  // overflow:hidden + borderRadius round it off wherever it meets a true
  // card corner, so it never needs manual insets to avoid overflowing —
  // and it matches the full-height defer button revealed behind it on swipe.
  priorityBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  priorityBarPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 4,
    width: 3,
    borderBottomRightRadius: 2,
  },
  circleWrapper: {
    marginLeft: spacing.md,
    padding: 2,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: border.sm,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleCompleting: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  circleLocked: {
    borderColor: colors.textTertiary,
  },
  circleSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  content: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.md,
    // Height, not lineHeight — iOS lays a TextInput's glyphs out one full
    // line height below the top of the line box, so any lineHeight here
    // drops the text off-centre. minHeight keeps the row from resizing when
    // the title swaps between `title` (a Text with lineHeight.md) and edit mode.
    minHeight: lineHeight.md,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleFlex: {
    flexShrink: 1,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  projectLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  windowLabel: {
    color: colors.red,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  windowLabelExpired: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  starBtn: {
    padding: 4,
  },
  linkBtn: {
    padding: 4,
  },
  timerRunningGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timerDeleteBtn: {
    padding: 4,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  timerPillText: {
    color: colors.onAccent,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  selectAction: {
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  deferAction: {
    backgroundColor: colors.orange,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
  },
  expandedPanelClip: {
    overflow: 'hidden',
  },
  panelMeasure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  expandedPanel: {
    backgroundColor: colors.bgSecondary,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  expandNotes: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    paddingVertical: spacing.xs,
  },
  expandSection: {
    gap: 6,
    paddingVertical: spacing.xs,
  },
  // Indents the subtask list a little to the right of the task's own content,
  // so it visually nests under the task it belongs to.
  subtaskSection: {
    gap: 0,
    paddingLeft: spacing.sm,
    paddingTop: 0,
  },
  sectionDivider: {
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
    marginTop: 2,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  subtaskRowLast: {
    borderBottomWidth: 0,
  },
  subtaskCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  subtaskCheckDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  subtaskTitleWrapper: {
    flex: 1,
  },
  subtaskTitle: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  subtaskTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  subtaskTitleInput: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.sm,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  subtaskDragHandle: {
    padding: 2,
  },
  subtaskDeleteBtn: {
    padding: 2,
  },
  recurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.xs,
  },
  expandMeta: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  expandMetaActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chainBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  subtaskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  subtaskBadgeText: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  deadlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  deadlineBadgeText: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  editSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  editSectionLeft: { flexDirection: 'row', gap: spacing.xs },
  editSectionRight: { flexDirection: 'row', gap: spacing.xs, flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  editBtnIconOnly: {
    paddingHorizontal: 9,
  },
  editBtnText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  iconActionBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionBtnAccent: {
    backgroundColor: colors.accentSubtle,
  },
});
