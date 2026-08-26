import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
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
import { useGroceryStore, type PlannedRow } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { convertQuantity } from '../utils/unitConvert';
import type { ClassifiedIngredient } from '../utils/mealPlanGroceries';
import { RECIPE_VOTE_LABELS, type RecipeVote } from '../types';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { EditorRow } from './EditorRow';
import { InlineAction } from './InlineAction';
import { ScrollEdgeFade } from './ScrollEdgeFade';
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
   * half out; with `restockRows` also empty the whole section goes.
   */
  rows: readonly ClassifiedIngredient[];
  /**
   * The dish's ingredients that aren't on the shopping list (`restockRows`),
   * empty when the restock offer is switched off. Shown by name — unlike
   * `rows` above, these are added straight to the list from this sheet
   * (`handleAddToList`), so what "Add N to list" is about to do has to be
   * legible before the tap, not discovered after it.
   */
  restockRows: readonly ClassifiedIngredient[];
  /** Skip, Done, and the swipe-down are all the same thing: the ask is over. */
  onClose: () => void;
  /**
   * The sheet this one hands off to (the fridge log), rendered inside this
   * Modal rather than beside it — the same nesting `GroceryItemSheet` uses,
   * since a Modal presents from the view controller its React parent belongs
   * to and a sibling would ask the screen's controller to present a second
   * sheet while this one is up.
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
 * - **Nothing in the pantry checklist is ticked when it opens**, the rule
 *   `CookedUseUpSheet` set and the reason its rows are the ones the app
 *   already claims you have: a pre-ticked sheet makes silence mean "out of
 *   everything". The restock checklist is the deliberate exception — its rows
 *   start ticked, the same default `RecipeToListSheet` already uses for this
 *   exact set (`restockRows`), because that set is already a narrow,
 *   already-trusted recommendation rather than a guess being asked about.
 * - **The rating, the fridge, and "Add to list" write immediately; the pantry
 *   ticks wait for Done.** A segment, a logged container, and a restock add
 *   are each a complete answer on their own, while the pantry ticks are a
 *   batch — which is why the confirm button counts them ("Mark 2") rather
 *   than saying Done, the same wording the sheet this section came from used.
 *   "Add N to list" means what it says: it writes to the shopping list on the
 *   tap, not on a later Done.
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
  restockRows,
  onClose,
  children,
}: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetMaxHeight = windowHeight - insets.top - insets.bottom - spacing.xl * 2;
  const styles = useMemo(() => makeStyles(colors, sheetMaxHeight), [colors, sheetMaxHeight]);
  const fade = useScrollEdgeFade();

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
  const addFromPlan = useGroceryStore(s => s.addFromPlan);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Explicit "no" to the Leftovers ask, distinct from Skip: Skip abandons the
  // whole sheet unanswered, this records that this one question was answered
  // "no". Tapping the collapsed answer reopens the choice, same as
  // EditorRow's value being the way back into a field you've already set.
  const [leftoversDeclined, setLeftoversDeclined] = useState(false);
  // Which restock rows are queued to add — unlike `ticked` above, this starts
  // *full*, not empty (see the class doc's note on that).
  const [restockTicked, setRestockTicked] = useState<Set<string>>(new Set());

  // Cleared/reseeded on every opening. A sheet that hands back last cook's
  // answers would be asserting them about this one.
  useEffect(() => {
    if (visible) {
      setTicked(new Set());
      setLeftoversDeclined(false);
      setRestockTicked(new Set(restockRows.map(r => r.nameKey)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const toggleRestock = (row: ClassifiedIngredient) => {
    haptics.tap();
    setRestockTicked(prev => {
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
   * Writes the checked restock rows straight to the shopping list — no
   * intermediate sheet. `restockRows` is the same narrow set
   * `RecipeToListSheet` calls "already trusted" (see its own `restock`
   * selection mode), and this sheet now shows those rows by name, so there's
   * nothing left for a second review screen to add.
   */
  const handleAddToList = () => {
    const toAdd = restockRows.filter(r => restockTicked.has(r.nameKey));
    if (toAdd.length === 0) return;
    const plannedRows: PlannedRow[] = toAdd.map(r => ({
      name: r.name,
      quantity: r.quantity || null,
      aisle: r.aisle,
      sourceRecipeId: r.sourceRecipeId,
      sourceRecipeTitle: r.sourceRecipeTitle,
      choiceGroup: r.choiceGroup,
    }));
    addFromPlan(plannedRows);
    haptics.success();
  };

  const restockAddCount = restockRows.filter(r => restockTicked.has(r.nameKey)).length;
  const showPantry = rows.length > 0;
  const showBuy = restockRows.length > 0;

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

          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            {...fade.scrollProps}
          >
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
                  {leftoversDeclined ? (
                    <EditorRow
                      icon="cube-outline"
                      label="Anything left over?"
                      value="No"
                      onPress={() => setLeftoversDeclined(false)}
                    />
                  ) : (
                    <View style={styles.choiceRow}>
                      <Ionicons name="cube-outline" size={18} color={colors.textSecondary} />
                      <Text style={styles.choiceLabel}>Anything left over?</Text>
                      <View style={styles.choiceButtons}>
                        <InlineAction
                          label="No"
                          variant="neutral"
                          onPress={() => { haptics.tap(); setLeftoversDeclined(true); }}
                          accessibilityLabel="No leftovers"
                        />
                        <InlineAction label="Log" onPress={onLogLeftovers} accessibilityLabel="Log leftovers" />
                      </View>
                    </View>
                  )}
                </View>
              </>
            )}

            {showPantry && (
              <>
                <Text style={styles.groupLabel}>Out of anything?</Text>
                {/* Says the mechanism, since this is the only place it's
                    explained: what ticking does, and what happens next
                    because of it. */}
                {!hideHelpText && (
                  <Text style={styles.hint}>
                    Things you probably had before cooking this. Check whatever it used up and they’ll stop
                    counting as on hand.
                  </Text>
                )}

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
              </>
            )}

            {showBuy && (
              <>
                {/* Its own label and hint, deliberately not folded under "Out of
                    anything?" above — these rows come from the recipe's own
                    ingredient list against what's on the shopping list, not from
                    anything checked in the pantry section, and sitting right
                    below that checklist made the two easy to read as one list. */}
                <Text style={styles.groupLabel}>{showPantry ? 'Restock' : 'Restock?'}</Text>
                {!hideHelpText && (
                  <Text style={styles.hint}>
                    Ingredients from this recipe that aren’t on your shopping list. Checked ones get added when
                    you tap Add.
                  </Text>
                )}

                <View style={styles.card}>
                  {restockRows.map((row, i) => {
                    const on = restockTicked.has(row.nameKey);
                    const shownQuantity = convertQuantity(row.quantity, unitSystem).text;
                    return (
                      <React.Fragment key={row.nameKey}>
                        {i > 0 && <View style={styles.sep} />}
                        <TouchableOpacity
                          style={styles.row}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => toggleRestock(row)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={[row.name, shownQuantity].filter(Boolean).join(', ')}
                          accessibilityHint="Adds it to your shopping list"
                        >
                          <View style={[styles.checkbox, on && styles.checkboxOn]}>
                            {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
                          </View>
                          <View style={styles.rowBody}>
                            <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
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

                {restockAddCount > 0 && (
                  <InlineAction
                    label={`Add ${restockAddCount} to list`}
                    icon="basket-outline"
                    onPress={handleAddToList}
                    accessibilityLabel={`Add ${restockAddCount} ingredient${restockAddCount === 1 ? '' : 's'} to your shopping list`}
                    style={styles.restockAdd}
                  />
                )}
              </>
            )}
          </ScrollView>
          <ScrollEdgeFade
            edge="bottom"
            opacity={fade.bottomOpacity}
            color={colors.bgSecondary}
            style={styles.scrollFade}
          />
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
  // The card rounds its corners but can't clip them — `overflow: 'hidden'`
  // there would take the sheet shadow with it — so the band carries the
  // bottom radius itself rather than squaring off over them.
  scrollFade: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
  },
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
  // Mirrors EditorRow's own row layout so the unanswered and answered states
  // of the Leftovers question line up exactly.
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  choiceLabel: { flexGrow: 1, flexShrink: 0, color: colors.text, fontSize: font.md },
  choiceButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Both margins, not just the one above: nothing below this has a top margin
  // of its own, and the section that follows would otherwise sit against it.
  restockAdd: { alignSelf: 'flex-start', marginHorizontal: spacing.md, marginTop: spacing.sm },
});
