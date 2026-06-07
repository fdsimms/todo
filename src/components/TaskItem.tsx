import React, { useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { Task } from '../types';
import { PRIORITY_COLORS, EFFORT_LABELS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';
import { tagColor } from '../utils/tagColor';
import { formatDueDate, formatDeferUntil, getStreakDisplay, getDayStart, getCurrentDayStart } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { DeferModal } from './DeferModal';

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
  showDragHandle?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  onSelect?: () => void;
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
  showDragHandle = false,
  selectionMode = false,
  selected = false,
  onLongPress,
  onSelect,
}: Props) {
  const completeTask = useTaskStore(s => s.completeTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const deferTask = useTaskStore(s => s.deferTask);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const toggleFocus = useTaskStore(s => s.toggleFocus);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [showDeferModal, setShowDeferModal] = useState(false);
  const [completing, setCompleting] = useState(false);
  const circleScale = useRef(new Animated.Value(1)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  const swipeableRef = useRef<Swipeable>(null);

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
      Animated.timing(circleScale, { toValue: 1.35, duration: 80, useNativeDriver: true }),
      Animated.timing(circleScale, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.delay(140),
      Animated.timing(rowOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setCompleting(false);
      completeTask(task.id);
    });
  };

  const handleDelete = async () => {
    swipeableRef.current?.close();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.timing(rowOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      () => deleteTask(task.id)
    );
  };

  const renderRightActions = () => (
    <TouchableOpacity style={styles.deleteAction} onPress={handleDelete}>
      <Ionicons name="trash" size={20} color={colors.text} />
      <Text style={styles.actionLabel}>Delete</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.deferAction}
      onPress={() => {
        swipeableRef.current?.close();
        setShowDeferModal(true);
      }}
    >
      <Ionicons name="time" size={20} color={colors.text} />
      <Text style={styles.actionLabel}>Defer</Text>
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
          {selectionMode && selected && (
            <Ionicons name="checkmark" size={14} color={colors.bg} />
          )}
        </Animated.View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.content}
        onPress={selectionMode ? onSelect : onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
        {activeCycleItem && (
          <Text style={styles.cycleSubtitle} numberOfLines={1}>
            {activeCycleItem.title}
          </Text>
        )}

        <View style={styles.meta}>
          {task.tags.slice(0, 3).map(tag => (
            <View key={tag} style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
          ))}
          {task.tags.length > 0 && (
            <Text style={styles.metaText}>{task.tags.slice(0, 2).join(', ')}</Text>
          )}
          {task.dueDate && (
            <Text style={[styles.metaText, isOverdue && styles.overdue]}>
              {formatDueDate(task.dueDate)}
            </Text>
          )}
          {task.deferUntil && new Date(task.deferUntil) > new Date() && (
            <Text style={styles.metaDim}>{formatDeferUntil(task.deferUntil)}</Text>
          )}
          {task.timeOfDay && (
            <View style={styles.timeBadge}>
              <Ionicons
                name={task.timeOfDay === 'morning' ? 'sunny-outline' : task.timeOfDay === 'afternoon' ? 'sunny' : 'moon-outline'}
                size={9}
                color={colors.textTertiary}
              />
              <Text style={styles.timeBadgeText}>
                {task.timeOfDay.charAt(0).toUpperCase() + task.timeOfDay.slice(1)}
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
            size={16}
            color={task.focused ? colors.orange : colors.textTertiary}
          />
        </TouchableOpacity>
      )}

      {!selectionMode && showDragHandle && (
        <TouchableOpacity
          onLongPress={drag}
          delayLongPress={150}
          hitSlop={8}
          style={styles.dragHandle}
        >
          <Ionicons name="reorder-three" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <>
      <Animated.View style={[styles.itemWrapper, { opacity: isActive ? 0.85 : rowOpacity }]}>
        {selectionMode ? (
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
          >
            {rowBody}
          </Swipeable>
        )}

        {expanded && !selectionMode && (
          <View style={styles.expandedPanel}>
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
                task.recurrenceType !== 'none' && { justifyContent: 'space-between' },
              ]}>
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
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={onEdit}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pencil-outline" size={13} color={colors.accent} />
                  <Text style={styles.editBtnText}>Edit</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Animated.View>

      {!selectionMode && (
        <DeferModal
          visible={showDeferModal}
          onConfirm={date => {
            deferTask(task.id, date);
            setShowDeferModal(false);
          }}
          onCancel={() => setShowDeferModal(false)}
        />
      )}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  itemWrapper: {
    marginHorizontal: spacing.md,
    marginVertical: 3,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
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
    paddingVertical: 13,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  priorityBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  circleWrapper: {
    marginLeft: spacing.md,
    padding: 2,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.bgQuaternary,
  },
  circleCompleting: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  circleSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: 21,
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
  effortBadge: {
    backgroundColor: colors.bgQuaternary,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  effortText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  starBtn: {
    padding: 4,
  },
  dragHandle: {
    padding: 4,
    marginLeft: 2,
  },
  subtaskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.bgTertiary,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  subtaskBadgeDone: {
    backgroundColor: colors.green + '22',
  },
  subtaskBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
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
  },
  deferAction: {
    backgroundColor: colors.orange,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
  },
  actionLabel: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: '700',
    letterSpacing: 0.3,
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
    lineHeight: 19,
    paddingVertical: spacing.xs,
  },
  expandSection: {
    gap: 6,
    paddingVertical: spacing.xs,
  },
  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
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
    fontWeight: '600',
  },
  cycleSubtitle: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: '500',
  },
  cycleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent + '22',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  cycleBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.bgTertiary,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  timeBadgeText: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  editSection: {
    paddingTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editBtnText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: '500',
  },
  skipBtnText: {
    color: colors.textSecondary,
  },
});
