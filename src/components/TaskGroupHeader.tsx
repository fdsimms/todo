import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task, TaskGroup } from '../types';
import { PRIORITY_COLORS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { isRelevantToGroupToday } from '../utils/visibilityUtils';
import { tagColor } from '../utils/tagColor';
import { haptics } from '../utils/haptics';
import { WhenPicker } from './WhenPicker';

interface Props {
  group: TaskGroup;
  // Every child regardless of current visibility — drives the "N/M done
  // today" tally (isRelevantToGroupToday), which needs to see completed and
  // not-yet-due children too, not just what's currently rendered below.
  allChildren: Task[];
  // Overrides the "N/M" tally with an explicit child list instead of
  // deriving it from allChildren via isRelevantToGroupToday. Needed inside
  // Later Today, where a group's children are deferred and so never
  // currently visible — isRelevantToGroupToday would always read them as not
  // due, and the badge would never appear.
  dueTodayOverride?: Task[];
  onToggleCollapse: () => void;
  onComplete: () => void;
  onUncomplete: () => void;
  onDefer: (date: Date) => void;
  onPin: () => void;
  onDeleteGroupOnly: () => void;
  onDeleteWithTasks: () => void;
  onPressEdit: () => void;
  dimmed?: boolean;
  /** Long-pressing the title starts dragging the whole group (see TodayScreen). */
  onDrag?: () => void;
}

export function TaskGroupHeader({
  group,
  allChildren,
  dueTodayOverride,
  onToggleCollapse,
  onComplete,
  onUncomplete,
  onDefer,
  onPin,
  onDeleteGroupOnly,
  onDeleteWithTasks,
  onPressEdit,
  dimmed = false,
  onDrag,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showDefer, setShowDefer] = useState(false);
  const swipeableRef = useRef<Swipeable>(null);

  const dueToday = useMemo(
    () => dueTodayOverride ?? allChildren.filter(isRelevantToGroupToday),
    [dueTodayOverride, allChildren],
  );
  const doneToday = dueToday.filter(c => c.completed).length;
  const totalToday = dueToday.length;
  const allDone = totalToday > 0 && doneToday === totalToday;

  const confirmDelete = () => {
    Alert.alert(
      'Delete Stack',
      `Delete "${group.title}"?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => swipeableRef.current?.close() },
        { text: 'Delete This Stack', onPress: onDeleteGroupOnly },
        { text: 'Delete Stack and All Its Tasks', style: 'destructive', onPress: onDeleteWithTasks },
      ],
    );
  };

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => { haptics.impactHeavy(); confirmDelete(); }}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${group.title}`}
    >
      <Ionicons name="trash" size={iconSize.md} color={colors.text} />
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.deferAction}
      onPress={() => { haptics.impactMedium(); swipeableRef.current?.close(); setShowDefer(true); }}
      accessibilityRole="button"
      accessibilityLabel={`Reschedule all of ${group.title}`}
    >
      <Ionicons name="time" size={iconSize.md} color={colors.text} />
    </TouchableOpacity>
  );

  return (
    <>
      <View>
        <View style={styles.itemWrapper}>
          <View style={styles.cardClip}>
            <Swipeable
              ref={swipeableRef}
              renderRightActions={renderRightActions}
              renderLeftActions={renderLeftActions}
              overshootRight={false}
              overshootLeft={false}
              onSwipeableWillOpen={() => haptics.impactMedium()}
              onSwipeableOpen={direction => {
                if (direction === 'right') confirmDelete();
                else { swipeableRef.current?.close(); setShowDefer(true); }
              }}
            >
              <View style={styles.row}>
                {group.priority > 0 && (
                  <View style={[styles.priorityBar, { backgroundColor: PRIORITY_COLORS[group.priority] }]} />
                )}

                <TouchableOpacity
                  onPress={() => { haptics.tap(); allDone ? onUncomplete() : onComplete(); }}
                  hitSlop={10}
                  style={styles.circleWrapper}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: allDone }}
                  accessibilityLabel={allDone ? `Uncheck ${group.title}` : `Complete all of ${group.title}`}
                >
                  <View style={[styles.circle, allDone && styles.circleDone]}>
                    {allDone && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.content}
                  onPress={onToggleCollapse}
                  onLongPress={onDrag}
                  delayLongPress={interaction.delayLongPress}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !group.collapsed }}
                  accessibilityLabel={group.title}
                  accessibilityHint={
                    onDrag
                      ? `${group.collapsed ? 'Double tap to expand.' : 'Double tap to collapse.'} Long press to reorder.`
                      : group.collapsed ? 'Double tap to expand' : 'Double tap to collapse'
                  }
                >
                  <View style={styles.titleRow}>
                    {onDrag && <Ionicons name="reorder-three" size={14} color={colors.textTertiary} />}
                    <Ionicons name="layers-outline" size={iconSize.xs} color={colors.textTertiary} />
                    <Text style={styles.title} numberOfLines={1}>{group.title}</Text>
                    {totalToday > 0 && (
                      <View style={styles.progressBadge}>
                        <Text style={styles.progressText}>{doneToday}/{totalToday}</Text>
                      </View>
                    )}
                    <Ionicons name={group.collapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={colors.textTertiary} />
                  </View>
                  {group.tags.length > 0 && (
                    <View style={styles.tagsRow}>
                      {group.tags.map(tag => (
                        <View key={tag} style={[styles.tagChip, { borderColor: tagColor(tag) }]}>
                          <Text style={[styles.tagChipText, { color: tagColor(tag) }]} numberOfLines={1}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { haptics.tap(); onPin(); }}
                  hitSlop={8}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Pin all of ${group.title}`}
                >
                  <Ionicons name="pin-outline" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={onPressEdit}
                  hitSlop={8}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${group.title} stack`}
                >
                  <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </Swipeable>
            {dimmed && (
              <View style={styles.scrim} pointerEvents="none" />
            )}
          </View>
        </View>
      </View>

      <WhenPicker
        visible={showDefer}
        value={null}
        title="Reschedule"
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => { setShowDefer(false); if (date) onDefer(date); }}
        onCancel={() => setShowDefer(false)}
      />
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
  cardClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    backgroundColor: colors.bgSecondary,
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
  circleDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  content: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flexShrink: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  progressBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  progressText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  tagChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  tagChipText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
  },
  iconBtn: {
    padding: spacing.sm,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  deleteAction: {
    width: 72,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deferAction: {
    width: 72,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
