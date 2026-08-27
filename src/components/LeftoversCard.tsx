import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Leftover, LeftoverFreshness } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useNowTick } from '../hooks/useNowTick';
import { useDragToDay, type DayDragHandlers } from '../hooks/useDragToDay';
import { useFabIntentSelector, type FabIntentChannel } from './FabDropZones';
import { slotLabel } from '../utils/mealPlan';
import {
  describeFridge,
  describeLeftover,
  liveFreshnessOf,
  isPlannedPastKeepUntil,
  liveLeftovers,
} from '../utils/leftovers';

/** How many rows the card shows before folding the rest behind "+N more". */
const COLLAPSED_ROWS = 3;

/**
 * What a row reports while it's being dragged onto the week below it — the
 * shared shape in useDragToDay, named here for the prop that takes it.
 *
 * **The card reports positions and decides nothing.** Where the week is, which
 * day a given pageY is over and what a release there should write are all the
 * screen's business — it already owns the day drop zones the add button uses,
 * so a fridge row dropping onto one goes through exactly the same registry
 * rather than a second copy of the hit-testing. Same split `FabDragHandlers`
 * draws for the add button, and for the same reason. It is also what lets a
 * planned meal be dragged by the identical gesture (see MealSlotRow): the two
 * differ only in what the screen writes at the end of one.
 */
export type LeftoverDragHandlers = DayDragHandlers<Leftover>;

interface Props {
  /** Every leftover the store holds; the card takes the live ones itself. */
  leftovers: readonly Leftover[];
  onPress: (leftover: Leftover) => void;
  /** Puts this container on a night — see the note on the row's two actions. */
  onPlan: (leftover: Leftover) => void;
  onAdd: () => void;
  /** Opens FridgeHistorySheet. Offered only once something has been closed out. */
  onHistory: () => void;
  /**
   * Lets a row be dragged straight onto a day. Omit on any surface with no week
   * under the card — the rows stay tap-and-button only, exactly as they were.
   */
  drag?: LeftoverDragHandlers;
}

/**
 * "In the fridge" — the live leftovers, most urgent first, above the week.
 *
 * **This is the in-app nudge**, and it stays even now that a leftover about
 * to go bad can also spawn a "Use up X" Task (src/utils/leftoverTasks.ts,
 * Task.leftoverId) — the two aren't redundant. The task is what lands on
 * Today, away from the meal plan, for whoever isn't looking at this screen;
 * this card is what lands in front of the user at the exact moment they're
 * deciding what to eat, which is still the moment the nudge is most
 * actionable. Turning the task off in Settings doesn't touch this card.
 *

 * It renders nothing at all when the fridge is empty *and* nothing has been
 * closed out. An empty state here would be a permanent block of chrome on the
 * meal plan for everyone who never uses the feature, and unlike a screen with
 * nothing on it, this one has a whole week underneath it that wants the space.
 *
 * **Each row has two actions, and the card's whole point is the second one.**
 * Tapping the row opens the editor — rename, put-away day, keep-for, delete —
 * which is what it always did and is not what this card is shouting about. The
 * card exists to say "eat this", so the row carries a calendar button that puts
 * the container on a night (#1370). Without it the only route from "the chilli
 * needs eating" to a plan was the add button, the picker, and the "In the
 * fridge" section of it: three steps away from the row already naming the thing.
 *
 * **And the row can be dragged onto a day directly.** The button opens a sheet
 * of day chips, which is two taps and a sheet for a decision the user has
 * usually already made — the week is on screen, right underneath, and Thursday
 * is a thing they can point at. So a hold lifts the container and a release
 * over a day band plans it there, in the meal the band's own width picks (see
 * slotAtX in fabDrop.ts, and DayDropHighlight for the columns it draws). The
 * button stays: a drag is the shortcut, not the route, and it is unreachable
 * with VoiceOver or a shaky hand, so the tappable path has to keep working
 * unchanged (same reason Today keeps a menu item for everything its swipes
 * do).
 *
 * **A drag copies rather than moves, and the row deliberately doesn't leave.**
 * A pot of soup feeds two dinners: planning it against Thursday doesn't take it
 * out of the fridge (see Leftover.finishedAt), so the row dims for the lift and
 * is back at full strength the moment the finger is up.
 *
 * **It never takes more than three rows of the week.** A full fridge is five
 * or six containers, each a two-line row, which is most of a screen standing
 * between the header and Monday — and this card is the thing you read *before*
 * the plan, not instead of it (#1375). The rest fold behind a "+N more" that
 * expands in place, so nothing is hidden, only deferred. Three is what fits
 * above the fold alongside a day or two of the week itself.
 *
 * **History is the one thing that keeps it on screen with an empty fridge**,
 * and only for someone who has actually used the feature inside the last
 * `LEFTOVER_RETENTION_DAYS`. That's a deliberate narrowing of the rule above
 * rather than an exception to it: the objection was to chrome for people who
 * never use this, and a closed-out row is proof they do. It self-clears when
 * the purge takes the last one, so it can't become permanent for someone who
 * has moved on — and the moment the fridge empties is exactly when "did we eat
 * it or bin it" gets asked, which is precisely when the old rule hid the
 * answer. With nothing live it shrinks to a single line — the status and the
 * two icon actions beside it — not to a full empty state.
 */
export function LeftoversCard({ leftovers, onPress, onPlan, onAdd, onHistory, drag }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Every row's age/use-by caption and freshness dot are derived from `now`
  // at render time (describeLeftover, freshnessOf) — this card sits inside
  // MealPlanScreen, which never unmounts, so with nothing else to trigger a
  // re-render those go stale exactly like a memoized TaskItem's clock-derived
  // fields would without this same subscription (#1732; see nowTick.ts).
  useNowTick();

  const [expanded, setExpanded] = useState(false);

  // The hold-and-drop gesture itself, shared with the meal rows on the week
  // below (useDragToDay) — this card owns only what a row looks like while
  // it's lifted.
  const { draggingId, panHandlers, containerHandlers, registerRow, startDrag } =
    useDragToDay<Leftover>(drag);

  const live = useMemo(() => liveLeftovers(leftovers), [leftovers]);
  const hasHistory = useMemo(() => leftovers.some(l => !!l.finishedAt), [leftovers]);
  if (live.length === 0 && !hasHistory) return null;

  // Sorted by urgency (see sortLeftovers), so the ones that fold away are
  // always the ones with the most time left — never the one about to go off.
  const shown = expanded ? live : live.slice(0, COLLAPSED_ROWS);
  const hidden = live.length - shown.length;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="snow-outline" size={iconSize.sm} color={colors.textTertiary} />
          {/* A section header labels the card under it; with the fridge empty
              there is no card, so the same sentence is a status line and is
              styled as one. Uppercase for a zero state put "NOTHING IN THE
              FRIDGE" at the same rank as the day headers below it, which is
              the loudest thing on the screen saying the least. */}
          <Text style={live.length > 0 ? styles.headerText : styles.headerStatus}>
            {describeFridge(leftovers)}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {hasHistory && (
            <TouchableOpacity
              onPress={onHistory}
              activeOpacity={interaction.activeOpacity}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="What happened to past leftovers"
            >
              <Ionicons name="time-outline" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onAdd}
            activeOpacity={interaction.activeOpacity}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Log a leftover"
          >
            <Ionicons name="add-circle" size={iconSize.lg} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </View>

      {live.length > 0 && (
      <View
        style={styles.card}
        {...(drag ? panHandlers : {})}
        // The raw touch alongside the responder — see containerHandlers in
        // useDragToDay for why both are needed.
        {...(drag ? containerHandlers : {})}
      >
        {shown.map((leftover, i) => {
          // liveFreshnessOf, not freshnessOf: a frozen container's stored day
          // is suspended, so tinting from it would glow red about food in no
          // danger at all. Null is the "nothing counting down" grey.
          const freshness = liveFreshnessOf(leftover);
          const tint = freshness ? freshnessColor(freshness, colors) : colors.textTertiary;
          return (
            // A wrapper rather than a ref on the Touchable itself, so what gets
            // measured is a plain host view — the same reason FabDropZone wraps
            // its rows instead of reaching into them.
            <View
              key={leftover.id}
              ref={registerRow(leftover.id)}
              collapsable={false}
              style={draggingId === leftover.id && styles.rowLifted}
            >
              <TouchableOpacity
                style={[styles.row, i > 0 && styles.rowDivided]}
                onPress={() => { haptics.tap(); onPress(leftover); }}
                onLongPress={drag ? () => startDrag(leftover) : undefined}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${leftover.title}, ${describeLeftover(leftover)}`}
                accessibilityHint={drag ? 'Hold and drag onto a day to plan it there. Left to right across the day picks breakfast, lunch, dinner or a snack.' : undefined}
              >
                {/* The dot carries the whole freshness signal, so the caption is
                    never the only thing saying it — a colour nobody can see is
                    still legible as "there is a state here" next to text that
                    spells it out. */}
                <View style={[styles.dot, { backgroundColor: tint }]} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{leftover.title}</Text>
                  <Text style={[styles.rowCaption, { color: tint }]}>
                    {describeLeftover(leftover)}
                  </Text>
                </View>
                {/* A bare glyph, not a tinted tile — the row's other controls
                    (the dot, the chevron) are bare too, and a filled tile here
                    would read as a second kind of row rather than an action on
                    this one. Same call the recipe rows make. */}
                <TouchableOpacity
                  onPress={() => { haptics.tap(); onPlan(leftover); }}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Plan ${leftover.title} onto a day`}
                >
                  <Ionicons name="calendar-outline" size={iconSize.md} color={colors.accent} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          );
        })}
        {hidden > 0 && (
          <TouchableOpacity
            style={[styles.row, styles.moreRow]}
            onPress={() => { haptics.tap(); animateLayout(); setExpanded(true); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Show ${hidden} more in the fridge`}
          >
            <Text style={styles.moreText}>{`+${hidden} more`}</Text>
          </TouchableOpacity>
        )}
      </View>
      )}
    </View>
  );
}

/**
 * The container itself, on its way to a day — what the screen floats under the
 * finger for the length of a drag.
 *
 * It lives here rather than in the screen so it can't drift from the row it is
 * a copy of: same dot, same title, same shape, off the same stylesheet. What
 * differs is the caption, which is the whole reason a floating card beats a
 * bare label — it stops describing the fridge and starts describing the drop,
 * naming the day *and the meal* a release right now would plan onto. That's the
 * same job the add button's `dragLabel` does, and it reads the same channel to
 * do it.
 *
 * **The caption is what makes the meal columns usable, not the columns
 * themselves.** This card is full width and sits under the finger, so on a day
 * with nothing planned it covers most of the band it is being held over — the
 * lit column shows around its edges on a taller day and not much on a short
 * one. The line of text on the card is the thing that is always legible, which
 * is why it names the slot rather than leaving it to the highlight underneath.
 *
 * **A day past the keep-until is named, not blocked** (see
 * isPlannedPastKeepUntil): the caption says so in the freshness colours the
 * card already uses, and the drop lands anyway.
 */
export function LeftoverDragCard({
  leftover,
  channel,
}: {
  leftover: Leftover;
  channel: FabIntentChannel;
}) {
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Selected as plain strings and booleans, never as the intent: most pointer
  // samples don't change either, and one that doesn't must cost nothing. See
  // useFabIntentSelector. Split in two rather than one combined string so the
  // slot name can carry its own emphasis — it's the half that changes as a
  // finger crosses meal columns, the day label doesn't.
  const captionPrefix = useFabIntentSelector(channel, intent => {
    if (intent?.kind !== 'day') return describeLeftover(leftover);
    // The use-by warning replaces the meal rather than sitting after it: the
    // row is one line at font.xs, and "Thursday · Dinner · past its use-by"
    // truncates to the half that matters least. Which day it's late for is the
    // point; which meal of that day is not.
    return isPlannedPastKeepUntil(leftover, intent.dayKey)
      ? `${intent.dayLabel} · past its use-by`
      : `${intent.dayLabel} · `;
  });
  const captionSlot = useFabIntentSelector(channel, intent => {
    if (intent?.kind !== 'day' || isPlannedPastKeepUntil(leftover, intent.dayKey)) return null;
    return slotLabel(intent.slot);
  });
  const late = useFabIntentSelector(
    channel,
    intent => intent?.kind === 'day' && isPlannedPastKeepUntil(leftover, intent.dayKey),
  );

  const liveFreshness = liveFreshnessOf(leftover);
  const tint = late
    ? colors.red
    : liveFreshness ? freshnessColor(liveFreshness, colors) : colors.textTertiary;

  return (
    <View style={[styles.dragCard, shadows.fab]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{leftover.title}</Text>
          <Text style={[styles.rowCaption, { color: tint }]} numberOfLines={1}>
            {captionPrefix}
            {captionSlot != null && <Text style={styles.rowCaptionSlot}>{captionSlot}</Text>}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The colour a freshness state reads in.
 *
 * Three levels for four states, on purpose. `fresh` is the ordinary tertiary
 * text colour rather than green — most of the fridge is fine most of the time,
 * and a card of green dots makes the one orange one harder to find, not easier.
 * `soon` and `due` share orange because the caption beside them already says
 * which ("Use by tomorrow" / "Use by today"); the alternative was yellow for
 * `soon`, which is `colors.warning` and is a banner fill, not a text colour —
 * it fails on the light theme's white card the moment it's used for the caption
 * rather than only the dot.
 */
export function freshnessColor(freshness: LeftoverFreshness, colors: Colors): string {
  switch (freshness) {
    case 'over': return colors.red;
    case 'due':
    case 'soon': return colors.orange;
    default: return colors.textTertiary;
  }
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Both of the card's own actions, in its header rather than on a row of
  // their own below it: History used to be a lone pill under the card, which
  // on an empty fridge left a caption, a button and a pill on three separate
  // lines to say the fridge was empty.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerStatus: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    // radius.md, matching a day's card rather than the larger corner this had:
    // two card treatments stacked on one screen read as two levels of
    // importance, and the fridge is not the more important of the two (#1375).
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  // The row a drag picked up. It stays in place and stays legible — the
  // container isn't going anywhere, the copy on the finger is.
  rowLifted: {
    opacity: 0.4,
  },
  // The floating copy. Deliberately NOT `card` plus a shadow: that style clips
  // to its bounds (one rounded corner treatment for three stacked rows), and an
  // iOS shadow is drawn outside the layer it belongs to, so the same view can't
  // both clip and cast one. One row needs no clipping anyway.
  //
  // It sits on the card surface — the row's own — and is lifted off the page by
  // the shadow rather than by a different fill. `bgTertiary` was the
  // obvious-looking alternative and is wrong in light mode: white cards are
  // already the top surface there, so a tertiary fill reads as *recessed* under
  // the day it's being dragged over. A shadow works in both.
  dragCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    shadowColor: '#000',
  },
  moreRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingVertical: 8,
  },
  moreText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  rowCaption: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  rowCaptionSlot: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
});
