import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Alert,
  Keyboard,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { Task } from '../types';
import { PRIORITY_COLORS, EFFORT_LABELS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, type Colors } from '../theme';
import { tagColor } from '../utils/tagColor';
import { formatDueDate, formatDeferUntil, getStreakDisplay, getDayStart, getCurrentDayStart } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { WhenPicker } from './WhenPicker';
import { CalendarPicker } from './CalendarPicker';

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
  onLongPress?: () => void;
  onSelect?: () => void;
  spotlightDisabled?: boolean;
  hideTodayLabel?: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  onLongPress,
  onSelect,
  spotlightDisabled = false,
  hideTodayLabel = false,
}: Props) {
  const completeTask = useTaskStore(s => s.completeTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const toggleFocus = useTaskStore(s => s.toggleFocus);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showWhenPicker, setShowWhenPicker] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const circleScale = useRef(new Animated.Value(1)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  const expansionAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const swipeableRef = useRef<Swipeable>(null);
  const titleInputRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.spring(expansionAnim, {
      toValue: expanded ? 1 : 0,
      damping: 26,
      stiffness: 220,
      useNativeDriver: false,
    }).start();
  }, [expanded]);

  useEffect(() => {
    if (isActive) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [isActive]);

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

  const isOverdue =
    task.dueDate &&
    getDayStart(new Date(task.dueDate)) < getCurrentDayStart();

  const streak = getStreakDisplay(task);
  const priorityColor = PRIORITY_COLORS[task.priority];
  const effortLabel = task.effort > 0 ? EFFORT_LABELS[task.effort] : null;

  const activeCycleItem =
    task.cycleEnabled && task.cycleItems.length > 0
      ? task.cycleItems[task.cycleIndex % task.cycleItems.length]
      : null;

  const hasExpandContent =
    task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none';

  const handleComplete = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCompleting(true);
    Animated.sequence([
      Animated.spring(circleScale, { toValue: 1.35, damping: 22, stiffness: 300, useNativeDriver: true }),
      Animated.spring(circleScale, { toValue: 1, damping: 22, stiffness: 300, useNativeDriver: true }),
      Animated.delay(120),
      Animated.timing(rowOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setCompleting(false);
      completeTask(task.id);
    });
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete Task',
      `Delete "${task.title}"?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => swipeableRef.current?.close() },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            Animated.timing(rowOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
              () => deleteTask(task.id)
            );
          },
        },
      ]
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        confirmDelete();
      }}
    >
      <Ionicons name="trash" size={iconSize.md} color={colors.text} />
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.deferAction}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        swipeableRef.current?.close();
        setShowWhenPicker(true);
      }}
    >
      <Ionicons name="time" size={iconSize.md} color={colors.text} />
    </TouchableOpacity>
  );

  const rowBody = (
    <View style={styles.row}>
      {task.priority > 0 && (
        <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />
      )}

      <TouchableOpacity
        onPress={selectionMode ? onSelect : handleComplete}
        hitSlop={10}
        style={styles.circleWrapper}
      >
        <Animated.View style={[
          styles.circle,
          !selectionMode && completing && styles.circleCompleting,
          selectionMode && selected && styles.circleSelected,
          { transform: selectionMode ? [] : [{ scale: circleScale }] },
        ]}>
          {((selectionMode && selected) || (!selectionMode && completing)) && (
            <Ionicons name="checkmark" size={14} color={colors.bg} />
          )}
        </Animated.View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.content}
        onPress={selectionMode ? onSelect : onPress}
        onLongPress={drag ?? onLongPress}
        delayLongPress={200}
        activeOpacity={0.7}
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
            blurOnSubmit
            autoFocus
          />
        ) : expanded ? (
          // Only tappable for edit when already expanded — avoids intercepting expand taps
          <TouchableOpacity onPress={handleTitleTap} activeOpacity={0.6}>
            <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
        )}
        {activeCycleItem && (
          <Text style={styles.cycleSubtitle} numberOfLines={1}>
            {activeCycleItem.title}
          </Text>
        )}

        <View style={styles.meta}>
          {task.category && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{task.category}</Text>
            </View>
          )}
          {task.tags.slice(0, 3).map(tag => (
            <View key={tag} style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
          ))}
          {task.tags.length > 0 && (
            <Text style={styles.metaText}>{task.tags.slice(0, 2).join(', ')}</Text>
          )}
          {task.dueDate && (!hideTodayLabel || formatDueDate(task.dueDate) !== 'Today') && (
            <Text style={[styles.metaText, isOverdue && styles.overdue]}>
              {formatDueDate(task.dueDate)}
            </Text>
          )}
          {task.deferUntil && new Date(task.deferUntil) > new Date() && (
            <Text style={styles.metaDim}>{formatDeferUntil(task.deferUntil)}</Text>
          )}
          {task.timeSegments.length > 0 && (
            <View style={styles.timeBadge}>
              {task.timeSegments.map(seg => (
                <Ionicons
                  key={seg}
                  name={seg === 'morning' ? 'sunny-outline' : seg === 'afternoon' ? 'sunny' : 'moon-outline'}
                  size={9}
                  color={colors.textTertiary}
                />
              ))}
              <Text style={styles.timeBadgeText}>
                {task.timeSegments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' · ')}
              </Text>
            </View>
          )}
          {effortLabel && (
            <View style={styles.effortBadge}>
              <Text style={styles.effortText}>{effortLabel}</Text>
            </View>
          )}
          {streak && (
            <Text style={[styles.metaText, streak.sign === '-' && styles.streakNeg]}>
              {streak.sign === '+' ? '🔥' : '❄️'} {streak.count}
            </Text>
          )}
          {activeCycleItem && task.cycleItems.length > 1 && (
            <View style={styles.cycleBadge}>
              <Ionicons name="sync" size={9} color={colors.accent} />
              <Text style={styles.cycleBadgeText}>
                {(task.cycleIndex % task.cycleItems.length) + 1}/{task.cycleItems.length}
              </Text>
            </View>
          )}
          {subtaskCount > 0 && (
            <View style={[
              styles.subtaskBadge,
              subtaskDoneCount === subtaskCount && styles.subtaskBadgeDone,
            ]}>
              <Ionicons
                name="list"
                size={10}
                color={subtaskDoneCount === subtaskCount ? colors.green : colors.textSecondary}
              />
              <Text style={[
                styles.subtaskBadgeText,
                subtaskDoneCount === subtaskCount && styles.subtaskBadgeTextDone,
              ]}>
                {subtaskDoneCount}/{subtaskCount}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {!selectionMode && (
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            toggleFocus(task.id);
          }}
          hitSlop={8}
          style={styles.starBtn}
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
    <Animated.View style={{
      maxHeight: expansionAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 600], extrapolate: 'clamp' }),
      // Fully hide at rest-closed so no hairline shows between row and panel
      opacity: expansionAnim.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 1, 1] }),
      overflow: 'hidden',
    }}>
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
                    onPress={() => toggleSubtask(sub.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.subtaskCheck, sub.completed && styles.subtaskCheckDone]}>
                      {sub.completed && (
                        <Ionicons name="checkmark" size={9} color={colors.bg} />
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

            {activeCycleItem && task.cycleItems.length > 0 && (
              <View style={[
                styles.recurrenceRow,
                (task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none') && styles.sectionDivider,
              ]}>
                <Ionicons name="sync" size={12} color={colors.textTertiary} />
                <Text style={styles.expandMeta}>
                  Cycle {(task.cycleIndex % task.cycleItems.length) + 1}/{task.cycleItems.length}:
                </Text>
                {task.cycleItems.map((item, i) => (
                  <Text
                    key={item.id}
                    style={[
                      styles.expandMeta,
                      i === task.cycleIndex % task.cycleItems.length && styles.expandMetaActive,
                    ]}
                  >
                    {i > 0 ? ' → ' : ' '}{item.title}
                  </Text>
                ))}
              </View>
            )}

            {onEdit && (
              <View style={[
                styles.editSection,
                hasExpandContent && styles.sectionDivider,
                { justifyContent: 'space-between' },
              ]}>
                <View style={styles.editSectionLeft}>
                  {task.recurrenceType !== 'none' && (
                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        skipNextRecurrence(task.id);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="play-skip-forward-outline" size={13} color={colors.textSecondary} />
                      <Text style={[styles.editBtnText, styles.skipBtnText]}>Skip</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.editSectionRight}>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => setShowCalendar(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={13}
                      color={task.dueDate ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.editBtnText, !task.dueDate && styles.skipBtnText]}>
                      {task.dueDate ? formatDueDate(task.dueDate) : 'Date'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={onEdit}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="pencil-outline" size={13} color={colors.accent} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </Animated.View>
  );

  return (
    <>
      <Animated.View style={[
        styles.itemWrapper,
        shadows.card,
        { opacity: isActive ? 0.85 : rowOpacity },
        spotlightDisabled && styles.itemWrapperDimmed,
        expanded && styles.itemWrapperElevated,
      ]}>
        {selectionMode || spotlightDisabled ? (
          <View style={[styles.swipeContainer, expanded && styles.swipeContainerExpanded]}>
            {rowBody}
          </View>
        ) : (
          <Swipeable
            ref={swipeableRef}
            containerStyle={[
              styles.swipeContainer,
              expanded && styles.swipeContainerExpanded,
            ]}
            renderRightActions={renderRightActions}
            renderLeftActions={renderLeftActions}
            overshootRight={false}
            overshootLeft={false}
            onSwipeableWillOpen={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
      </Animated.View>

      {!selectionMode && (
        <WhenPicker
          visible={showWhenPicker}
          value={task.dueDate ? new Date(task.dueDate) : null}
          timeSegments={task.timeSegments}
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
      {!selectionMode && (
        <CalendarPicker
          visible={showCalendar}
          value={task.dueDate ? new Date(task.dueDate) : null}
          mode="date"
          title="Date"
          nlEnabled
          onConfirm={date => {
            const noon = new Date(date);
            noon.setHours(12, 0, 0, 0);
            updateTask(task.id, { dueDate: noon.toISOString() });
            setShowCalendar(false);
          }}
          onCancel={() => setShowCalendar(false)}
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
  itemWrapperDimmed: {
    opacity: 0.35,
  },
  itemWrapperElevated: {
    zIndex: 10,
    elevation: 10,
  },
  swipeContainer: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  swipeContainerExpanded: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
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
    padding: 0,
    margin: 0,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  tagDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  metaDim: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  overdue: {
    color: colors.red,
  },
  streakNeg: {
    color: colors.textTertiary,
  },
  categoryBadge: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  categoryBadgeText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: fontWeight.medium,
  },
  effortBadge: {
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  effortText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  starBtn: {
    padding: 4,
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
  subtaskBadgeDone: {
    backgroundColor: colors.green + '22',
  },
  subtaskBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  subtaskBadgeTextDone: {
    color: colors.green,
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
  cycleSubtitle: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
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
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  timeBadgeText: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
  editSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  editSectionLeft: { flexDirection: 'row', gap: spacing.xs },
  editSectionRight: { flexDirection: 'row', gap: spacing.xs },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  editBtnText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  skipBtnText: {
    color: colors.textSecondary,
  },
});
