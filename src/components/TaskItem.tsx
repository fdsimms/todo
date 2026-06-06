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
import { colors, spacing, radius, font } from '../theme';
import { tagColor } from '../utils/tagColor';
import { formatDueDate, formatShowAfterTime, formatDeferUntil } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { DeferModal } from './DeferModal';

interface Props {
  task: Task;
  onPress: () => void;
}

export function TaskItem({ task, onPress }: Props) {
  const completeTask = useTaskStore(s => s.completeTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const deferTask = useTaskStore(s => s.deferTask);

  const [showDeferModal, setShowDeferModal] = useState(false);
  const circleScale = useRef(new Animated.Value(1)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  const swipeableRef = useRef<Swipeable>(null);

  const isOverdue =
    task.dueDate && new Date(task.dueDate) < new Date() &&
    new Date(task.dueDate).toDateString() !== new Date().toDateString();

  const handleComplete = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.timing(circleScale, { toValue: 1.3, duration: 80, useNativeDriver: true }),
      Animated.timing(circleScale, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.delay(100),
      Animated.timing(rowOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => completeTask(task.id));
  };

  const handleDelete = async () => {
    swipeableRef.current?.close();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.timing(rowOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      () => deleteTask(task.id)
    );
  };

  const renderRightActions = (_progress: Animated.AnimatedInterpolation<number>) => (
    <TouchableOpacity style={styles.deleteAction} onPress={handleDelete}>
      <Ionicons name="trash" size={20} color={colors.text} />
      <Text style={styles.actionLabel}>Delete</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = (_progress: Animated.AnimatedInterpolation<number>) => (
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
      <Animated.View style={{ opacity: rowOpacity }}>
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          renderLeftActions={renderLeftActions}
          overshootRight={false}
          overshootLeft={false}
        >
          <TouchableOpacity
            style={styles.row}
            onPress={onPress}
            activeOpacity={0.85}
          >
            <TouchableOpacity onPress={handleComplete} hitSlop={10} style={styles.circleWrapper}>
              <Animated.View style={[styles.circle, { transform: [{ scale: circleScale }] }]}>
                {task.completed && (
                  <Ionicons name="checkmark" size={13} color={colors.text} />
                )}
              </Animated.View>
            </TouchableOpacity>

            <View style={styles.content}>
              <Text style={styles.title} numberOfLines={2}>{task.title}</Text>

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
                {task.showAfterTime && (
                  <Text style={styles.metaTextDim}>
                    after {formatShowAfterTime(task.showAfterTime)}
                  </Text>
                )}
                {task.deferUntil && new Date(task.deferUntil) > new Date() && (
                  <Text style={styles.metaTextDim}>
                    deferred · {formatDeferUntil(task.deferUntil)}
                  </Text>
                )}
              </View>
            </View>

            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  circleWrapper: {
    padding: 2,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.bgQuaternary,
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
    fontWeight: '400',
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
  metaTextDim: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  overdue: {
    color: colors.red,
  },
  deleteAction: {
    backgroundColor: colors.red,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 4,
  },
  deferAction: {
    backgroundColor: colors.orange,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 4,
  },
  actionLabel: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: '600',
  },
});
