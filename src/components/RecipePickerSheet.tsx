import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  Keyboard,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useRecipeStore } from '../store/useRecipeStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { rankRecipes, describeRecipe, cleanRecipeName } from '../utils/recipeUtils';
import { slotLabel } from '../utils/mealPlan';
import { describeLeftover, freshnessOf, liveLeftovers, mealTitleForLeftover } from '../utils/leftovers';
// The colour ladder lives with the card that established it rather than in
// utils/leftovers, which is deliberately store- and theme-free so jest's node
// env can reach it without loading a renderer.
import { freshnessColor } from './LeftoversCard';
import { MEAL_SLOTS, RECIPE_NAME_MAX_LENGTH, type Leftover, type MealSlot } from '../types';

export interface MealPick {
  slot: MealSlot;
  recipeId: string | null;
  /** Set when the plan is a tracked leftover. Null for a recipe or free text. */
  leftoverId: string | null;
  title: string;
}

interface Props {
  visible: boolean;
  /** "Tue 5 Aug" — names the day being planned, so the sheet doesn't need the calendar. */
  dayLabel: string;
  defaultSlot: MealSlot;
  onPick: (pick: MealPick) => void;
  onClose: () => void;
}

/** Enough to scan without virtualizing; the search field reaches the rest. */
const MAX_ROWS = 30;

/** Kept clear above the lifted sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

/** Quick-pick shortcuts for the free-text plan — the non-recipe nights that come up
 * often enough to skip typing. Tapping one commits it exactly like tapping a recipe
 * row does; picking any of these is already a complete answer, not a draft to edit.
 *
 * "Leftovers" survives the arrival of the leftovers tracker rather than being
 * replaced by it: plenty of leftovers were never logged, and a night planned as
 * the bare word is still a complete answer. The tracked ones are offered *above*
 * it as their own rows — the generic chip is the floor, not the only option. */
const PRESET_PLANS = ['Leftovers', 'Takeout', 'Eating out'];

/**
 * Puts something on a night: a recipe from the box, a tracked leftover out of
 * the fridge, or whatever the user types.
 *
 * **The free-text half is not a fallback.** "Leftovers" and "out" are real
 * answers, so the typed name is offered as its own row at the top of the list
 * rather than hidden behind a mode switch — an entry made that way holds its
 * place on the week and counts toward the header's total exactly like a
 * recipe-backed one does (see MealPlanEntry.recipeId).
 *
 * **Picking a leftover does not use it up.** A big pot feeds two dinners, so
 * planning against one leaves it in the fridge — "was that the last of it?"
 * is asked later, when the meal is actually marked cooked (see
 * MealPlanScreen's markCooked), not here before it's been eaten. See
 * Leftover.finishedAt.
 */
export function RecipePickerSheet({ visible, dayLabel, defaultSlot, onPick, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const [query, setQuery] = useState('');
  const [slot, setSlot] = useState<MealSlot>(defaultSlot);

  const typed = cleanRecipeName(query);

  // Matched on a plain substring rather than through rankRecipes: the fridge
  // holds a handful of rows the user put there this week, so there is nothing
  // for a ranker to disambiguate, and a fuzzy match would put a leftover under
  // a query that was clearly reaching for a recipe.
  const fridge = useMemo(() => {
    const live = liveLeftovers(leftovers);
    const q = query.trim().toLowerCase();
    return q ? live.filter(l => l.title.toLowerCase().includes(q)) : live;
  }, [leftovers, query]);
  const matches = useMemo(() => {
    const ranked = query.trim()
      ? rankRecipes(query, recipes)
      : [...recipes].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder);
    return ranked.slice(0, MAX_ROWS);
  }, [query, recipes]);

  // The typed line only earns a row when it isn't just the name of a recipe
  // already offered above it — two rows planning the same dinner, one of them
  // silently losing the link to its ingredients, is the confusing version.
  const showFreeText =
    !!typed && !matches.some(r => r.name.toLowerCase() === typed.toLowerCase());

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
      Animated.spring(keyboardOffset, {
        toValue: -height, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      Animated.spring(keyboardOffset, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSlot(defaultSlot);
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    keyboardOffset.setValue(0);
    setKeyboardHeight(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [visible, defaultSlot]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, damping: 28, stiffness: 320, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 300, useNativeDriver: true }).start();
      },
    })
  ).current;

  // `slot` is read at tap time rather than captured, so the chips can be changed
  // after a search has been typed without the pick going to the old one.
  //
  // A pick closes the sheet — tapping a recipe/preset/free-text row with no
  // other feedback than a haptic otherwise reads as if nothing happened.
  const pick = (recipeId: string | null, title: string) => {
    haptics.success();
    onPick({ slot, recipeId, leftoverId: null, title });
    dismiss();
  };

  /**
   * Plans a tracked leftover onto the night, and *only* that — the container
   * stays in the fridge with its clock running. "Was that the last of it?"
   * is asked later, when the meal is actually marked cooked — see
   * MealPlanScreen's markCooked — not here, before it's even been eaten.
   *
   * The title captures the age at plan time (mealTitleForLeftover) rather than
   * resolving it live like a recipe name does, because "2 days old" is a fact
   * about the night this was planned for, not about the dish.
   *
   * `recipeId` stays null even when the leftover knows which recipe made it —
   * the two backings are mutually exclusive on purpose. Carrying both would
   * hand titleForEntry a recipe to resolve, and the live recipe name winning is
   * exactly what would strip the age back off the row.
   */
  const pickLeftover = (leftover: Leftover) => {
    haptics.success();
    onPick({
      slot,
      recipeId: null,
      leftoverId: leftover.id,
      title: mealTitleForLeftover(leftover),
    });
    dismiss();
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { maxHeight: windowHeight - keyboardHeight - TOP_INSET },
          { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Plan {dayLabel}</Text>
            <SheetHeaderButton
              label="Done"
              onPress={() => dismiss()}
              role="confirm"
              accessibilityLabel={`Done planning ${dayLabel}`}
              style={styles.doneButton}
            />
          </View>
          <Text style={styles.sheetHint}>
            Pick a recipe, or type whatever it is — “leftovers” is a plan too.
          </Text>

          <View style={styles.chips}>
            {MEAL_SLOTS.map(s => {
              const on = s === slot;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => { haptics.tap(); setSlot(s); }}
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

          <View style={styles.presetRow}>
            {PRESET_PLANS.map(preset => (
              <TouchableOpacity
                key={preset}
                style={styles.presetChip}
                onPress={() => pick(null, preset)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Plan ${preset}`}
              >
                <Text style={styles.presetChipText}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search recipes, or type a meal"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              maxLength={RECIPE_NAME_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => { if (typed) pick(null, typed); }}
              accessibilityLabel="Search recipes, or type a meal"
            />
          </View>

          <ScrollView style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
            {showFreeText && (
              <TouchableOpacity
                style={styles.row}
                onPress={() => pick(null, typed)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Plan ${typed}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>{typed}</Text>
                  <Text style={styles.rowHint}>Just this, not a recipe</Text>
                </View>
                <Ionicons name="add" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}

            {/* Above the recipes on purpose: what's already cooked and going off
                is the answer the user should reach for first, and it's the only
                one with a deadline attached. */}
            {fridge.length > 0 && (
              <>
                {showFreeText && <View style={styles.inlineSep} />}
                <Text style={styles.listSection}>In the fridge</Text>
                {fridge.map((leftover, idx) => {
                  const tint = freshnessColor(freshnessOf(leftover), colors);
                  return (
                    <React.Fragment key={leftover.id}>
                      {idx > 0 && <View style={styles.inlineSep} />}
                      <TouchableOpacity
                        style={styles.row}
                        onPress={() => pickLeftover(leftover)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Plan ${leftover.title}. ${describeLeftover(leftover)}`}
                      >
                        <View style={[styles.rowIcon, { backgroundColor: colors.bgTertiary }]}>
                          <Ionicons name="snow-outline" size={16} color={tint} />
                        </View>
                        <View style={styles.rowInfo}>
                          <Text style={styles.rowName} numberOfLines={1}>{leftover.title}</Text>
                          <Text style={[styles.rowHint, { color: tint }]} numberOfLines={1}>
                            {describeLeftover(leftover)}
                          </Text>
                        </View>
                        <Ionicons name="add" size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
                {matches.length > 0 && <Text style={styles.listSection}>Recipes</Text>}
              </>
            )}

            {matches.length === 0 && !showFreeText && fridge.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="restaurant-outline" size={28} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>
                  {query.trim() ? 'No matches' : 'No recipes yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {query.trim()
                    ? 'Nothing in your recipe box is called that.'
                    : 'Type what you’re having — you don’t need a recipe to plan a night.'}
                </Text>
              </View>
            ) : (
              matches.map((recipe, idx) => (
                <React.Fragment key={recipe.id}>
                  {/* The "Recipes" caption already separates this run from the
                      fridge above it, so the first row only takes a rule when
                      it's butting straight up against the free-text one. */}
                  {(idx > 0 || (showFreeText && fridge.length === 0)) && <View style={styles.inlineSep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => pick(recipe.id, recipe.name)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Plan ${recipe.name}. ${describeRecipe(recipe)}`}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                      <Ionicons name="restaurant-outline" size={16} color={colors.accent} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{recipe.name}</Text>
                      <Text style={styles.rowHint} numberOfLines={1}>{describeRecipe(recipe)}</Text>
                    </View>
                    {recipe.favorite && <Ionicons name="star" size={13} color={colors.orange} />}
                  </TouchableOpacity>
                </React.Fragment>
              ))
            )}
          </ScrollView>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
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
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  doneButton: {
    fontSize: font.md,
  },
  sheetHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
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
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  presetChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 8,
  },
  list: {
    maxHeight: 320,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  listSection: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  emptySub: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
