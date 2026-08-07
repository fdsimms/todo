import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task, TaskGroup } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { isRelevantToGroupToday } from '../utils/visibilityUtils';
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
  onDefer,
  onSwipeSelect,
  onPressEdit,
  onDrag,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showDefer, setShowDefer] = useState(false);

  const dueToday = useMemo(
    () => dueTodayOverride ?? allChildren.filter(isRelevantToGroupToday),
    [dueTodayOverride, allChildren],
  );
  const doneToday = dueToday.filter(c => c.completed).length;
  const totalToday = dueToday.length;
  // Only guards complete-all from re-running on a stack with nothing left to
  // complete. There's no done *state* for this header to show: a stack whose
  // work for today is finished has no visible rows left, so Today stops
  // rendering it entirely (see visibleGroupItems in TodayScreen).
  const allDone = totalToday > 0 && doneToday === totalToday;

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
    if (allDone) return;
    haptics.impactMedium();
    onComplete();
  };

  return (
    <>
      <View style={styles.band}>
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
            <View style={styles.row}>
              {/* A filled tile, deliberately not the outlined box a task row
                  uses: this control cascades across the whole roster, and for
                  a while it wore the exact shape, size, position and colour of
                  a single task's checkbox while meaning something an order of
                  magnitude bigger. Shape alone stopped carrying that once the
                  checkboxes became rounded squares themselves — what separates
                  them now is that this one is bigger (30 vs 20), *filled*
                  rather than outlined, holds a layers glyph, and sits in the
                  gutter to the left of the column its tasks occupy. Keep at
                  least the fill and the size if either ever changes. */}
              <TouchableOpacity
                // Tap is just the row's own expand/collapse — completing every
                // child is a long-press instead. Tap used to cascade, which put
                // an N-task completion (with its recurrence spawns, chain
                // advances and streak writes) one stray tap away from the child
                // checkboxes directly below it.
                onPress={onToggleCollapse}
                onLongPress={completeAll}
                delayLongPress={interaction.delayLongPress}
                hitSlop={10}
                style={styles.glyphWrapper}
                // This glyph does nothing the row itself doesn't (tap collapses
                // either way), and its one unique function — complete-all — is
                // a long-press, which VoiceOver can't reach. So it stays out of
                // the accessibility tree entirely, and complete-all rides on
                // the row as a rotor action instead of as a second element
                // saying the same thing.
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={styles.glyph}>
                  <Ionicons name="layers" size={iconSize.sm} color={colors.textSecondary} />
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
                // Spells the tally out rather than leaving it to the glyph:
                // a label set here overrides the row's children, so the
                // "3/8" is invisible to a screen reader on its own.
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
                accessibilityActions={allDone ? undefined : [{ name: 'longpress', label: 'Complete all' }]}
                onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'longpress') completeAll(); }}
              >
                <View style={styles.titleRow}>
                  <Text style={styles.title} numberOfLines={1}>{group.title}</Text>
                  {/* Bare type, not a filled pill: the header has no card
                      behind it any more, and a tinted capsule floating on
                      the page background was the last thing left reading as
                      a selected chip. */}
                  {showTally && (
                    <Text style={styles.progressText}>{doneToday}/{totalToday}</Text>
                  )}
                  <Ionicons name={group.collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textTertiary} />
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

      {/* Mounted only while open — see the same note in TaskItem. */}
      {showDefer && (
        <WhenPicker
          visible
          value={null}
          title="Reschedule"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={date => { setShowDefer(false); if (date) onDefer(date); }}
          onCancel={() => setShowDefer(false)}
        />
      )}
    </>
  );
}

// The stack's leading tile, and the gap between it and the title.
const GLYPH_SIZE = 30;
const GLYPH_GAP = 10;

const makeStyles = (colors: Colors) => StyleSheet.create({
  /**
   * A caption, not a card — the one row in the app that isn't one.
   *
   * Every earlier version of this header was a filled rounded rectangle the
   * same width and shape as the task rows below it: first on the card surface,
   * then stepped up to bgTertiary to read as a "lid" over them. The lid is the
   * trap. A row that looks exactly like its neighbours but a shade brighter
   * doesn't read as *higher*, it reads as *selected* — bgTertiary is the
   * surface this app uses for a pressed row and a dragged one, so a resting
   * stack looked permanently mid-interaction.
   *
   * No amount of re-tinting fixes that; the header has to leave the card
   * vocabulary. Nothing here is filled or rounded except the tile. What keeps
   * it attached to its tasks is TaskGroupTray, the region both sit in — which
   * is also why this can be transparent enough to work: the grouping doesn't
   * depend on the header resembling anything.
   *
   * Three unambiguous levels end up on screen: category caption (tiny,
   * uppercase, tertiary), stack caption (17pt bold + tile), task card.
   */
  band: {
    // Geometry belongs to the tray. The one thing kept here is an opaque
    // background — SwipeableRow renders its action panels *under* the row and
    // slides the row off them, so a truly transparent header would show the
    // orange panel straight through its own text. It matches the tray exactly.
    backgroundColor: colors.bgSunken,
  },
  cardClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    backgroundColor: colors.bgSunken,
  },
  glyphWrapper: {
    // No padding: the tile's leading edge lines up with the left edge of the
    // cards below it, hitSlop does the finger-target work.
    marginRight: GLYPH_GAP,
  },
  glyph: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderRadius: radius.sm,
    borderWidth: border.sm,
    // A filled tile rather than an outline, and on the *card* surface: it's
    // the one place the stack borrows the colour of the rows it owns, which
    // is what stops a card-less header from looking unfinished. Works in both
    // themes for once — bgSecondary is #1C1C1E on black and #FFFFFF on grey,
    // legible against the page either way.
    backgroundColor: colors.bgSecondary,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  // Two steps up from a task title (font.md regular) — a stack is named once
  // and then read as a heading, so it can afford the weight that would be
  // shouting on a row you have twenty of.
  title: {
    flexShrink: 1,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
  progressText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    // Nudged onto the title's baseline; centring it on a 17pt line leaves it
    // sitting visibly high against the cap height.
    marginTop: 2,
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
