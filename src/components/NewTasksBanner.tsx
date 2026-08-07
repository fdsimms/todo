import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, StyleSheet, Animated, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useReduceMotion } from '../utils/useReduceMotion';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useCategoryStore } from '../store/useCategoryStore';
import type { Task } from '../types';

/** How many titles the banner lists before it collapses the rest into "+N more". */
const PREVIEW_LIMIT = 4;

/**
 * Ceiling on the expanded list's height. The banner is a sibling *above* the
 * task list rather than a row inside it, so without a cap a morning that
 * surfaces 26 tasks grows a banner taller than the screen: it pushes the list
 * out of view and, being outside any scroll view, offers nothing to scroll —
 * the only way back to your tasks is to dismiss it. Capped, the overflow
 * scrolls inside the banner and the list keeps its share of the screen.
 */
const MAX_LIST_HEIGHT = Math.round(Dimensions.get('window').height * 0.32);

interface Props {
  tasks: Task[];
  /** Scroll the list below to a new task — the banner marks it seen on the caller's side. */
  onJumpToTask: (task: Task) => void;
  onDismiss: () => void;
}

/**
 * Banner shown on the Today screen when tasks have newly become visible
 * since the user last saw them. Dismissing clears the "new" badge on every
 * one of those tasks (see isTaskNew / markTasksSeen).
 *
 * It names the tasks rather than only counting them: a new task sorts into
 * its category like any other, so it can land at the bottom of a long list
 * (or under a collapsed header) where a bare count tells you nothing about
 * what showed up. Each title carries its category and, tapped, scrolls the
 * list to the row itself — so the banner answers both "what's new" and
 * "where is it", the second one by pointing rather than describing.
 */
export function NewTasksBanner({ tasks, onJumpToTask, onDismiss }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: animation.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);

  const count = tasks.length;
  const shown = collapsed ? [] : showAll ? tasks : tasks.slice(0, PREVIEW_LIMIT);
  const remaining = count - shown.length;

  const handleDismiss = () => {
    haptics.tap();
    onDismiss();
  };

  const toggleCollapsed = () => {
    haptics.tap();
    animateLayout();
    setCollapsed(v => !v);
  };

  const handleShowAll = () => {
    haptics.tap();
    animateLayout();
    setShowAll(true);
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.summary}
          onPress={toggleCollapsed}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={`You have ${count} new todo${count === 1 ? '' : 's'}`}
          accessibilityHint={collapsed ? 'Show which todos are new' : 'Hide the list of new todos'}
        >
          <Text style={styles.text} numberOfLines={1}>
            You have <Text style={styles.count}>{count}</Text> new todo{count === 1 ? '' : 's'}
          </Text>
          <Ionicons
            name={collapsed ? 'chevron-down' : 'chevron-up'}
            size={iconSize.sm}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        <PressableScale style={styles.button} onPress={handleDismiss} accessibilityLabel="Dismiss new todos notice">
          <Text style={styles.buttonText}>OK</Text>
        </PressableScale>
      </View>

      {shown.length > 0 && (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          // Only bounce once there's something to scroll — a four-row preview
          // that rubber-bands reads as broken.
          alwaysBounceVertical={false}
          nestedScrollEnabled
        >
          {shown.map(task => (
            <NewTaskRow key={task.id} task={task} styles={styles} onPress={() => onJumpToTask(task)} />
          ))}
          {remaining > 0 && (
            <TouchableOpacity
              style={styles.moreRow}
              onPress={handleShowAll}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Show ${remaining} more new todo${remaining === 1 ? '' : 's'}`}
            >
              <Text style={styles.moreText}>+{remaining} more</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </Animated.View>
  );
}

function NewTaskRow({
  task,
  styles,
  onPress,
}: {
  task: Task;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  const categoryEmoji = useCategoryStore(s => (task.category ? s.getCategoryByName(task.category)?.emoji ?? null : null));
  const categoryLabel = task.category
    ? categoryEmoji ? `${categoryEmoji} ${task.category}` : task.category
    : null;

  return (
    <TouchableOpacity
      style={styles.taskRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={
        categoryLabel ? `Show ${task.title} in the list, in ${task.category}` : `Show ${task.title} in the list`
      }
    >
      <View style={styles.dot} />
      <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
      {categoryLabel && (
        <Text style={styles.taskCategory} numberOfLines={1}>{categoryLabel}</Text>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.warningBg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  count: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onWarning, fontSize: font.sm, fontWeight: fontWeight.bold },
  list: {
    marginTop: spacing.xs,
    // flexGrow: 0 keeps the ScrollView sized to its content up to the cap
    // rather than filling whatever the banner's parent offers.
    flexGrow: 0,
    maxHeight: MAX_LIST_HEIGHT,
  },
  listContent: {
    paddingRight: spacing.xs,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  taskTitle: { flexShrink: 1, color: colors.text, fontSize: font.sm },
  // Sits with the title rather than pushed to the far edge: it qualifies the
  // title ("Play violin, the one in Hobbies"), and a right-aligned column of
  // them read as a separate list of its own — one that moved around, since a
  // row without a category had nothing in it.
  taskCategory: {
    flexShrink: 0,
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  moreRow: { paddingVertical: spacing.xs },
  moreText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold },
});
