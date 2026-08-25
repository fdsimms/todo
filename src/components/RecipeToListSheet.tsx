import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe } from '../types';
import { useTheme } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  checkboxRadius,
  type Colors,
} from '../theme';
import { useGroceryStore, type PlannedRow } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  classifyPlanned,
  plannedIngredientsForRecipe,
  restockRows,
  type ClassifiedIngredient,
  type PlanCategory,
} from '../utils/mealPlanGroceries';
import { describeStandingSwap, standingSwapMap } from '../utils/standingSwaps';
import { describeSubstitutes, substitutesFor, type Substitute } from '../utils/itemSubs';
import { alternativeCaptions, applyChoice, choiceGroupKey, recipeChoiceGroups } from '../utils/recipeComponents';
import { normalizeScale } from '../utils/recipeScale';
import { convertQuantity } from '../utils/unitConvert';
import { RecipeScaleChips } from './RecipeScaleChips';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { SubstituteSheet } from './SubstituteSheet';
import { haptics } from '../utils/haptics';

// How long the in-sheet "marked in pantry" undo stays up. Same value UndoBar
// uses for the same reason: long enough to read the label and reach for the
// button, short enough not to overstay a moment already moved past.
const PANTRY_UNDO_MS = 6000;

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  recipe: Recipe | null;
  /**
   * The library, so a composed recipe's components contribute their
   * ingredients too. Optional: a caller with only the one row in hand (the
   * meal plan's "cooked, re-shop it" follow-up passes one) still gets exactly
   * the behaviour it had before components existed.
   */
  recipesById?: ReadonlyMap<string, Recipe>;
  /**
   * Which alternatives to start on — a meal's own picks, when the shop is a
   * follow-up to cooking one. Omitted (the recipe screen's own add) starts every
   * choice group on its default. Only ever a starting point: the chips below the
   * header are the sheet's, and nothing here is written back.
   */
  initialChoices?: readonly string[];
  /**
   * How much of the recipe to shop for, to start on — the factor the recipe
   * screen was being read at, or a planned meal's own `recipeScale` when the
   * shop is a follow-up to cooking one. Like `initialChoices`, only ever a
   * starting point: the chips below the header are the sheet's own and nothing
   * here is written back.
   */
  initialScale?: number;
  /**
   * Which rows start ticked. `'all'` — every `needToBuy` line — is right when
   * the user asked for this sheet by name ("Add ingredients to list"): they
   * said they want the shop, and making them tick it out again is busywork.
   *
   * `'restock'` narrows that to the lines `restockRows` will defend — known
   * items that are off the list — and is what the meal plan's post-cook offer
   * passes. There the ticks have to match the claim that got the sheet opened:
   * the banner counted those rows and nothing else, so pre-ticking a line the
   * app has never seen before would be the sheet quietly asking for more than
   * the banner did. Those lines are still listed and still tickable by hand.
   */
  initialSelection?: 'all' | 'restock';
  onClose: () => void;
}

const SECTIONS: { category: PlanCategory; label: string; interactive: boolean; collapsible: boolean }[] = [
  { category: 'needToBuy', label: 'Need to buy', interactive: true, collapsible: false },
  { category: 'alreadyOnList', label: 'Already on your list', interactive: true, collapsible: false },
  { category: 'inCart', label: 'In your cart', interactive: false, collapsible: false },
  { category: 'staple', label: 'Always have', interactive: true, collapsible: true },
  { category: 'probablyHave', label: 'Probably have', interactive: true, collapsible: true },
];

// Both collapsible sections start open: they hold rows the user can still tick
// on to the list, and a closed section shows only a count, so the lines it
// holds were easy to miss on a sheet whose whole job is reviewing what gets
// added. They stay collapsible, so a long staple list is still one tap away
// from out of the way.
const defaultExpandedSections = (): Set<PlanCategory> => new Set<PlanCategory>(['staple', 'probablyHave']);

/**
 * Review-then-commit for one recipe, the single-recipe sibling of
 * AddMealsToListSheet — same classifyPlanned pantry-awareness (needToBuy /
 * alreadyOnList / inCart / probablyHave) instead of RecipeDetailScreen's
 * old blind addFromPlan over every ingredient.
 *
 * Two row actions, shared with AddMealsToListSheet and documented here because
 * this is where they were written:
 *
 * - **"In pantry"** on every needToBuy row. It says the app's own word for
 *   where the line ends up rather than the longer "Already have it" it
 *   shipped as: the button is on every row now, and the label was costing a
 *   long ingredient name the width it needed to be read at all. Unticking a row only skips
 *   it for this add — the pantry guess forgets nothing was said. Stamping the
 *   on-hand window (the same write GroceryItemSheet's "Got it" makes) is what
 *   actually keeps that ingredient from being offered again next time, which
 *   is the whole point of an "already have it" option on an import. It goes
 *   through `addToPantry`, so an ingredient with no catalog row yet mints one
 *   rather than being the one line you can't say it about — a recipe naming
 *   something the app has never seen is exactly where the app's guess is
 *   worst, so that was the wrong line to leave out.
 * - **The substitutes marker** on a row whose item has stand-ins recorded,
 *   which opens SubstituteSheet on it. `reason` says "you have margarine" only
 *   for a substitute the pantry vouches for; the marker is the wider "there's
 *   something written down here", and it puts the authoring funnel on the
 *   screen where someone is deciding whether to buy the original.
 */
export function RecipeToListSheet({
  visible,
  recipe,
  recipesById,
  initialChoices,
  initialScale,
  initialSelection = 'all',
  onClose,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const unitSystem = useSettingsStore(s => s.unitSystem);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const addFromPlan = useGroceryStore(s => s.addFromPlan);
  const addToPantry = useGroceryStore(s => s.addToPantry);

  const itemsByKey = useMemo(() => new Map(items.map(i => [i.nameKey, i])), [items]);

  // Which alternative this *shop* is for, held only as long as the sheet is
  // open. Deliberately not written anywhere: an add-to-list off the recipe
  // screen isn't attached to a meal, so there is nothing for a pick to be a
  // fact about — MealPlanEntry.recipeChoices is where a lasting one lives.
  // It starts empty, which is every group on its default.
  const [choices, setChoices] = useState<string[]>([]);

  // Groups this shop is deliberately not answering — "I'll pick whichever
  // pepper they have". Held exactly like `choices` above and written nowhere,
  // but it survives further than a pick does: the options go on the list as one
  // either/or (GroceryItem.choiceGroup), so ticking one at the shelf is what
  // finally answers the question, and the pantry is stamped with what was
  // actually bought.
  //
  // Ingredient groups only — see ChoiceResolution.undecided.
  const [undecided, setUndecided] = useState<string[]>([]);
  const choiceKey = `${choices.join('|')}#${undecided.join('|')}`;

  // Same contract as `choices` above, and for the same reason: an ad-hoc shop
  // isn't attached to a meal, so there's nothing for "I'm making a double batch"
  // to be a lasting fact about.
  const [scale, setScale] = useState(1);

  const choiceGroups = useMemo(
    () => (recipe && recipesById ? recipeChoiceGroups(recipe, recipesById, { chosen: choices }) : []),
    [recipe, recipesById, choiceKey]
  );

  // "Always use oat milk for milk" — applied on the way out of the flatten, so
  // what this sheet offers is what the kitchen actually buys. Every swapped row
  // says so (see standingSwaps.ts); nothing is written back to the recipe.
  const swaps = useMemo(() => standingSwapMap(itemSubs, items), [itemSubs, items]);

  const classified = useMemo(() => {
    if (!recipe) return [];
    return classifyPlanned(
      plannedIngredientsForRecipe(recipe, recipesById, { chosen: choices, undecided }, scale, swaps),
      items,
      new Date(),
      itemSubs
    );
  }, [recipe, recipesById, items, itemSubs, swaps, choiceKey, scale]);

  // "or jalapeño" on each option of a group left open, so a row in Need to buy
  // reads as one of a pair rather than as a second thing to buy. Keyed on
  // nameKey, which is what identifies a classified row.
  const alternativeNotes = useMemo(
    () => alternativeCaptions(classified.map(r => ({ id: r.nameKey, choiceGroup: r.choiceGroup, name: r.name }))),
    [classified],
  );

  const byCategory = useMemo(() => {
    const out: Record<PlanCategory, ClassifiedIngredient[]> = {
      needToBuy: [], alreadyOnList: [], inCart: [], probablyHave: [], staple: [],
    };
    for (const row of classified) out[row.category].push(row);
    return out;
  }, [classified]);

  // Which lines you've written a stand-in for, keyed the way the rows are.
  // `reason` below already says "you have margarine" — but only for a
  // substitute the pantry currently vouches for, which is the narrow case.
  // This is the wider one: the link exists, so the line is worth a second look
  // before you shop even when the app has no opinion on whether you've got the
  // alternative. Substitutes are hand-authored (see utils/itemSubs.ts), so a
  // row carrying this marker is one the user themselves said something about.
  const substitutesByKey = useMemo(() => {
    const out = new Map<string, Substitute[]>();
    for (const row of classified) {
      const item = itemsByKey.get(row.nameKey);
      if (!item) continue;
      const subs = substitutesFor(item.id, itemSubs, items);
      if (subs.length > 0) out.set(row.nameKey, subs);
    }
    return out;
  }, [classified, itemsByKey, itemSubs, items]);

  // Which row's substitutes are being read, and where a new one gets written —
  // opening this from a line you're about to buy is exactly the moment
  // SubstituteSheet's own note says fills the table.
  const [subsItemId, setSubsItemId] = useState<string | null>(null);

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<PlanCategory>>(defaultExpandedSections);
  // What `ticked` gets reset to on open and on every choice/scale-driven
  // recompute below — so the dirty check in handleCancel can tell a real tap
  // apart from the set simply being recomputed out from under it.
  const tickedBaselineRef = useRef<string>('');

  useEffect(() => {
    if (!visible) return;
    setChoices(initialChoices ? [...initialChoices] : []);
    setUndecided([]);
    setScale(normalizeScale(initialScale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Re-ticks on a swapped alternative as well as on open: changing the side
  // changes which rows exist, and a row that has just appeared has never been
  // unticked, so it belongs in the default selection.
  //
  // Not keyed on `scale`, deliberately: scaling changes the quantities on the
  // rows, never which rows there are, so a line the user just unticked must
  // stay unticked when they double the batch.
  useEffect(() => {
    if (!visible) return;
    const rows = initialSelection === 'restock'
      ? restockRows(byCategory.needToBuy)
      : byCategory.needToBuy;
    const defaultTicked = new Set(rows.map(r => r.nameKey));
    setTicked(defaultTicked);
    tickedBaselineRef.current = JSON.stringify([...defaultTicked].sort());
    setExpandedSections(defaultExpandedSections());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, choiceKey, initialSelection]);

  const toggleSection = (category: PlanCategory) => {
    haptics.tap();
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const toggle = (row: ClassifiedIngredient) => {
    haptics.tap();
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(row.nameKey)) next.delete(row.nameKey);
      else next.add(row.nameKey);
      return next;
    });
  };

  // Transient "marked in pantry" undo, shown in the sheet itself rather than
  // through UndoBar/shake-to-undo — neither can be reached while this sheet
  // is up (a `Modal` presents above everything else UndoBar could render
  // into, and a shake armed now would only surface its confirm at some later,
  // disconnected moment). One at a time, replacing on every tap, same as
  // UndoBar mirrors for its own three queues.
  const [pantryUndo, setPantryUndo] = useState<{ label: string; undo: () => void } | null>(null);
  const pantryUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) return;
    setPantryUndo(null);
    if (pantryUndoTimerRef.current) clearTimeout(pantryUndoTimerRef.current);
  }, [visible]);

  useEffect(() => () => {
    if (pantryUndoTimerRef.current) clearTimeout(pantryUndoTimerRef.current);
  }, []);

  // `addToPantry`, not a bare `setOnHandUntil`: it mints the catalog row when
  // the ingredient hasn't got one yet, stamping the same window "Got it"
  // writes, which is what lets this be offered on every line rather than only
  // the ones the catalog already knew about. It's also what the Pantry
  // screen's own "add something you already have" field calls, so a recipe
  // line and a typed name make the same statement.
  const markAlreadyHave = (row: ClassifiedIngredient) => {
    const wasTicked = ticked.has(row.nameKey);
    let revert: (() => void) | undefined;
    const item = addToPantry(row.name, {
      registerUndo: false,
      onUndo: fn => { revert = fn; },
    });
    if (!item) { haptics.error(); return; }
    haptics.success();
    setTicked(prev => {
      const next = new Set(prev);
      next.delete(row.nameKey);
      return next;
    });
    // Out of the baseline too, so Cancel doesn't offer to discard it. The
    // assertion is already written and closing the sheet can't take it back,
    // and this row is leaving Need to buy on the next recompute regardless —
    // one line's own key rather than a wholesale reset, so a tick the user
    // *did* change by hand still counts as work worth asking about.
    const baseline = new Set<string>(JSON.parse(tickedBaselineRef.current) as string[]);
    baseline.delete(row.nameKey);
    tickedBaselineRef.current = JSON.stringify([...baseline].sort());

    // addToPantry always calls onUndo before returning a non-null item, so
    // revert is set here — the optional chaining below is belt-and-braces.
    if (pantryUndoTimerRef.current) clearTimeout(pantryUndoTimerRef.current);
    setPantryUndo({
      label: `"${row.name}" marked in pantry`,
      undo: () => {
        revert?.();
        // Only if the tap itself is what unticked it — a row the user had
        // already unticked by hand stays unticked once it's back.
        if (wasTicked) setTicked(prev => new Set(prev).add(row.nameKey));
      },
    });
    pantryUndoTimerRef.current = setTimeout(() => setPantryUndo(null), PANTRY_UNDO_MS);
  };

  const handlePantryUndo = () => {
    if (!pantryUndo) return;
    if (pantryUndoTimerRef.current) clearTimeout(pantryUndoTimerRef.current);
    haptics.success();
    pantryUndo.undo();
    setPantryUndo(null);
  };

  // Same shape as GroceryItemSheet/TaskEditor's own dirty check. A scale or a
  // choice made is dirty on its own — there's nowhere for either to be
  // written back once this closes, so losing them is losing real decisions —
  // and `ticked` is compared against the baseline for the *current* choice
  // state, so a set that only changed because a choice swap just recomputed
  // it doesn't falsely read as user work about to be lost.
  const handleCancel = () => {
    const dirty = choices.length > 0
      || undecided.length > 0
      || scale !== 1
      || JSON.stringify([...ticked].sort()) !== tickedBaselineRef.current;
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const handleAdd = () => {
    if (!recipe) { onClose(); return; }
    const rows: PlannedRow[] = classified
      .filter(r => r.category !== 'inCart' && ticked.has(r.nameKey))
      .map(r => ({
        name: r.name,
        quantity: r.quantity || null,
        aisle: r.aisle,
        // The component the line is written on gets the credit — that's where
        // the user will go to change it. classifyPlanned leaves this null once
        // a row merged across more than one of them, and the recipe they
        // actually tapped is the honest answer for that case.
        sourceRecipeId: r.sourceRecipeId ?? recipe.id,
        sourceRecipeTitle: r.sourceRecipeTitle ?? recipe.name,
        choiceGroup: r.choiceGroup,
      }));

    if (rows.length === 0) { onClose(); return; }

    const result = addFromPlan(rows);
    haptics.success();

    const parts = [`Added ${result.added.length}`];
    if (result.alreadyOnList.length > 0) parts.push(`${result.alreadyOnList.length} already on your list`);
    if (result.skippedInCart.length > 0) parts.push(`${result.skippedInCart.length} already in your cart`);
    Alert.alert(
      result.added.length > 0 ? 'On the list' : 'Nothing to add',
      parts.join(' · ')
    );
    onClose();
  };

  const addCount = ticked.size;
  const nothingToShow = classified.length === 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={72} />
          <Text style={styles.headerTitle} numberOfLines={1}>{recipe?.name ?? 'Add to list'}</Text>
          <SheetHeaderButton
            label={addCount > 0 ? `Add ${addCount}` : 'Add'}
            onPress={handleAdd}
            disabled={addCount === 0}
            minWidth={72}
          />
        </View>

        {/* Above the choice chips: how much you're making applies to the whole
            shop, while a choice applies to one group within it. */}
        {!nothingToShow && (
          <View style={styles.scaleRow}>
            <Text style={styles.sectionLabel}>Batch</Text>
            <RecipeScaleChips
              value={scale}
              onChange={setScale}
              baseServings={recipe?.servings}
              baseServingsMax={recipe?.servingsMax}
            />
          </View>
        )}

        {choiceGroups.length > 0 && (
          <View style={styles.choices}>
            {choiceGroups.map(group => {
              const key = choiceGroupKey(group.recipe.id, group.label);
              const open = undecided.includes(key);
              return (
                <View key={key} style={styles.choiceGroup}>
                  <Text style={styles.sectionLabel}>{group.label}</Text>
                  <View style={styles.choiceChips}>
                    {group.options.map(option => {
                      const on = !open && option.id === group.active.id;
                      const name = option.name || 'Deleted recipe';
                      return (
                        <TouchableOpacity
                          key={option.id}
                          style={[styles.choiceChip, on && styles.choiceChipOn]}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => {
                            haptics.tap();
                            setUndecided(prev => prev.filter(k => k !== key));
                            setChoices(prev => applyChoice(prev, group, option.id));
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${group.label}: ${name}`}
                        >
                          <Text style={[styles.choiceChipText, on && styles.choiceChipTextOn]}>{name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    {/* Ingredients only. A component group names a dish, and
                        two dishes' worth of lines on the list is not something
                        one tick at the shelf could ever take back off — see
                        ChoiceResolution.undecided. */}
                    {group.kind === 'ingredient' && (
                      <TouchableOpacity
                        style={[styles.choiceChip, open && styles.choiceChipOn]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => {
                          haptics.tap();
                          setUndecided(prev => (open ? prev.filter(k => k !== key) : [...prev, key]));
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: open }}
                        accessibilityLabel={`${group.label}: put both on the list and decide at the store`}
                      >
                        <Text style={[styles.choiceChipText, open && styles.choiceChipTextOn]}>
                          Decide at the store
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {open && (
                    <Text style={styles.choiceHint}>
                      All {group.options.length} go on the list. Tick the one you get and the rest come off.
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {nothingToShow ? (
          <View style={styles.centered}>
            <EmptyState
              icon="cart-outline"
              title="Nothing to add"
              subtitle="This recipe has no ingredients yet."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {SECTIONS.map(({ category, label, interactive, collapsible }) => {
              const rows = byCategory[category];
              if (rows.length === 0) return null;
              const isOpen = !collapsible || expandedSections.has(category);
              return (
                <View key={category} style={styles.section}>
                  <TouchableOpacity
                    style={styles.sectionHeaderRow}
                    activeOpacity={collapsible ? interaction.activeOpacity : 1}
                    onPress={collapsible ? () => toggleSection(category) : undefined}
                    disabled={!collapsible}
                    accessibilityRole={collapsible ? 'button' : undefined}
                    accessibilityState={collapsible ? { expanded: isOpen } : undefined}
                  >
                    <Text style={styles.sectionLabel}>{label} · {rows.length}</Text>
                    {collapsible && (
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={12}
                        color={colors.textTertiary}
                      />
                    )}
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={styles.card}>
                      {rows.map((row, i) => {
                        const on = interactive && ticked.has(row.nameKey);
                        const subtitle = row.reason ?? (row.sources.length > 1 ? row.sources.join(' · ') : null);
                        // Its own line rather than folded into the subtitle:
                        // the subtitle says why the row is here, this says the
                        // row is one of a set, and a row you read as ordinary is
                        // a row you buy all of.
                        const alternativeNote = alternativeNotes.get(row.nameKey);
                        // Directly under the name, because it qualifies the
                        // name: this row is the app's substitution, not the
                        // recipe's word. Same job `≈` does for a converted
                        // amount.
                        const swapNote = row.swappedFrom ? describeStandingSwap(row.swappedFrom) : null;
                        // Every Need to buy line, not only the ones the
                        // catalog already knows: markAlreadyHave mints the row
                        // it needs, and "I've got that already" is a thing to
                        // be able to say about an ingredient the app is seeing
                        // for the first time most of all.
                        const canMarkHave = category === 'needToBuy';
                        const subs = substitutesByKey.get(row.nameKey);
                        // Shown in the reader's units; what gets written to the
                        // list is still row.quantity, as the recipe wrote it.
                        const shownQuantity = convertQuantity(row.quantity, unitSystem).text;
                        return (
                          <React.Fragment key={row.nameKey}>
                            {i > 0 && <View style={styles.sep} />}
                            <View style={styles.row}>
                              <TouchableOpacity
                                style={styles.rowMain}
                                activeOpacity={interactive ? interaction.activeOpacity : 1}
                                onPress={interactive ? () => toggle(row) : undefined}
                                disabled={!interactive}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: on, disabled: !interactive }}
                                accessibilityLabel={
                                  [row.name, swapNote, shownQuantity, subtitle, alternativeNote,
                                   !interactive ? 'already in your cart' : null]
                                    .filter(Boolean)
                                    .join(', ')
                                }
                              >
                                <View style={[
                                  styles.checkbox,
                                  on && styles.checkboxOn,
                                  !interactive && styles.checkboxDisabled,
                                ]}>
                                  {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
                                </View>
                                <View style={styles.body}>
                                  {/* Two lines, where every other line on the
                                      row gets one: the name is the thing
                                      being decided about, and "smooth natural
                                      pea…" is not a decision anyone can make.
                                      The captions under it are qualifiers, so
                                      clipping one costs less than clipping
                                      this. */}
                                  <Text style={[styles.name, !interactive && styles.nameDisabled]} numberOfLines={2}>
                                    {row.name}
                                  </Text>
                                  {!!swapNote && (
                                    <Text style={styles.swapNote} numberOfLines={1}>{swapNote}</Text>
                                  )}
                                  {!!subtitle && (
                                    <Text style={styles.sources} numberOfLines={1}>{subtitle}</Text>
                                  )}
                                  {!!alternativeNote && (
                                    <Text style={styles.alternativeNote} numberOfLines={1}>
                                      {alternativeNote}
                                    </Text>
                                  )}
                                </View>
                                {!!shownQuantity && (
                                  <View style={styles.qtyPill}>
                                    {/* Two lines, same call as the name
                                        above: "1 large pie…" names no amount
                                        anyone can shop to. The pill is capped
                                        by width, not by lines, so the second
                                        one costs the row no width. */}
                                    <Text style={styles.qtyText} numberOfLines={2}>{shownQuantity}</Text>
                                  </View>
                                )}
                              </TouchableOpacity>
                              {!!subs && (
                                <TouchableOpacity
                                  style={styles.subsButton}
                                  activeOpacity={interaction.activeOpacity}
                                  onPress={() => {
                                    haptics.tap();
                                    const item = itemsByKey.get(row.nameKey);
                                    if (item) setSubsItemId(item.id);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Substitutes for ${row.name}: ${describeSubstitutes(subs)}`}
                                >
                                  <Ionicons
                                    name="swap-horizontal"
                                    size={iconSize.sm}
                                    color={colors.accent}
                                  />
                                  {subs.length > 1 && (
                                    <Text style={styles.subsCount}>{subs.length}</Text>
                                  )}
                                </TouchableOpacity>
                              )}
                              {canMarkHave && (
                                <InlineAction
                                  label="In pantry"
                                  onPress={() => markAlreadyHave(row)}
                                  accessibilityLabel={`${row.name} is in the pantry, skip it and remember it for next time`}
                                />
                              )}
                            </View>
                          </React.Fragment>
                        );
                      })}
                    </View>
                  )}
                  {category === 'alreadyOnList' && (
                    <Text style={styles.sectionHint}>
                      Already on the list — tick one to top up its quantity for this recipe.
                    </Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        {!!pantryUndo && (
          <View
            style={[styles.undoWrap, { bottom: insets.bottom + spacing.lg }]}
            pointerEvents="box-none"
          >
            <View style={[styles.undoBar, shadows.fab]}>
              <Text style={styles.undoLabel} numberOfLines={1}>{pantryUndo.label}</Text>
              <InlineAction
                label="Undo"
                onPress={handlePantryUndo}
                accessibilityLabel={`Undo: ${pantryUndo.label}`}
              />
            </View>
          </View>
        )}
      </View>

      {/* Inside this Modal rather than beside it, the same nesting
          GroceryItemSheet uses for its own: a Modal presents from the view
          controller its React parent belongs to, so a sibling would ask the
          screen's controller to present a second sheet while this one is up. */}
      <SubstituteSheet
        visible={subsItemId !== null}
        itemId={subsItemId}
        onClose={() => setSubsItemId(null)}
      />
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  // Above the list rather than in it: this decides what the list *is*, so it
  // sits with the header it qualifies and doesn't scroll away from the rows it
  // just changed.
  choices: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
    paddingBottom: spacing.md,
  },
  scaleRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  choiceGroup: { gap: spacing.xs },
  choiceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choiceChip: {
    // bgSecondary, not bgTertiary: this row sits directly on the sheet's own
    // `colors.bg` (see `root` below), and bgTertiary is only one step off it —
    // #EFEFF4 against a light theme's #F2F2F7 background reads as barely-there
    // until a chip is selected. Same fix RecipeScaleChips needed for the same
    // reason (see its `surface` prop) once the batch chips landed on this
    // screen right above this row and made the contrast mismatch obvious.
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceChipOn: { backgroundColor: colors.accent },
  choiceChipText: { color: colors.textSecondary, fontSize: font.sm },
  choiceChipTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
  choiceHint: { color: colors.textTertiary, fontSize: font.xs },
  section: { gap: spacing.xs },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: font.xs * 1.4,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
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
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
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
  checkboxDisabled: { opacity: 0.4 },
  body: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  nameDisabled: { color: colors.textSecondary },
  sources: { fontSize: font.xs, color: colors.textTertiary },
  // Accent, where `sources` above is grey: this one is the difference between
  // one shop and two, so it has to survive a glance down a list of ten rows.
  // Same treatment the recipe screen gives its own "or manchego".
  alternativeNote: { fontSize: font.xs, color: colors.accent, fontWeight: fontWeight.medium },
  // Accent for the same reason `alternativeNote` is: this row isn't what the
  // recipe wrote, and that has to survive a glance down a list of ten rows.
  swapNote: { fontSize: font.xs, color: colors.accent, fontWeight: fontWeight.medium },
  qtyPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 90,
  },
  // Centred for the two-line case: the pill takes the width of its longest
  // line, so this only moves the shorter one ("1 large" / "piece") and is a
  // no-op on the single-line pills, which size to their own text.
  qtyText: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Icon-sized rather than a second text pill: it sits beside "Already have
  // it" on the same row, and two labelled pills leave a long ingredient name
  // nothing to be read in. The count only appears past one, where "2" is the
  // whole point; a lone substitute is named by the sheet it opens.
  subsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  subsCount: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  // Floats over the list rather than pushing it, the same way UndoBar floats
  // over the screen it answers for — a footer here would reflow the list on
  // every tap, and the sheet has no footer to begin with.
  undoWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  undoLabel: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
