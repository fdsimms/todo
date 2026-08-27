import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { slotLabel } from '../utils/mealPlan';
import { formatScale, isUnscaled } from '../utils/recipeScale';
import { SwipeableRow } from './SwipeableRow';
import { useFabIntentSelector, type FabIntentChannel } from './FabDropZones';

interface Props {
  entry: MealPlanEntry;
  /** From titleForEntry — the live recipe's name while it resolves, else the captured one. */
  title: string;
  /** Whether `entry.recipeId` still points at a recipe that exists. */
  hasRecipe: boolean;
  /**
   * Which side this meal is having — describeChoices' answer, or empty for the
   * many meals that pose no either/or.
   */
  choices?: string;
  /**
   * Who this meal is for — describeGuests' answer, empty for the many meals
   * that name nobody. Passed as a described string rather than as ids, the same
   * way `choices` is: the row stays dumb and every caller shows the same words.
   */
  guests?: string;
  onPress: () => void;
  /**
   * Ticks the entry off, or back on — the same shortcut a task row's checkbox
   * gives over its editor. Omitted only while `selectionMode` is on (see
   * below); a cooked entry keeps it, because un-ticking is now a thing a row
   * can do (#1361).
   */
  onToggleCooked?: () => void;
  /**
   * Bulk-selection mode (#1110). While on, the leading icon becomes a
   * checkbox — same swap RecipesScreen's row makes — `onPress` is expected to
   * toggle selection rather than open MealEntrySheet, and the cooked toggle
   * and chevron both disappear: a finger reaching for the toggle mid-selection
   * is reaching to select the row, not to cook one meal out from under a bulk
   * action.
   */
  selectionMode?: boolean;
  selected?: boolean;
  /**
   * Swipe left to enter bulk selection with this row pre-selected — the same
   * entry point tasks use (#1378). No `whenAction`: there's no single-tap
   * "when" to offer a meal, since moving one to another day is already a
   * multi-step flow behind the entry sheet's day picker.
   */
  onSwipeSelect?: (id: string) => void;
  /**
   * Held long enough to lift this meal off the week, for dropping onto another
   * day (see MealPlanScreen's drag handlers, and useDragToDay for the gesture).
   * Omit on any surface with no week under the row — Today's tray — and the row
   * stays tap-and-swipe only, exactly as it was.
   *
   * The entry sheet's day chips stay either way: a drag is the shortcut, not
   * the route, and it's unreachable with VoiceOver or a shaky hand. Same rule
   * the fridge row's calendar button keeps.
   */
  onDragStart?: () => void;
  /**
   * This row is the one currently lifted. It switches the swipe off for the
   * duration — the two gestures both start with a finger on the row, and a
   * horizontal drag once lifted is aiming at a meal column, not at the select
   * panel. The dim belongs to whoever wraps the row (the screen measures that
   * wrapper anyway), the same split LeftoversCard makes.
   */
  dragging?: boolean;
  /**
   * The background of the container this row sits in — the meal plan's card
   * (`bgSecondary`), Today's tray (`bgSunken`).
   *
   * It has to be painted on the row itself, and that's what makes the swipe
   * animate. `Swipeable` renders its action panel as an absolutely-filled
   * sibling *behind* the row and parks it at `translateX: -10000` while closed,
   * so the panel snaps to its full 80pt the moment a drag starts and is
   * revealed only by the opaque row sliding off it. A transparent row reveals
   * nothing: the whole blue panel appears at once on the first pixel of the
   * gesture, with the row's own toggle and chevron drawn on top of it, which
   * reads as the swipe having no animation at all. Every other swipeable row
   * that feels right paints its own background for this reason (`TaskItem.row`,
   * `TaskGroupHeader.row` — see the note on its `band`).
   *
   * A prop rather than a token because the two callers sit on different
   * surfaces, and the row has to match whichever it's on.
   */
  surface?: string;
}

/**
 * One planned meal.
 *
 * A free-text meal, a recipe-backed one and one eating a tracked leftover all
 * get the same row, the same weight and the same actions — only the leading
 * icon differs, and it's telling the user something true (this one came from
 * your recipe box and tapping through will open it; this one is already cooked
 * and in the fridge). Thursday is allowed to just say "leftovers"; every
 * planner that treats that as an unfinished row is abandoned on a Wednesday.
 *
 * The slot caption renders on every row, including a second dish sharing the
 * slot above it. It used to be suppressed on a run — "two things on one
 * dinner is normal here, captioning both DINNER reads as noise" — but the
 * adjacency alone (two stacked rows, no divider change) didn't read as
 * "these are grouped" to an actual user; the caption was the only thing
 * saying so, and losing it read as wrong rather than as decluttering (#1221).
 * Grouping has to be communicated by something present on the row, not by an
 * absence a reader is expected to infer.
 */
export function MealSlotRow({
  entry, title, hasRecipe, choices, guests, onPress, onToggleCooked, selectionMode, selected, onSwipeSelect,
  onDragStart, dragging, surface,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cooked = !!entry.cookedAt;

  /**
   * The tick pops when it lands.
   *
   * This is the one moment in the whole feature where the user has actually
   * done the thing it exists for — planned a meal and then cooked it — and it
   * used to be a silent glyph swap while planning and removing both animated
   * (#1379). Only on the way *in*: un-ticking is a correction, and a
   * correction that celebrates is a correction that reads as a mistake being
   * congratulated.
   */
  const pop = useRef(new Animated.Value(1)).current;
  const wasCooked = useRef(cooked);
  useEffect(() => {
    if (cooked && !wasCooked.current) {
      pop.setValue(0.7);
      Animated.spring(pop, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
    }
    wasCooked.current = cooked;
  }, [cooked, pop]);
  const fromFridge = !!entry.leftoverId;
  // "2×" on a meal being cooked at some multiple of its recipe, so the week
  // shows it without having to open each night's sheet.
  const scaleLabel = isUnscaled(entry.recipeScale) ? null : formatScale(entry.recipeScale);

  const rowBody = (
    <TouchableOpacity
      style={[
        styles.row,
        { backgroundColor: surface ?? colors.bgSecondary },
        // Wins outright, as it always has: the tint is translucent, so it
        // composites over the container to exactly the colour it did before
        // the row painted a background of its own. Safe against the swipe
        // panel too — the gesture is off in selection mode.
        selectionMode && selected && styles.rowSelected,
      ]}
      onPress={onPress}
      // Selection mode takes the row's gestures over wholesale, drag included:
      // a finger held on a row mid-selection is reaching to select it.
      onLongPress={onDragStart && !selectionMode ? onDragStart : undefined}
      delayLongPress={interaction.delayLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityState={selectionMode ? { checked: !!selected } : undefined}
      accessibilityLabel={
        [slotLabel(entry.slot), title, scaleLabel, guests ? `with ${guests}` : null, choices, cooked ? 'cooked' : null]
          .filter(Boolean).join(', ')
      }
      accessibilityHint={
        selectionMode ? 'Double tap to select this meal.'
          : onDragStart
            ? 'Double tap to move or remove this meal. Or hold and drag it onto another day. Left to right across the day picks breakfast, lunch, dinner or a snack.'
            : 'Double tap to move or remove this meal.'
      }
    >
      {selectionMode ? (
        // Takes the icon tile's place rather than sitting beside it, same
        // swap RecipesScreen's row makes — every row shifts by the same
        // amount, so the title column stays put.
        <View style={styles.select}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? colors.accent : colors.textTertiary}
          />
        </View>
      ) : (
        <View
          style={[
            styles.icon,
            { backgroundColor: hasRecipe ? colors.accentSubtle : colors.bgTertiary },
          ]}
        >
          <Ionicons
            name={fromFridge ? 'snow-outline' : hasRecipe ? 'restaurant-outline' : 'create-outline'}
            size={16}
            color={hasRecipe ? colors.accent : colors.textSecondary}
          />
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {/* Appended to the caption rather than given a pill of its own: the row
            is already dense, and how big a batch it is ranks with the slot it
            sits in, not with the dish's name. */}
        {/* Bounded, which it wasn't before guests joined it: slot + batch +
            guests + a choice is four qualifiers, and unbounded they ran the row
            to three caption lines under a two-line title. Two is the ceiling —
            the sheet carries the full list, and a row is a summary. */}
        <Text style={styles.slot} numberOfLines={2}>
          {[slotLabel(entry.slot), scaleLabel].filter(Boolean).join(' · ')}
          {/* Ahead of the choices, because who is coming changes what the row
              means more than which side it comes with does. Same nested
              treatment: a qualifier on the meal, not a line of its own. */}
          {!!guests && <Text style={styles.choices}> · with {guests}</Text>}
          {!!choices && <Text style={styles.choices}> · {choices}</Text>}
        </Text>
      </View>
      {/*
        The cooked control, moved out of the icon tile's corner and into the
        trailing cluster where the row's other controls live (#1362). It was a
        14pt circle filled with `colors.bg` and bordered `colors.separator` —
        in dark theme a near-black ring on near-black, carrying the row's main
        action at a size the row's *decoration* would be embarrassed by. The
        app's equivalent gesture, TaskItem's checkbox, is a full-size
        high-contrast control, and so is this now. Same trailing-button shape
        the recipe and fridge rows use.
      */}
      {!selectionMode && onToggleCooked && (
        <TouchableOpacity
          onPress={() => { haptics.tap(); onToggleCooked(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: cooked }}
          accessibilityLabel={cooked ? `Mark ${title} not cooked` : `Mark ${title} cooked`}
        >
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Ionicons
              name={cooked ? 'checkmark-circle' : 'ellipse-outline'}
              size={iconSize.lg}
              color={cooked ? colors.green : colors.textTertiary}
            />
          </Animated.View>
        </TouchableOpacity>
      )}
      {!selectionMode && (
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );

  // Swipe stays off entirely in selection mode, same as the header controls
  // it sits beside — a finger reaching for the row is reaching to toggle it,
  // not to open a select panel that only re-enters the mode it's already in.
  if (selectionMode) return rowBody;

  return (
    <SwipeableRow
      enabled={!dragging}
      selectAction={onSwipeSelect ? {
        onSelect: () => onSwipeSelect(entry.id),
        accessibilityLabel: `Select ${title}`,
      } : undefined}
    >
      {rowBody}
    </SwipeableRow>
  );
}

/**
 * The meal itself, on its way to another day — what MealPlanScreen floats under
 * the finger for the length of a drag.
 *
 * It lives here rather than in the screen so it can't drift from the row it is
 * a copy of: same icon tile, same title, same shape, off the same stylesheet.
 * What differs is the caption, which is the whole reason a floating card beats a
 * bare label — it stops describing where the meal *is* and starts describing
 * where a release right now would put it, naming the day and the meal. Exactly
 * the job LeftoverDragCard does for a container out of the fridge, reading the
 * same channel to do it.
 *
 * **A release over the slot it already sits in says so**, rather than naming
 * that slot as though something were about to happen: `moveEntry` no-ops on it,
 * and a card promising "Thursday · Dinner" for a drop that writes nothing is the
 * one state where the caption would be lying about the outcome. It's also the
 * state a drag passes through on its way out of its own day, so it has to read
 * as "nothing yet" rather than as a target.
 */
export function MealDragCard({
  entry,
  title,
  hasRecipe,
  channel,
}: {
  entry: MealPlanEntry;
  title: string;
  hasRecipe: boolean;
  channel: FabIntentChannel;
}) {
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Selected as plain strings, never as the intent: most pointer samples don't
  // change either, and one that doesn't must cost nothing. See
  // useFabIntentSelector. Split in two so the slot name can carry its own
  // emphasis — it's the half that changes as a finger crosses meal columns,
  // the day label doesn't.
  const captionPrefix = useFabIntentSelector(channel, intent => {
    if (intent?.kind !== 'day') return slotLabel(entry.slot);
    if (intent.dayKey === entry.date && intent.slot === entry.slot) return 'Already here';
    return `${intent.dayLabel} · `;
  });
  const captionSlot = useFabIntentSelector(channel, intent => {
    if (intent?.kind !== 'day') return null;
    if (intent.dayKey === entry.date && intent.slot === entry.slot) return null;
    return slotLabel(intent.slot);
  });

  return (
    <View style={[styles.dragCard, shadows.fab]}>
      <View style={[styles.row, { backgroundColor: 'transparent' }]}>
        <View
          style={[
            styles.icon,
            { backgroundColor: hasRecipe ? colors.accentSubtle : colors.bgTertiary },
          ]}
        >
          <Ionicons
            name={entry.leftoverId ? 'snow-outline' : hasRecipe ? 'restaurant-outline' : 'create-outline'}
            size={16}
            color={hasRecipe ? colors.accent : colors.textSecondary}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.slot} numberOfLines={1}>
            {captionPrefix}
            {captionSlot != null && <Text style={styles.slotTarget}>{captionSlot}</Text>}
          </Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowSelected: {
    backgroundColor: colors.accent + '1A',
  },
  // The floating copy. Deliberately not the day's `card` style plus a shadow,
  // for the reason LeftoverDragCard's own note gives: that style clips to its
  // bounds and an iOS shadow is drawn outside the layer it belongs to, so one
  // view can't both clip and cast one. It sits on the same surface the row does
  // and is lifted off the page by the shadow rather than by a different fill.
  dragCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
  },
  // The half of the caption naming the meal a release would land in — the part
  // that changes as the finger crosses columns, so it carries the emphasis.
  slotTarget: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same footprint as the icon tile it replaces, so entering selection mode
  // doesn't shift the row's text.
  select: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  title: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  slot: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // Nested in the slot caption rather than a third line: the row is already
  // two lines and this is a qualifier on the meal, not a fact of its own.
  choices: {
    color: colors.textTertiary,
    fontWeight: fontWeight.regular,
    letterSpacing: 0,
    textTransform: 'none',
  },
});
