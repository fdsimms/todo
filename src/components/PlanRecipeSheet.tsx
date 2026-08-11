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
import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import { MEAL_SLOTS } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { dayKeyOf } from '../utils/dateUtils';
import { slotLabel, upcomingDays } from '../utils/mealPlan';

/** Kept clear above the sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

/** How far ahead a recipe can be planned from here — see upcomingDays. */
const DAYS_OFFERED = 7;

interface Props {
  visible: boolean;
  /** Null closes the sheet; the recipe being planned otherwise. */
  recipe: Recipe | null;
  /**
   * Plans it, returning the row that was written — or null if the store
   * refused it. Called while the sheet is still up, so the caller must not
   * raise an alert from here; see `onPlanned` for where that belongs.
   */
  onPlan: (recipe: Recipe, dateKey: string, slot: MealSlot) => MealPlanEntry | null;
  /**
   * Fires once, after the dismissal, carrying the last row planned. Where the
   * prep-task offer goes: an alert raised while this Modal is still up is the
   * "already presenting" case RecipePickerSheet's `pick` documents.
   */
  onPlanned?: (entry: MealPlanEntry) => void;
  onClose: () => void;
}

/**
 * "Put this on a night" — the recipe half of planning a meal (#1360's audit,
 * MP-11). Until this existed, planning ran one way only: from the meal plan,
 * into the recipe box, via search. Reading a recipe and wanting it on Thursday
 * had no path at all.
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
export function PlanRecipeSheet({ visible, recipe, onPlan, onPlanned, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const translateY = useRef(new Animated.Value(600)).current;
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
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible, recipe?.id]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
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
    if (!recipe) return;
    const entry = onPlan(recipe, dayKey, slot);
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
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />

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

        <ScrollView
          style={styles.card}
          contentContainerStyle={styles.cardContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <Text style={styles.heading} numberOfLines={2}>{recipe?.name ?? ''}</Text>
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
                  accessibilityLabel={format(day, 'EEEE d MMMM')}
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
              accessibilityLabel={`Plan ${recipe?.name ?? 'this recipe'} for ${describeDay(dayKey)}, ${slotLabel(slot)}`}
            >
              <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.onAccent} />
              <Text style={styles.primaryText}>{`Plan for ${describeDay(dayKey)}`}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
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
    color: colors.textTertiary,
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
    color: colors.textTertiary,
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
    color: colors.textSecondary,
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
