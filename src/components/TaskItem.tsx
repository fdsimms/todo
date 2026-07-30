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
import { formatDueDate, formatHHMM, getDeadlineCountdown } from '../utils/dateUtils';
import { formatDuration, formatStopwatch } from '../utils/effort';
import { isTaskWindowActive, isTaskExpired, isRecurrenceNotYetDue, isTaskNew } from '../utils/visibilityUtils';
import { haptics } from '../utils/haptics';
import { useTaskStore } from '../store/useTaskStore';
import { WhenPicker } from './WhenPicker';
import { PressableScale } from './PressableScale';

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
  spotlightDisabled?: boolean;
  hideTodayLabel?: boolean;
  showCategory?: boolean;
  showActions?: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Steps shown on each side of the active cycle step before truncating with '…'.
const CYCLE_PREVIEW_RADIUS = 2;

function describeRecurrence(task: Task): string {
  const { recurrenceType, recurrenceInterval, recurrenceDays, recurrenceFromCompletion } = task;
  let text = '';
  if (recurrenceType === 'daily') {
    text = recurrenceInterval === 1 ? 'Repeats daily' : `Repeats every ${recurrenceInterval} days`;
  } else if (recurrenceType === 'weekly') {
    const dayStr = recurrenceDays.map(d => DAY_NAMES[d]).join(', ');
    const base = recurrenceInterval === 1 ? 'Repeats weekly' : `Every ${recurrenceInterval} weeks`;
    text = dayStr ? `${base} on ${dayStr}` : base;
  } else if (recurrenceType === 'monthly') {
    text = recurrenceInterval === 1 ? 'Repeats monthly' : `Every ${recurrenceInterval} months`;
  } else if (recurrenceType === 'yearly') {
    text = recurrenceInterval === 1 ? 'Repeats yearly' : `Every ${recurrenceInterval} years`;
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
  spotlightDisabled = false,
  hideTodayLabel = false,
  showCategory = false,
  showActions = true,
}: Props) {
  const completeTask = useTaskStore(s => s.completeTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const markTaskSeen = useTaskStore(s => s.markTaskSeen);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const toggleFocus = useTaskStore(s => s.toggleFocus);
  const startTimer = useTaskStore(s => s.startTimer);
  const stopTimer = useTaskStore(s => s.stopTimer);
  const discardTimer = useTaskStore(s => s.discardTimer);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const duplicateTask = useTaskStore(s => s.duplicateTask);
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showWhenPicker, setShowWhenPicker] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  // Natural height of the expansion panel content, measured off-screen so the
  // expansion can animate to the real height instead of an arbitrary cap.
  const [panelHeight, setPanelHeight] = useState(0);
  // Drives the live-counting timer display. We only re-render on a 1s tick while
  // this task's timer is actually running, so idle rows never spin an interval.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const timerRunning = task.timerStartedAt !== null;
  const completingRef = useRef(false);
  const deleteAlertOpenRef = useRef(false);
  const completeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const circleScale = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  // Opacity of a scrim drawn on top of the row (not the row's own opacity) —
  // fading the whole card instead washes out low-contrast text (e.g. category
  // labels) far less than high-contrast text, since both just blend toward
  // the same light background in light mode. A flat scrim darkens every
  // pixel underneath by the same fixed amount regardless of its original color.
  const spotlightScrimOpacity = useRef(new Animated.Value(spotlightDisabled ? 1 : 0)).current;
  // Reanimated (UI-thread) shared value drives the expand/collapse. The panel
  // animates `height`, which forces a re-layout of every row below it on each
  // frame — doing that from a JS-thread Animated.Value stutters once the list
  // is long and the JS thread is busy, which is what made the collapse read as
  // two discrete steps. Running it on the UI thread keeps it smooth regardless
  // of how many tasks sit below.
  const expansionProgress = useSharedValue(expanded ? 1 : 0);
  const swipeableRef = useRef<Swipeable>(null);
  const titleInputRef = useRef<TextInput>(null);

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

  useEffect(() => {
    Animated.timing(spotlightScrimOpacity, {
      toValue: spotlightDisabled ? 1 : 0,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start();
  }, [spotlightDisabled]);

  useEffect(() => {
    if (isActive) {
      haptics.impactMedium();
    }
  }, [isActive]);

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

  const activeCycleItem =
    task.cycleEnabled && task.cycleItems.length > 0
      ? task.cycleItems[task.cycleIndex % task.cycleItems.length]
      : null;
  // A multi-step cycle drives the collapsed row's title: we show the current
  // step's title with a compact step-count badge beside it, instead of a
  // second subtitle line, so the row stays the same height as the others.
  const cycleStep = activeCycleItem && task.cycleItems.length > 1 ? activeCycleItem : null;
  const cyclePosition = cycleStep ? `${(task.cycleIndex % task.cycleItems.length) + 1}/${task.cycleItems.length}` : '';

  const hasExpandContent =
    task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none';

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
    // collapses once completions pause for a couple seconds. The task isn't
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
    });
  };

  const handleUndoComplete = async () => {
    completeAnimRef.current?.stop();
    completeAnimRef.current = null;
    completingRef.current = false;
    await haptics.tap();
    checkScale.setValue(0);
    circleScale.setValue(1);
    rowOpacity.setValue(1);
    setCompleting(false);
  };

  const confirmDelete = () => {
    // Opening the swipeable row (via drag-release) and tapping the revealed
    // delete button both call this for the same swipe gesture; without this
    // guard they stack two native alerts, so dismissing the first just
    // reveals a second one underneath.
    if (deleteAlertOpenRef.current) return;
    deleteAlertOpenRef.current = true;
    Alert.alert(
      'Delete Task',
      `Delete "${task.title}"?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            deleteAlertOpenRef.current = false;
            swipeableRef.current?.close();
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            deleteAlertOpenRef.current = false;
            await haptics.impactHeavy();
            // No animateLayout() here: this unmounts the row's Swipeable
            // (react-native-gesture-handler), and firing a LayoutAnimation in
            // the same tick a Swipeable unmounts crashes on iOS — see the
            // matching note in useTaskStore's completeTask.
            Animated.timing(rowOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
              deleteTask(task.id);
            });
          },
        },
      ],
      { onDismiss: () => { deleteAlertOpenRef.current = false; } }
    );
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

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => {
        haptics.impactHeavy();
        confirmDelete();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${task.title}`}
    >
      <Ionicons name="trash" size={iconSize.md} color={colors.text} />
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
        <View style={[
          styles.priorityBar,
          expanded && styles.priorityBarExpanded,
          { backgroundColor: priorityColor },
        ]} />
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
        </Animated.View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.content}
        onPress={handleContentPress}
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
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
            textAlignVertical="center"
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
                {cycleStep ? cycleStep.title : task.title}
              </Text>
            )}
            {cycleStep && (
              <View style={styles.cycleBadge}>
                <Ionicons name="sync" size={9} color={colors.accent} />
                <Text style={styles.cycleBadgeText}>{cyclePosition}</Text>
              </View>
            )}
            {deadlineDays !== null && (
              <View
                style={styles.deadlineBadge}
                accessibilityLabel={
                  deadlineDays < 0
                    ? `${Math.abs(deadlineDays)} days past deadline`
                    : deadlineDays === 0
                    ? 'Deadline today'
                    : `${deadlineDays} days until deadline`
                }
              >
                <Ionicons name="flag" size={9} color={deadlineColor} />
                <Text style={[styles.deadlineBadgeText, { color: deadlineColor }]}>
                  {Math.abs(deadlineDays)}
                </Text>
              </View>
            )}
          </View>
        )}
        {showCategory && task.category && (
          <View style={styles.categoryRow}>
            <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textTertiary} />
            <Text style={styles.categoryLabel} numberOfLines={1}>{task.category}</Text>
          </View>
        )}
        {windowActive && (
          <View style={styles.windowRow}>
            <Ionicons name="time" size={iconSize.xs} color={colors.red} />
            <Text style={styles.windowLabel} numberOfLines={1}>
              {task.windowEnd ? `Open until ${formatHHMM(task.windowEnd)}` : 'Open now'}
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

      {!selectionMode && showActions && (
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            toggleFocus(task.id);
          }}
          hitSlop={8}
          style={styles.starBtn}
          accessibilityRole="button"
          accessibilityState={{ selected: task.focused }}
          accessibilityLabel={
            task.focused ? `Remove ${task.title} from focus` : `Add ${task.title} to focus`
          }
        >
          <Ionicons
            name={task.focused ? 'star' : 'star-outline'}
            size={iconSize.sm}
            color={task.focused ? colors.orange : colors.textTertiary}
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
                task.notes.length > 0 && styles.sectionDivider,
              ]}>
                {subtasks.map(sub => (
                  <TouchableOpacity
                    key={sub.id}
                    style={styles.subtaskRow}
                    onPress={() => {
                      haptics.tap();
                      toggleSubtask(sub.id);
                    }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sub.completed }}
                    accessibilityLabel={sub.title}
                  >
                    <View style={[styles.subtaskCheck, sub.completed && styles.subtaskCheckDone]}>
                      {sub.completed && (
                        <Ionicons name="checkmark" size={9} color={colors.onAccent} />
                      )}
                    </View>
                    <Text style={[
                      styles.subtaskTitle,
                      sub.completed && styles.subtaskTitleDone,
                    ]} numberOfLines={2}>
                      {sub.title}
                    </Text>
                  </TouchableOpacity>
                ))}
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
                  <Text style={styles.expandMeta}> · 🔥 {task.streakCount}</Text>
                )}
              </View>
            )}

            {activeCycleItem && task.cycleItems.length > 0 && (() => {
              const total = task.cycleItems.length;
              const currentIdx = task.cycleIndex % total;
              // Long cycles overflow the row unreadably, so only show a
              // window of steps around the current one, with ellipses
              // standing in for whatever's trimmed off each end.
              const start = Math.max(0, currentIdx - CYCLE_PREVIEW_RADIUS);
              const end = Math.min(total - 1, currentIdx + CYCLE_PREVIEW_RADIUS);
              const visibleItems = task.cycleItems.slice(start, end + 1);
              return (
                <View style={[
                  styles.recurrenceRow,
                  (task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none') && styles.sectionDivider,
                ]}>
                  <Ionicons name="sync" size={12} color={colors.textTertiary} />
                  <Text style={styles.expandMeta} numberOfLines={1}>
                    Cycle {currentIdx + 1}/{total}:{start > 0 ? ' … →' : ''}
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
      <Animated.View
        style={[
          styles.itemWrapper,
          shadows.card,
          { opacity: isActive ? 1 : rowOpacity },
          isActive && styles.itemWrapperActive,
          expanded && styles.itemWrapperElevated,
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
        {spotlightDisabled && !selectionMode ? (
          // While another task is spotlighted this row must not react to
          // touches itself — any tap on it just dismisses the spotlight.
          <Pressable style={styles.swipeContainer} onPress={onPress}>
            <View pointerEvents="none">{rowBody}</View>
          </Pressable>
        ) : selectionMode || spotlightDisabled ? (
          <View style={styles.swipeContainer}>
            {rowBody}
          </View>
        ) : (
          <Swipeable
            ref={swipeableRef}
            renderRightActions={renderRightActions}
            renderLeftActions={renderLeftActions}
            overshootRight={false}
            overshootLeft={false}
            onSwipeableWillOpen={() => {
              haptics.impactMedium();
            }}
            onSwipeableOpen={(direction) => {
              if (direction === 'right') {
                confirmDelete();
              } else {
                swipeableRef.current?.close();
                setShowWhenPicker(true);
              }
            }}
          >
            {rowBody}
          </Swipeable>
        )}
        {expandedPanel}
        <Animated.View
          style={[styles.spotlightScrim, { opacity: spotlightScrimOpacity }]}
          pointerEvents="none"
        />
        </View>
      </Animated.View>

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
            updateTask(task.id, {
              dueDate: date ? date.toISOString() : null,
              timeSegments: segs,
            });
            setShowWhenPicker(false);
          }}
          onClear={() => {
            updateTask(task.id, { dueDate: null, timeSegments: [] });
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
  spotlightScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
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
  priorityBar: {
    position: 'absolute',
    left: 0,
    top: 4,
    bottom: 4,
    width: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  // When expanded, the row's bar meets the panel's bar flush (no gap or
  // radius) so together they read as one continuous strip.
  priorityBarExpanded: {
    bottom: 0,
    borderBottomRightRadius: 0,
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
    opacity: 0.4,
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
    lineHeight: lineHeight.md,
    height: lineHeight.md,
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
  deleteAction: {
    backgroundColor: colors.red,
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
  sectionDivider: {
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
    marginTop: 2,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  subtaskTitle: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  subtaskTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
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
  expandMetaActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  cycleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  cycleBadgeText: {
    color: colors.accent,
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
