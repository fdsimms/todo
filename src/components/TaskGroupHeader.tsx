import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task, TaskGroup } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, interaction, type Colors } from '../theme';
import { groupRoster, isRelevantToGroupToday } from '../utils/visibilityUtils';
import { tagColor } from '../utils/tagColor';
import { haptics } from '../utils/haptics';
import { WhenPicker } from './WhenPicker';
import { SpotlightScrim } from './SpotlightOverlay';
import { SwipeableRow } from './SwipeableRow';
import { AnimatedCollapsible } from './AnimatedCollapsible';
import { PinIcon } from './PinIcon';
import { useSheetMount } from '../hooks/useSheetMount';

interface Props {
  group: TaskGroup;
  // Every child regardless of current visibility — drives the "N/M done
  // today" tally (isRelevantToGroupToday), which needs to see completed and
  // not-yet-due children too, not just what's currently rendered below. Raw,
  // so it still carries every tombstone a recurring member has left behind
  // — routed through groupRoster() below before anything counts it, the same
  // as every other reader of a stack's membership.
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
  /**
   * What is actually drawn under this header, when a caller can't take that
   * from `group.collapsed` alone. A project screen force-opens an empty stack
   * whatever the stored flag says (collapse hides rows and an empty one has
   * none, so collapsed it would be a bare title with no way to reach the
   * button that fills it in) — and the chevron read the flag raw, so that
   * stack sat open under a collapsed chevron and a tap moved only the
   * chevron. Defaults to the stored flag, which is what every other caller
   * wants.
   */
  expanded?: boolean;
  // Takes the group's own id back for the reason the four below it do, and
  // needs it more than they do: this header is memoized, and its collapse is
  // the one transition a stray re-commit is visible in (see
  // AnimatedCollapsible), so a fresh closure per group per render would both
  // defeat the memo and land inside the 250ms it matters.
  onToggleCollapse: (groupId: string) => void;
  // These three (plus onPressEdit below) take the group's own id back rather
  // than closing over it — the same reason TaskItem's row handlers take
  // `task.id` — so TodayScreen can hand every header one stable `useCallback`
  // instead of a fresh closure per group per render.
  onComplete: (groupId: string) => void;
  onDefer: (groupId: string, date: Date) => void;
  // Swipe left enters bulk editing with the stack's live roster selected —
  // see the roster note in TodayScreen. Omitted on a list with no bulk bar,
  // which hides the panel rather than revealing a no-op.
  onSwipeSelect?: (groupId: string) => void;
  onPressEdit: (groupId: string) => void;
  /** Long-pressing the title starts dragging the whole group (see TodayScreen). */
  onDrag?: () => void;
  /**
   * Whether every pin-eligible member (see pinGroup) is currently pinned —
   * drives the button's filled/orange state. Ignored when onPressPin is
   * omitted.
   */
  pinned?: boolean;
  /** True when there is nothing eligible to pin right now — greys the button out rather than hiding it, matching the stack editor's own pin-all button. */
  pinDisabled?: boolean;
  /** Omitted, no pin button renders at all. */
  onPressPin?: (groupId: string) => void;
}

/**
 * Memoized, and that is load-bearing rather than an optimisation.
 *
 * This header folds its summary line away on the same clock the tray below it
 * runs (see the AnimatedCollapsible further down), and a React commit landing
 * inside those 250ms repaints that section at a clamp the animation has
 * already moved off — AnimatedCollapsible's own header is the long version of
 * why. Today re-renders for reasons that have nothing to do with this stack (a
 * minute tick, any store write), and its list doesn't virtualize, so without
 * this every stack on screen took that commit. Every prop it is handed is kept
 * referentially stable at the call sites for the same reason; see the note on
 * `onToggleCollapse`.
 */
export const TaskGroupHeader = React.memo(function TaskGroupHeader({
  group,
  allChildren,
  dueTodayOverride,
  filtered,
  expanded,
  onToggleCollapse,
  onComplete,
  onDefer,
  onSwipeSelect,
  onPressEdit,
  onDrag,
  pinned = false,
  pinDisabled = false,
  onPressPin,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isExpanded = expanded ?? !group.collapsed;
  const toggleCollapse = useCallback(() => onToggleCollapse(group.id), [onToggleCollapse, group.id]);
  const [showDefer, setShowDefer] = useState(false);
  // Mounted on first open and kept, so it closes through `visible` rather
  // than by leaving the tree. See useSheetMount.
  const mountDefer = useSheetMount(showDefer);

  const dueToday = useMemo(
    () => dueTodayOverride ?? groupRoster(allChildren).filter(isRelevantToGroupToday),
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
    onComplete(group.id);
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
              onSelect: () => onSwipeSelect(group.id),
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
                onPress={toggleCollapse}
                onLongPress={completeAll}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
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
                onPress={toggleCollapse}
                onLongPress={onDrag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
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
                    ? `${isExpanded ? 'Double tap to collapse.' : 'Double tap to expand.'} Long press to reorder.`
                    : isExpanded ? 'Double tap to collapse' : 'Double tap to expand'
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
                  <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textTertiary} />
                </View>
                {/* Folded away rather than unmounted, on the same clock and
                    easing TaskGroupBody's own collapse runs (AnimatedCollapsible
                    owns both). Rendering this on `group.collapsed` alone took a
                    line of text out of the header in the very commit that
                    started the body opening — an unanimated ~6pt step (~17pt
                    with tags, which ride along under it) against a 250ms grow.
                    Everything below the stack jumped *up* by that step on the
                    first frame and then eased back down, which is what read as
                    a jitter rather than a slide, and near the end of the list
                    the momentary content shrink also tripped ReorderableList's
                    bottom clamp. Collapsing was the same thing mirrored. */}
                {summary !== null && (
                  <AnimatedCollapsible expanded={!isExpanded}>
                    <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
                  </AnimatedCollapsible>
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

              {onPressPin && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); onPressPin(group.id); }}
                  disabled={pinDisabled}
                  hitSlop={8}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pinDisabled, selected: pinned }}
                  accessibilityLabel={`${pinned ? 'Unpin' : 'Pin'} all tasks in ${group.title}`}
                >
                  <PinIcon
                    filled={pinned}
                    size={iconSize.sm}
                    color={pinDisabled ? colors.textTertiary : (pinned ? colors.orange : colors.textSecondary)}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => onPressEdit(group.id)}
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

      {/* Mounted on first open — see the same note in TaskItem. */}
      {mountDefer && (
        <WhenPicker
          visible={showDefer}
          value={null}
          title="Reschedule"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={date => { setShowDefer(false); if (date) onDefer(group.id, date); }}
          onCancel={() => setShowDefer(false)}
        />
      )}
    </>
  );
});

// The stack's leading tile, and the gap between it and the title.
const GLYPH_SIZE = 30;
const GLYPH_GAP = 10;
// The header's height with nothing under the title, and what the tile, the
// title and the buttons are each centred on by arithmetic — see `row` for why
// `alignItems: 'center'` no longer does that job.
const BAND_MIN_HEIGHT = 48;
const ICON_BTN_SIZE = iconSize.sm + spacing.sm * 2;

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
   * uppercase, tertiary), stack caption (17pt regular + tile), task card.
   */
  band: {
    // Geometry belongs to the tray. The one thing kept here is an opaque
    // background — SwipeableRow renders its action panels *under* the row and
    // slides the row off them, so a truly transparent header would show the
    // orange panel straight through its own text. It matches the tray exactly.
    backgroundColor: colors.bgSunken,
    // Matches cardClip's radius (below) so this view's own background paints
    // rounded too — same reasoning as TaskItem's itemWrapper/cardClip split.
    // cardClip only clips its *children* (the row content and SpotlightScrim)
    // to a rounded rect; without a matching radius here, band's flat corners
    // sit just outside that clip and stay unpainted by the scrim, so a
    // spotlighted task leaves this header's corners undimmed while the rest
    // of it recedes.
    borderRadius: radius.md,
  },
  cardClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    // Top-aligned, with the tile, the title and the buttons each pinned at
    // the offset that centres it on BAND_MIN_HEIGHT — deliberately not
    // `alignItems: 'center'`, which is what this was. Centring measured the
    // whole content column, and that column changes height on every frame of
    // the summary line folding in or out (it runs alongside TaskGroupBody's
    // own collapse): the 10pt of minHeight slack was handed back and forth,
    // so the title crept up ~5pt through the first half of a toggle and the
    // tile and buttons sank ~5pt through the second, in the one row the eye
    // is on when it taps. Nothing here moves now; the summary grows under a
    // title that stays put. The price is a collapsed header up to ~8pt
    // taller than before (63 against 55 in a CSS mock with the real tokens),
    // with the extra above the title, since the title no longer slides up to
    // make room for the line under it; an expanded header is the same 48.
    alignItems: 'flex-start',
    minHeight: BAND_MIN_HEIGHT,
    backgroundColor: colors.bgSunken,
  },
  glyphWrapper: {
    // No padding: the tile's leading edge lines up with the left edge of the
    // cards below it, hitSlop does the finger-target work.
    marginRight: GLYPH_GAP,
    marginTop: (BAND_MIN_HEIGHT - GLYPH_SIZE) / 2,
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
    // Asymmetric on purpose: the top inset centres the title's line box on
    // BAND_MIN_HEIGHT (see `row`), the bottom is the gap under whatever the
    // last line is — the title, the summary, or a row of tags.
    paddingTop: (BAND_MIN_HEIGHT - lineHeight.lg) / 2,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  // Bold read as a heading for every task below it, not just a label for the
  // stack itself (#1728) — regular weight, same as a task title, with only
  // the larger size (still two steps up from font.md) marking it as a
  // heading rather than one more row.
  title: {
    flexShrink: 1,
    color: colors.text,
    fontSize: font.lg,
    // Explicit so `content`'s top inset can centre it by arithmetic rather
    // than by measurement.
    lineHeight: lineHeight.lg,
    fontWeight: fontWeight.regular,
    letterSpacing: -0.2,
  },
  progressText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    // Nudged onto the title's baseline; centring it on a 17pt line leaves it
    // sitting visibly high against the cap height.
    marginTop: spacing.xxs,
  },
  summary: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    marginTop: 3,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  tagChip: {
    paddingHorizontal: spacing.xsm,
    paddingVertical: 1,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  tagChipText: {
    fontSize: font.xxs,
    fontWeight: fontWeight.medium,
  },
  iconBtn: {
    padding: spacing.sm,
    marginTop: (BAND_MIN_HEIGHT - ICON_BTN_SIZE) / 2,
  },
});
