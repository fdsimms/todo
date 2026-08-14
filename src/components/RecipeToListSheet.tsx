import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
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
import { defaultOnHandUntil } from '../utils/grocerySuggest';
import {
  classifyPlanned,
  plannedIngredientsForRecipe,
  restockRows,
  type ClassifiedIngredient,
  type PlanCategory,
} from '../utils/mealPlanGroceries';
import { applyChoice, recipeChoiceGroups } from '../utils/recipeComponents';
import { normalizeScale } from '../utils/recipeScale';
import { convertQuantity } from '../utils/unitConvert';
import { RecipeScaleChips } from './RecipeScaleChips';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { haptics } from '../utils/haptics';

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
  { category: 'inTrolley', label: 'In your trolley', interactive: false, collapsible: false },
  { category: 'staple', label: 'Always have', interactive: true, collapsible: true },
  { category: 'probablyHave', label: 'Probably have', interactive: true, collapsible: true },
];

/**
 * Review-then-commit for one recipe, the single-recipe sibling of
 * AddWeekToListSheet — same classifyPlanned pantry-awareness (needToBuy /
 * alreadyOnList / inTrolley / probablyHave) instead of RecipeDetailScreen's
 * old blind addFromPlan over every ingredient.
 *
 * The one thing this sheet has that AddWeekToListSheet doesn't: "Already have
 * it" on a needToBuy row that matches a real catalog item. Unticking a row
 * only skips it for this add — the pantry guess forgets nothing was said.
 * Asserting onHandUntil (the same write GroceryItemSheet's "Got it" makes) is
 * what actually keeps that ingredient from being offered again next time,
 * which is the whole point of an "already have it" option on an import.
 * There's nothing to assert for a genuinely new ingredient — no catalog row
 * has it yet — so the action only appears once a row resolves to one.
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const unitSystem = useSettingsStore(s => s.unitSystem);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const addFromPlan = useGroceryStore(s => s.addFromPlan);
  const setOnHandUntil = useGroceryStore(s => s.setOnHandUntil);

  const itemsByKey = useMemo(() => new Map(items.map(i => [i.nameKey, i])), [items]);

  // Which alternative this *shop* is for, held only as long as the sheet is
  // open. Deliberately not written anywhere: an add-to-list off the recipe
  // screen isn't attached to a meal, so there is nothing for a pick to be a
  // fact about — MealPlanEntry.recipeChoices is where a lasting one lives.
  // It starts empty, which is every group on its default.
  const [choices, setChoices] = useState<string[]>([]);
  const choiceKey = choices.join('|');

  // Same contract as `choices` above, and for the same reason: an ad-hoc shop
  // isn't attached to a meal, so there's nothing for "I'm making a double batch"
  // to be a lasting fact about.
  const [scale, setScale] = useState(1);

  const choiceGroups = useMemo(
    () => (recipe && recipesById ? recipeChoiceGroups(recipe, recipesById, { chosen: choices }) : []),
    [recipe, recipesById, choiceKey]
  );

  const classified = useMemo(() => {
    if (!recipe) return [];
    return classifyPlanned(
      plannedIngredientsForRecipe(recipe, recipesById, { chosen: choices }, scale),
      items,
      new Date(),
      itemSubs
    );
  }, [recipe, recipesById, items, itemSubs, choiceKey, scale]);

  const byCategory = useMemo(() => {
    const out: Record<PlanCategory, ClassifiedIngredient[]> = {
      needToBuy: [], alreadyOnList: [], inTrolley: [], probablyHave: [], staple: [],
    };
    for (const row of classified) out[row.category].push(row);
    return out;
  }, [classified]);

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<PlanCategory>>(
    new Set(['probablyHave']),
  );

  useEffect(() => {
    if (!visible) return;
    setChoices(initialChoices ? [...initialChoices] : []);
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
    setTicked(new Set(rows.map(r => r.nameKey)));
    setExpandedSections(new Set());
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

  const markAlreadyHave = (row: ClassifiedIngredient) => {
    const item = itemsByKey.get(row.nameKey);
    if (!item) return;
    haptics.tap();
    setOnHandUntil(item.id, defaultOnHandUntil(item, new Date()));
    setTicked(prev => {
      const next = new Set(prev);
      next.delete(row.nameKey);
      return next;
    });
  };

  const handleAdd = () => {
    if (!recipe) { onClose(); return; }
    const rows: PlannedRow[] = classified
      .filter(r => r.category !== 'inTrolley' && ticked.has(r.nameKey))
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
      }));

    if (rows.length === 0) { onClose(); return; }

    const result = addFromPlan(rows);
    haptics.success();

    const parts = [`Added ${result.added.length}`];
    if (result.alreadyOnList.length > 0) parts.push(`${result.alreadyOnList.length} already on your list`);
    if (result.skippedInCart.length > 0) parts.push(`${result.skippedInCart.length} already in your trolley`);
    Alert.alert(
      result.added.length > 0 ? 'On the list' : 'Nothing to add',
      parts.join(' · ')
    );
    onClose();
  };

  const addCount = ticked.size;
  const nothingToShow = classified.length === 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
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
            {choiceGroups.map(group => (
              <View key={`${group.recipe.id}:${group.label}`} style={styles.choiceGroup}>
                <Text style={styles.sectionLabel}>{group.label}</Text>
                <View style={styles.choiceChips}>
                  {group.options.map(option => {
                    const on = option.id === group.active.id;
                    const name = option.name || 'Deleted recipe';
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[styles.choiceChip, on && styles.choiceChipOn]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => {
                          haptics.tap();
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
                </View>
              </View>
            ))}
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
                        const canMarkHave = category === 'needToBuy' && row.known;
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
                                  [row.name, shownQuantity, subtitle, !interactive ? 'already in your trolley' : null]
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
                                  <Text style={[styles.name, !interactive && styles.nameDisabled]} numberOfLines={1}>
                                    {row.name}
                                  </Text>
                                  {!!subtitle && (
                                    <Text style={styles.sources} numberOfLines={1}>{subtitle}</Text>
                                  )}
                                </View>
                                {!!shownQuantity && (
                                  <View style={styles.qtyPill}>
                                    <Text style={styles.qtyText} numberOfLines={1}>{shownQuantity}</Text>
                                  </View>
                                )}
                              </TouchableOpacity>
                              {canMarkHave && (
                                <TouchableOpacity
                                  style={styles.haveButton}
                                  activeOpacity={interaction.activeOpacity}
                                  onPress={() => markAlreadyHave(row)}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Already have ${row.name} — skip it and remember it for next time`}
                                >
                                  <Text style={styles.haveButtonText}>Already have it</Text>
                                </TouchableOpacity>
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
      </View>
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
    paddingVertical: 6,
  },
  choiceChipOn: { backgroundColor: colors.accent },
  choiceChipText: { color: colors.textSecondary, fontSize: font.sm },
  choiceChipTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
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
  qtyPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 90,
  },
  qtyText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  haveButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  haveButtonText: {
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
});
