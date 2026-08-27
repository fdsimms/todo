import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { isTomorrow } from 'date-fns/isTomorrow';
import type { MealPlanEntry, MealSlot } from '../types';
import { MEAL_SLOTS } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';
import { dayKeyOf } from '../utils/dateUtils';
import { slotLabel, upcomingDays } from '../utils/mealPlan';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

/** Kept clear above the sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

/** How far ahead a meal can be planned from here — see upcomingDays. */
const DAYS_OFFERED = 7;

interface Props {
  visible: boolean;
  /**
   * What's being planned, as the name to put at the top — a recipe's, or a
   * container's out of the fridge. Null closes the sheet.
   *
   * A name and a callback rather than the `Recipe` this took at first: the
   * sheet's whole job is picking a night, and it never needed to know what
   * kind of thing it was picking one for. Passing the subject through the
   * caller's own `onPlan` is what lets the fridge card reuse it (#1370)
   * without the sheet growing a union type it would have to switch on.
   */
  title: string | null;
  /**
   * Plans it onto the chosen night, returning the row that was written — or
   * null if the store refused it. Called while the sheet is still up, so the
   * caller must not raise an alert from here; see `onPlanned`.
   */
  onPlan: (dateKey: string, slot: MealSlot) => MealPlanEntry | null;
  /**
   * Fires once, after the dismissal, carrying the last row planned. Where the
   * prep-task offer goes: an alert raised while this Modal is still up is the
   * "already presenting" case RecipePickerSheet's `pick` documents.
   */
  onPlanned?: (entry: MealPlanEntry) => void;
  onClose: () => void;
}

/**
 * "Put this on a night" — for a recipe you're looking at (#1360's audit,
 * MP-11) or a container in the fridge (#1370). Until this existed, planning ran
 * one way only: from the meal plan, into the recipe box, via search. Reading a
 * recipe and wanting it on Thursday had no path at all, and neither did seeing
 * the chilli that needs eating.
 *
 * It knows nothing about *what* it is planning — only its name and a callback
 * — which is what lets one sheet serve both.
 *
 * **Day and slot chips, not a calendar.** The same call MealEntrySheet's "Move
 * to" row makes, for the same reason: chips need no measurement, show the whole
 * choice at once, and two taps is the whole interaction. The days are a rolling
 * week from today rather than the calendar one (see upcomingDays) — a recipe
 * has no week on screen to inherit, and a calendar week opened on a Friday is
 * mostly days you cannot cook on.
 *
 * **It confirms in place rather than closing on the tap.** Every other planning
 * surface in this app can rely on the plan itself being visible behind the
 * sheet — a row appears on the week, and that *is* the feedback. From a recipe
 * screen there is nothing behind it to change, so a sheet that just vanished
 * would leave the user with a haptic and a hope. The button becomes a
 * confirmation naming the night, and touching any chip again re-arms it, which
 * is also how the same dish gets planned onto two nights without reopening
 * anything.
 */
export function PlanMealSheet({ visible, title, onPlan, onPlanned, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fade = useScrollEdgeFade();
  const { height: windowHeight } = useWindowDimensions();

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Fixed for the life of one opening: a rolling window recomputed mid-render
  // would slide under the user at midnight, and the chips are already labelled
  // with their dates.
  const [days, setDays] = useState<Date[]>(() => upcomingDays(new Date(), DAYS_OFFERED));
  const [dayKey, setDayKey] = useState<string>(() => dayKeyOf(new Date()));
  const [slot, setSlot] = useState<MealSlot>('dinner');
  /** The row just written, or null while the button is still armed. */
  const [planned, setPlanned] = useState<MealPlanEntry | null>(null);

  useEffect(() => {
    if (!visible) return;
    const fresh = upcomingDays(new Date(), DAYS_OFFERED);
    setDays(fresh);
    setDayKey(dayKeyOf(fresh[0]));
    // Dinner is what planning a recipe nearly always means, and it's the slot
    // the meal plan's own picker defaults to. The chips are right there.
    setSlot('dinner');
    setPlanned(null);
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible, title]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
      after?.();
    });
  };

  /**
   * Closing carries the prep-task offer out with it, for whatever was planned
   * last. Every route out lands here — the button, the backdrop, the swipe —
   * so an offer can't be lost by dismissing the "wrong" way.
   */
  const close = () => {
    const done = planned;
    dismiss(() => { if (done) onPlanned?.(done); });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) closeRef.current();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
      },
    })
  ).current;
  // The responder is built once; `close` closes over state that changes, so it
  // is reached through a ref rather than captured at first render.
  const closeRef = useRef(close);
  closeRef.current = close;

  const commit = () => {
    if (!title) return;
    const entry = onPlan(dayKey, slot);
    // A store that refused the write (a name that cleans to nothing) leaves the
    // button armed rather than claiming a night it didn't take.
    if (!entry) return;
    haptics.success();
    setPlanned(entry);
  };

  /** "today", "tomorrow", "Thursday" — how the confirmation names the night. */
  const describeDay = (key: string): string => {
    const day = days.find(d => dayKeyOf(d) === key);
    if (!day) return 'that day';
    if (isToday(day)) return 'today';
    if (isTomorrow(day)) return 'tomorrow';
    return format(day, 'EEEE');
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={close} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { maxHeight: windowHeight - TOP_INSET },
          { transform: [{ translateY }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.cardWrap}>
        <ScrollView
          style={styles.card}
          contentContainerStyle={styles.cardContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
          {...fade.scrollProps}
        >
          <View style={styles.headerRow}>
            <Text style={styles.heading} numberOfLines={2}>{title ?? ''}</Text>
            <SheetHeaderButton label="Done" onPress={close} accessibilityLabel="Done planning" />
          </View>

          <Text style={styles.label}>When</Text>
          <View style={styles.chips}>
            {days.map(day => {
              const key = dayKeyOf(day);
              const on = key === dayKey;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.dayChip, on && styles.chipOn]}
                  onPress={() => { haptics.tap(); setDayKey(key); setPlanned(null); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={format(day, 'EEEE, MMMM d')}
                >
                  <Text style={[styles.dayChipTop, on && styles.chipTextOn]}>
                    {format(day, 'EEEEE')}
                  </Text>
                  <Text style={[styles.dayChipNum, on && styles.chipTextOn]}>
                    {format(day, 'd')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Meal</Text>
          <View style={styles.chips}>
            {MEAL_SLOTS.map(s => {
              const on = s === slot;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => { haptics.tap(); setSlot(s); setPlanned(null); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={slotLabel(s)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{slotLabel(s)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {planned ? (
            // Not a button any more: the same footprint, saying what happened.
            // Touching any chip above re-arms it, which is how the same dish
            // gets onto a second night without reopening the sheet.
            <View
              style={[styles.primary, styles.primaryDone]}
              accessibilityRole="text"
              accessibilityLabel={`Planned for ${describeDay(planned.date)}, ${slotLabel(planned.slot)}. Pick another day to plan it again.`}
            >
              <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.green} />
              <Text style={[styles.primaryText, { color: colors.green }]}>
                {`Planned for ${describeDay(planned.date)} · ${slotLabel(planned.slot)}`}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.primary}
              onPress={commit}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Plan ${title ?? 'this'} for ${describeDay(dayKey)}, ${slotLabel(slot)}`}
            >
              <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.onAccent} />
              <Text style={styles.primaryText}>{`Plan for ${describeDay(dayKey)}`}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        <ScrollEdgeFade edge="bottom" opacity={fade.bottomOpacity} color={colors.bgSecondary} />
        </View>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  // Wraps the scrolling card so the fade can be anchored to its bottom
  // edge. It carries the card's outer layout — the shrink that lets the
  // card give way to the sheet's maxHeight, the gap below it, and the
  // rounded clip the band has to sit inside — because an absolute child
  // is positioned from its parent's border box: left on the card, the
  // band would overhang the corners and the margin below it.
  cardWrap: {
    flexShrink: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    flexShrink: 1,
  },
  cardContent: {
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flexShrink: 1,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  dayChip: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  dayChipTop: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  dayChipNum: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipOn: {
    backgroundColor: colors.accent,
  },
  chipText: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  chipTextOn: {
    color: colors.onAccent,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  // Same footprint as the button it replaces, so the sheet doesn't resize
  // under the finger that just tapped it.
  primaryDone: {
    backgroundColor: colors.bgTertiary,
    borderWidth: border.sm,
    borderColor: colors.green,
  },
  primaryText: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
