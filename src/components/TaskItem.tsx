import React, { useRef, useState } from 'react';
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
import { colors, spacing, radius, font } from '../theme';
import { tagColor } from '../utils/tagColor';
import { formatDueDate, formatDeferUntil, getStreakDisplay } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { DeferModal } from './DeferModal';

interface Props {
  task: Task;
  onPress: () => void;
  subtaskCount?: number;
  subtaskDoneCount?: number;
}

export function TaskItem({ task, onPress, subtaskCount = 0, subtaskDoneCount = 0 }: Props) {
  const completeTask = useTaskStore(s => s.completeTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const deferTask = useTaskStore(s => s.deferTask);
  const toggleFocus = useTaskStore(s => s.toggleFocus);

  const [showDeferModal, setShowDeferModal] = useState(false);
  const [completing, setCompleting] = useState(false);
  const circleScale = useRef(new Animated.Value(1)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  const swipeableRef = useRef<Swipeable>(null);

  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    new Date(task.dueDate).toDateString() !== new Date().toDateString();

  const streak = getStreakDisplay(task);
  const priorityColor = PRIORITY_COLORS[task.priority];
  const effortLabel = task.effort > 0 ? EFFORT_LABELS[task.effort] : null;

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

  return (
    <>
      <Animated.View style={[styles.itemWrapper, { opacity: rowOpacity }]}>
        <Swipeable
          ref={swipeableRef}
          containerStyle={styles.swipeContainer}
          renderRightActions={renderRightActions}
          renderLeftActions={renderLeftActions}
          overshootRight={false}
          overshootLeft={false}
        >
          <View style={styles.row}>
            {/* Priority indicator — colored left border */}
            {task.priority > 0 && (
              <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />
            )}

            <TouchableOpacity onPress={handleComplete} hitSlop={10} style={styles.circleWrapper}>
              <Animated.View style={[
                styles.circle,
                completing && styles.circleCompleting,
                { transform: [{ scale: circleScale }] },
              ]} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.content} onPress={onPress} activeOpacity={0.7}>
              <Text style={styles.title} numberOfLines={2}>{task.title}</Text>

              <View style={styles.meta}>
                {/* Tag color dots */}
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

            {/* Focus star */}
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
          </View>
        </Swipeable>
      </Animated.View>

      <DeferModal
        visible={showDeferModal}
        onConfirm={date => {
          deferTask(task.id, date);
          setShowDeferModal(false);
        }}
        onCancel={() => setShowDeferModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
    borderColor: '#545458',
  },
  circleCompleting: {
    backgroundColor: colors.green,
    borderColor: colors.green,
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
});
