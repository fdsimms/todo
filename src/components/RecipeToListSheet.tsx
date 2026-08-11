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
import { defaultOnHandUntil } from '../utils/grocerySuggest';
import {
  classifyPlanned,
  plannedIngredientsForRecipe,
  type ClassifiedIngredient,
  type PlanCategory,
} from '../utils/mealPlanGroceries';
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
  onClose: () => void;
}

const SECTIONS: { category: PlanCategory; label: string; interactive: boolean; collapsible: boolean }[] = [
  { category: 'needToBuy', label: 'Need to buy', interactive: true, collapsible: false },
  { category: 'alreadyOnList', label: 'Already on your list', interactive: true, collapsible: false },
  { category: 'inTrolley', label: 'In your trolley', interactive: false, collapsible: false },
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
export function RecipeToListSheet({ visible, recipe, recipesById, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const addFromPlan = useGroceryStore(s => s.addFromPlan);
  const setOnHandUntil = useGroceryStore(s => s.setOnHandUntil);

  const itemsByKey = useMemo(() => new Map(items.map(i => [i.nameKey, i])), [items]);

  const classified = useMemo(() => {
    if (!recipe) return [];
    return classifyPlanned(plannedIngredientsForRecipe(recipe, recipesById), items, new Date());
  }, [recipe, recipesById, items]);

  const byCategory = useMemo(() => {
    const out: Record<PlanCategory, ClassifiedIngredient[]> = {
      needToBuy: [], alreadyOnList: [], inTrolley: [], probablyHave: [],
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
    setTicked(new Set(byCategory.needToBuy.map(r => r.nameKey)));
    setExpandedSections(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
                        const canMarkHave = category === 'needToBuy' && itemsByKey.has(row.nameKey);
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
                                  [row.name, row.quantity, subtitle, !interactive ? 'already in your trolley' : null]
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
                                {!!row.quantity && (
                                  <View style={styles.qtyPill}>
                                    <Text style={styles.qtyText} numberOfLines={1}>{row.quantity}</Text>
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
  section: { gap: spacing.xs },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionLabel: {
    color: colors.textTertiary,
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
