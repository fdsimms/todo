import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task, TaskGroup } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, animation, type Colors } from '../theme';
import { isRelevantToGroupToday, isGroupHiddenToday } from '../utils/visibilityUtils';
import { tagColor } from '../utils/tagColor';
import { haptics } from '../utils/haptics';
import { WhenPicker } from './WhenPicker';
import { SpotlightScrim } from './SpotlightOverlay';
import { SwipeableRow } from './SwipeableRow';

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
  // True when the list this header sits in is narrowed by an active
  // priority/effort filter. The tally is deliberately computed from the full
  // roster (see dueTodayOverride above) rather than what's rendered below,
  // so under a filter it can show a "3/8" badge next to two visible child
  // rows — a count that's honest about the stack but not about what's on
  // screen. Rather than pick a set to lie about, the badge and summary just
  // don't render while a filter is narrowing the list underneath them.
  filtered?: boolean;
  onToggleCollapse: () => void;
  onComplete: () => void;
  // Fires when the user taps an already-fully-done stack — stamps the group
  // dismissed so it drops off Today, rather than toggling any child's
  // completed state (see dismissGroup in useTaskStore).
  onDismiss: () => void;
  onDefer: (date: Date) => void;
  // Swipe left enters bulk editing with the stack's live roster selected —
  // see the roster note in TodayScreen. Omitted on a list with no bulk bar,
  // which hides the panel rather than revealing a no-op.
  onSwipeSelect?: () => void;
  onPressEdit: () => void;
  /** Long-pressing the title starts dragging the whole group (see TodayScreen). */
  onDrag?: () => void;
}

export function TaskGroupHeader({
  group,
  allChildren,
  dueTodayOverride,
  filtered,
  onToggleCollapse,
  onComplete,
  onDismiss,
  onDefer,
  onSwipeSelect,
  onPressEdit,
  onDrag,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const [showDefer, setShowDefer] = useState(false);
  // Mirrors TaskItem's completion animation so dismissing a fully-done stack
  // shows the same pop-checkmark beat as completing an individual task,
  // instead of the row just vanishing the instant it's tapped.
  const [dismissing, setDismissing] = useState(false);
  const circleScale = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  const dueToday = useMemo(
    () => dueTodayOverride ?? allChildren.filter(isRelevantToGroupToday),
    [dueTodayOverride, allChildren],
  );
  const doneToday = dueToday.filter(c => c.completed).length;
  const totalToday = dueToday.length;
  const allDone = totalToday > 0 && doneToday === totalToday;
  // The circle only shows checked once the user has explicitly dismissed a
  // fully-done stack — allDone alone used to drive this and made the
  // checkmark appear the instant the last child finished, with no way to
  // actually clear the stack out of Today. Now allDone just makes the circle
  // tappable-to-dismiss; it stays visually empty until then.
  //
  // Requiring allDone alongside the stamp is what keeps a dismissed stack
  // honest: the moment it gains live work again (a spawn, an undo, a task
  // added to it) allDone goes false and the stack shows itself, with no
  // separate bookkeeping to clear the stamp. And the stamp itself only
  // counts for the logical day it was made, so a nightly stack returns on
  // its own tomorrow.
  const dismissed = isGroupHiddenToday(group.completedAt, dueToday);

  // Collapsed, the stack has to speak for itself: the children that would
  // have answered "how much is left, and what's next" aren't on screen. This
  // is also the one place with room to spell out which count the badge is —
  // the roster ("8 tasks", in the editor) and today's work are different
  // numbers, and a bare "3/8" pill doesn't say which one it means.
  const nextUp = dueToday.find(c => !c.completed);
  const summary = totalToday === 0 || filtered ? null
    : `${doneToday} of ${totalToday} done today${nextUp ? ` · Next: ${nextUp.title}` : ''}`;
  const showTally = totalToday > 0 && !filtered;

  const completeAll = () => {
    if (dismissed || dismissing || allDone) return;
    haptics.impactMedium();
    onComplete();
  };

  return (
    <>
      <View>
        <View style={[
          styles.itemWrapper,
          styles.lidSurface,
          !group.collapsed && styles.itemWrapperExpanded,
        ]}>
          <View style={styles.cardClip}>
            {/* Deleting a stack lives in TaskGroupEditor (behind the ⋯), not
                here. It used to be this row's swipe-left, which both put a
                destructive action one flick away and meant the gesture said
                "delete" on stacks and "select" on every task under them. */}
            <SwipeableRow
              selectAction={onSwipeSelect ? {
                onSelect: onSwipeSelect,
                accessibilityLabel: `Select all of ${group.title}`,
              } : undefined}
              whenAction={{
                onAction: () => setShowDefer(true),
                accessibilityLabel: `Reschedule all of ${group.title}`,
              }}
            >
              <View style={[styles.row, styles.lidSurface, !group.collapsed && styles.lidSeam]}>
                {/* A rounded square, deliberately not the circle a task row
                    uses: this control cascades across the whole roster, and
                    for a while it wore the exact shape, size, position and
                    colour of a single task's checkbox while meaning something
                    an order of magnitude bigger. It's a touch larger than that
                    checkbox too, so the header reads as heavier than the rows
                    hanging off it. */}
                <TouchableOpacity
                  onPress={() => {
                    if (dismissed || dismissing) return;
                    // Tap on a stack that still has work in it is just the
                    // row's own expand/collapse — completing every child is a
                    // long-press instead. Tap used to cascade, which put an
                    // N-task completion (with its recurrence spawns, chain
                    // advances and streak writes) one stray tap away from the
                    // child checkboxes directly below it.
                    if (!allDone) {
                      onToggleCollapse();
                      return;
                    }
                    haptics.success();
                    setDismissing(true);
                    checkScale.setValue(0);
                    Animated.spring(checkScale, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
                    Animated.sequence([
                      Animated.spring(circleScale, { toValue: 1.35, ...animation.spring.snappy, useNativeDriver: true }),
                      Animated.spring(circleScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
                      Animated.delay(120),
                    ]).start(({ finished }) => {
                      if (finished) onDismiss();
                    });
                  }}
                  onLongPress={completeAll}
                  delayLongPress={interaction.delayLongPress}
                  hitSlop={10}
                  style={styles.glyphWrapper}
                  accessibilityRole="button"
                  accessibilityLabel={
                    dismissed ? `${group.title} cleared for today` : `Clear completed ${group.title} stack`
                  }
                  // Until the stack is finished this glyph does nothing the
                  // row itself doesn't (tap collapses either way), and its
                  // one unique function — complete-all — is a long-press,
                  // which VoiceOver can't reach. So it stays out of the
                  // accessibility tree until it becomes the dismiss control,
                  // and complete-all rides on the row as a rotor action
                  // instead of as a second element saying the same thing.
                  accessibilityElementsHidden={!allDone && !dismissed}
                  importantForAccessibility={!allDone && !dismissed ? 'no-hide-descendants' : 'yes'}
                >
                  <Animated.View style={[
                    styles.glyph,
                    (dismissed || dismissing) && styles.glyphDone,
                    { transform: [{ scale: circleScale }] },
                  ]}>
                    {dismissed ? (
                      <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />
                    ) : dismissing ? (
                      <Animated.View style={{ transform: [{ scale: checkScale }] }}>
                        <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />
                      </Animated.View>
                    ) : (
                      <Ionicons name="layers-outline" size={iconSize.sm} color={colors.textSecondary} />
                    )}
                  </Animated.View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.content}
                  onPress={onToggleCollapse}
                  onLongPress={onDrag}
                  delayLongPress={interaction.delayLongPress}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !group.collapsed }}
                  // Spells the tally out rather than leaving it to the badge:
                  // a label set here overrides the row's children, so the
                  // "3/8" pill is invisible to a screen reader on its own.
                  accessibilityLabel={
                    showTally
                      ? `${group.title} stack, ${doneToday} of ${totalToday} done today`
                      : `${group.title} stack`
                  }
                  accessibilityHint={
                    onDrag
                      ? `${group.collapsed ? 'Double tap to expand.' : 'Double tap to collapse.'} Long press to reorder.`
                      : group.collapsed ? 'Double tap to expand' : 'Double tap to collapse'
                  }
                  // Complete-all is a long-press on the glyph, which VoiceOver
                  // has no gesture for — it's offered here as a rotor action so
                  // it isn't sighted-only.
                  accessibilityActions={allDone || dismissed ? undefined : [{ name: 'longpress', label: 'Complete all' }]}
                  onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'longpress') completeAll(); }}
                >
                  <View style={styles.titleRow}>
                    <Text style={styles.title} numberOfLines={1}>{group.title}</Text>
                    {showTally && (
                      <View style={styles.progressBadge}>
                        <Text style={styles.progressText}>{doneToday}/{totalToday}</Text>
                      </View>
                    )}
                    <Ionicons name={group.collapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={colors.textTertiary} />
                  </View>
                  {group.collapsed && summary !== null && (
                    <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
                  )}
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

                {/* Pin-all used to sit here beside the ⋯. Two always-on icon
                    buttons made the header the busiest row on the screen for
                    the rarest action on it; it lives in the stack editor now. */}
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
            </SwipeableRow>
            <SpotlightScrim />
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

// The stack's leading glyph, and the geometry the body's rail is aligned to.
const GLYPH_SIZE = 28;
const GLYPH_PADDING = 2;
/** Centre of the leading glyph, measured from the screen edge — TaskGroupBody
 *  hangs its rail here so the children read as descending from the glyph. */
export const STACK_RAIL_X = spacing.md + GLYPH_PADDING + GLYPH_SIZE / 2;

const makeStyles = (colors: Colors, isDark: boolean) => StyleSheet.create({
  itemWrapper: {
    marginHorizontal: spacing.md,
    marginTop: 2,
    marginBottom: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  // A lid sits directly on what it covers: the gap underneath an expanded
  // header closes, so the stack reads as one block rather than a run of
  // separate cards that happen to be adjacent. TaskGroupBody's rail crosses
  // the seam. Collapsed, there's nothing to sit on and the gap comes back.
  itemWrapperExpanded: {
    marginBottom: 0,
  },
  cardClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: colors.bgSecondary,
  },
  // Dark themes can step the header up a surface level and have it read as a
  // lid over the children. Light can't: bgTertiary there (#EFEFF4) lands
  // within a hair of the page background (#F2F2F7), so the header would sink
  // into the page instead of covering the cards. It keeps the card surface
  // and takes a hairline along its underside instead — same job, done with
  // the tool that theme has. Hence the split: the raised surface identifies a
  // stack whether it's open or shut, but the seam only exists when there is
  // something below the header to be divided from.
  lidSurface: isDark ? { backgroundColor: colors.bgTertiary } : {},
  lidSeam: isDark ? {} : { borderBottomWidth: border.hairline, borderBottomColor: colors.separator },
  glyphWrapper: {
    marginLeft: spacing.md,
    padding: GLYPH_PADDING,
  },
  glyph: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderRadius: radius.sm,
    borderWidth: border.sm,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphDone: {
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
  summary: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: 3,
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
});
