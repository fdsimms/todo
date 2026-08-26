import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors, useTheme } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  checkboxRadius,
  animation,
  type Colors,
} from '../theme';
import { SafeBlurView } from './SafeBlurView';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { convertQuantity } from '../utils/unitConvert';
import type { ClassifiedIngredient } from '../utils/mealPlanGroceries';
import { RECIPE_VOTE_LABELS, type RecipeVote } from '../types';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { EditorRow } from './EditorRow';
import { InlineAction } from './InlineAction';
import { SheetScrim } from './SheetScrim';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

// Typed against `RecipeVote | null` so the track can render with *nothing*
// selected, which is exactly the state the section exists to fill in — a
// never-rated recipe. Null is not an option anyone can pick: there is no
// segment for it, and `onChange` can only ever hand back one of these two.
const VOTE_OPTIONS: SegmentOption<RecipeVote | null>[] = [
  { value: 'up', label: RECIPE_VOTE_LABELS.up },
  { value: 'down', label: RECIPE_VOTE_LABELS.down },
];

interface Props {
  visible: boolean;
  /** The meal as it was cooked — the sheet's subject, under the title. */
  title: string;
  /**
   * The rating section, or null to leave it out. `value` is the recipe's
   * current vote, which is null while it has never been rated — the state the
   * section exists to fill in.
   */
  vote?: { value: RecipeVote | null; onChange: (vote: RecipeVote) => void };
  /** The fridge section, or null when this meal has nothing to put in one. */
  onLogLeftovers?: () => void;
  /**
   * What the app is currently claiming you had before this cooking
   * (`consumedRows`), recomputed live by the host. Empty leaves the ticking
   * half out; with `restockCount` also 0 the whole section goes.
   */
  rows: readonly ClassifiedIngredient[];
  /**
   * How many of the dish's ingredients aren't on the shopping list
   * (`restockRows`), or 0 when the restock offer is switched off. Counted into
   * the button's label alongside whatever is ticked, since ticking is what puts
   * a row into that set.
   */
  restockCount: number;
  /**
   * Opens the shop. Called *after* the ticked rows are marked out, so the sheet
   * it opens counts them — see `handleAddToList`.
   */
  onAddToList?: () => void;
  /** Skip, Done, and the swipe-down are all the same thing: the ask is over. */
  onClose: () => void;
  /**
   * The sheets this one hands off to (the fridge log, the shop), rendered
   * inside this Modal rather than beside it — the same nesting
   * `RecipeToListSheet` and `GroceryItemSheet` use, since a Modal presents from
   * the view controller its React parent belongs to and a sibling would ask the
   * screen's controller to present a second sheet while this one is up.
   */
  children?: React.ReactNode;
}

/**
 * The post-cook sheet: how it was, what it left, and what it used up, asked
 * once, on the tap that said you cooked it.
 *
 * **It replaced three separate asks off one tap** (#2115). Marking a meal
 * cooked used to raise a native "How was it?" alert, then `CookedUseUpOffer`'s
 * banner over the list, and then — only once that one had been answered or
 * dismissed — the restock banner ranked behind it. Each was individually
 * defensible and the sequence was not: a tick about eating dinner produced a
 * dialog, a banner, and a second banner that looked exactly like the first,
 * spread over as long as it took to notice them. The banners' own note in
 * `OfferBanner` argued that a modal after a cooking reads as presumptuous, and
 * that was true of what it replaced — `RecipeToListSheet` opening outright,
 * pre-ticked, on a tap that had nothing to do with shopping. It isn't an
 * argument against *asking*; it's an argument against answering on someone's
 * behalf, which is why nothing here is ticked or filled in when it opens and
 * Skip is a single tap in the corner.
 *
 * Three rules hold it to that:
 *
 * - **Every section is gated on its own subject**, so this is only ever as long
 *   as the cooking earned. A repeat cook of a rated dish with a full pantry is
 *   one row: the fridge question. `CookRecap` declines to open it at all when
 *   every section is empty.
 * - **Nothing is ticked when it opens**, the rule `CookedUseUpSheet` set and the
 *   reason its rows are the ones the app already claims you have: a pre-ticked
 *   sheet makes silence mean "out of everything".
 * - **The rating and the fridge write immediately; the pantry ticks wait for
 *   Done.** A segment and a logged container are each a complete answer on
 *   their own, while the ticks are a batch — which is why the confirm button
 *   counts them ("Mark 2") rather than saying Done, the same wording the sheet
 *   this section came from used.
 *
 * **A centered card, not a full-screen page sheet** — the same
 * treatment `QuickAddModal` uses: a blurred/dimmed backdrop, a card capped to
 * `sheetMaxHeight` that scrolls internally past that, spring in and fade out.
 * A full-screen sheet reads as a destination; this is a quick aside off one
 * tap, over in a couple of taps more, and the card says so by leaving the
 * screen behind it visible. Unlike `QuickAddModal` there's no keyboard to
 * make room for, and the header stays a fixed sibling above the `ScrollView`
 * rather than scrolling with the rest — Done has to stay reachable without
 * scrolling back up on a cooking with a long pantry list. A tap on the
 * backdrop is Skip's cancel, not Done's confirm, same as the swipe-down the
 * old page sheet answered with `onClose` rather than `handleDone`.
 */
export function CookRecapSheet({
  visible,
  title,
  vote,
  onLogLeftovers,
  rows,
  restockCount,
  onAddToList,
  onClose,
  children,
}: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetMaxHeight = windowHeight - insets.top - insets.bottom - spacing.xl * 2;
  const styles = useMemo(() => makeStyles(colors, sheetMaxHeight), [colors, sheetMaxHeight]);

  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Springs in once, on mount. Unlike QuickAddModal there's no persistent
  // instance toggling `visible` on and off — CookRecap mounts this sheet
  // fresh (keyed to the cooking) whenever there's something to ask, so mount
  // is the only "opening" there is.
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fades/scales out, then hands off to the caller — which is what actually
  // unmounts this component (`CookRecap` clears its recap on `onClose`). Runs
  // for Skip, the backdrop tap, and the hardware back button alike; `handleDone`
  // is the one path that commits ticks first.
  const dismiss = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const items = useGroceryStore(useShallow(s => s.items));
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Cleared on every opening. A sheet that hands back last cook's answers
  // pre-ticked would be asserting them about this one.
  useEffect(() => {
    if (visible) setTicked(new Set());
  }, [visible]);

  const itemsByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.nameKey, item.id);
    return map;
  }, [items]);

  const toggle = (row: ClassifiedIngredient) => {
    haptics.tap();
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(row.nameKey)) next.delete(row.nameKey);
      else next.add(row.nameKey);
      return next;
    });
  };

  /**
   * Writes the ticks and forgets them.
   *
   * Resolved back to catalog ids here rather than carried on the row: a
   * `ClassifiedIngredient` is keyed by name, and the pantry assertion lives on
   * the id. A key with no live row is dropped rather than minting one — this
   * only ever corrects rows that already exist.
   *
   * `'usedUp'` rather than a question, because the section's whole subject is
   * what the cooking consumed: the answer is already in the tap. It's also the
   * one place several rows are reported at once, and asking per row would be
   * the "recall five kitchens" `bulkSetCooked` declines to do.
   */
  const commitTicks = () => {
    const ids = Array.from(ticked)
      .map(key => itemsByKey.get(key))
      .filter((id): id is string => !!id);
    const marked = markOutOfMany(ids, 'usedUp');
    if (marked > 0) haptics.success();
    setTicked(new Set());
    return marked;
  };

  const handleDone = () => {
    commitTicks();
    dismiss();
  };

  /**
   * Marks first, then shops — the order is the feature. Ticking a line is what
   * moves it out of `consumedRows` and into `restockRows`, so the shop opened
   * before the marks landed would be missing the very things you just said you
   * were out of. It also empties this section as it goes, since the host
   * recomputes the rows off the live catalog.
   */
  const handleAddToList = () => {
    commitTicks();
    onAddToList?.();
  };

  const buyCount = restockCount + ticked.size;
  const showPantry = rows.length > 0;
  const showBuy = buyCount > 0 && !!onAddToList;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} />

      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.dialogCard,
            shadows.sheet,
            { opacity: sheetOpacity, transform: [{ scale: scaleAnim }, { translateY: translateYAnim }] },
          ]}
        >
          <View style={styles.header}>
            <SheetHeaderButton label="Skip" role="cancel" onPress={dismiss} minWidth={80} />
            <Text style={styles.headerTitle} numberOfLines={1}>Cooked it</Text>
            <SheetHeaderButton
              label={ticked.size > 0 ? `Mark ${ticked.size}` : 'Done'}
              onPress={handleDone}
              minWidth={80}
            />
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.subject} numberOfLines={2}>{title}</Text>

            {vote && (
              <>
                <Text style={styles.groupLabel}>How was it?</Text>
                <SegmentedControl
                  options={VOTE_OPTIONS}
                  value={vote.value}
                  onChange={next => next && vote.onChange(next)}
                  label="How was it?"
                />
              </>
            )}

            {onLogLeftovers && (
              <>
                <Text style={styles.groupLabel}>Leftovers</Text>
                <View style={styles.card}>
                  <EditorRow
                    icon="cube-outline"
                    label="Anything left over?"
                    value="Log"
                    onPress={onLogLeftovers}
                  />
                </View>
              </>
            )}

            {(showPantry || showBuy) && (
              <>
                <Text style={styles.groupLabel}>{showPantry ? 'Out of anything?' : 'Restock?'}</Text>
                {/* Says the mechanism, since this is the only place it's
                    explained: what ticking does, and what happens next
                    because of it. */}
                {!hideHelpText && (
                  <Text style={styles.hint}>
                    {showPantry
                      ? 'Things you probably had before cooking this. Check whatever it used up and they’ll stop counting as on hand.'
                      : 'Ingredients from this meal that aren’t on your shopping list.'}
                  </Text>
                )}

                {showPantry && (
                  <View style={styles.card}>
                    {rows.map((row, i) => {
                      const on = ticked.has(row.nameKey);
                      const shownQuantity = convertQuantity(row.quantity, unitSystem).text;
                      return (
                        <React.Fragment key={row.nameKey}>
                          {i > 0 && <View style={styles.sep} />}
                          <TouchableOpacity
                            style={styles.row}
                            activeOpacity={interaction.activeOpacity}
                            onPress={() => toggle(row)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                            accessibilityLabel={[row.name, shownQuantity, row.reason].filter(Boolean).join(', ')}
                            accessibilityHint="Marks it as used up"
                          >
                            <View style={[styles.checkbox, on && styles.checkboxOn]}>
                              {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
                            </View>
                            <View style={styles.rowBody}>
                              <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                              {/* probablyHaveReason's own words — the same line
                                  the pantry and the item sheet show, so why the
                                  app thought you had it is answered where you're
                                  being asked. */}
                              {!!row.reason && (
                                <Text style={styles.reason} numberOfLines={1}>{row.reason}</Text>
                              )}
                            </View>
                            {!!shownQuantity && (
                              <View style={styles.qtyPill}>
                                <Text style={styles.qtyText} numberOfLines={1}>{shownQuantity}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        </React.Fragment>
                      );
                    })}
                  </View>
                )}

                {/* Neutral, and not because it's the second half of a pair:
                    buying is the quieter want here. The section's own question is
                    what you're out of, and this is the follow-on offered under it
                    rather than the thing being asked. */}
                {showBuy && (
                  <InlineAction
                    label={`Add ${buyCount} to list`}
                    icon="basket-outline"
                    variant="neutral"
                    onPress={handleAddToList}
                    accessibilityLabel={`Add ${buyCount} ingredient${buyCount === 1 ? '' : 's'} to the shopping list`}
                    style={styles.buy}
                  />
                )}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>

      {children}
    </Modal>
  );
}

const makeStyles = (colors: Colors, sheetMaxHeight: number) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  // No `overflow: 'hidden'` here — on iOS that clips the shadow along with
  // the content, and (see QuickAddModal/QuickAddNameSheet) it's not needed:
  // the header has no background of its own to square off against the
  // rounded corners, and the scrollable rows below are inset from the edges
  // by their own margin.
  dialogCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    maxHeight: sheetMaxHeight,
  },
  scrollBody: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  body: { paddingBottom: spacing.xl },
  subject: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  // Uppercase textSecondary with the app's own letter spacing — the same
  // treatment every section header and editor group label gets.
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  hint: {
    fontSize: font.sm,
    color: colors.textTertiary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    lineHeight: font.sm * 1.35,
  },
  // One surface up from `dialogCard` — the page sheet this replaced nested
  // bgSecondary inside a bg screen, and the floating card takes bg's old
  // slot, so what sits on it steps up the same one level too.
  card: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + CHECKBOX_SIZE + spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderWidth: border.md,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  reason: { fontSize: font.xs, color: colors.textTertiary },
  qtyPill: {
    backgroundColor: colors.bgQuaternary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 90,
  },
  qtyText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  // Both margins, not just the one above: nothing below this has a top margin
  // of its own, and the section that follows would otherwise sit against it.
  buy: { alignSelf: 'flex-start', marginHorizontal: spacing.md, marginTop: spacing.sm },
});
