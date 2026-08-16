import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { MealPlanEntry, Recipe } from '../types';
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
import { useMealPlanStore } from '../store/useMealPlanStore';
import {
  collectPlannedIngredients,
  classifyPlanned,
  type ClassifiedIngredient,
  type PlanCategory,
} from '../utils/mealPlanGroceries';
import { convertQuantity } from '../utils/unitConvert';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  /** The loaded week's entries — already range-scoped by useMealPlanStore. */
  entries: readonly MealPlanEntry[];
  recipesById: ReadonlyMap<string, Recipe>;
  range: { startKey: string; endKey: string };
  onClose: () => void;
}

const SECTIONS: { category: PlanCategory; label: string; interactive: boolean; collapsible: boolean }[] = [
  { category: 'needToBuy', label: 'Need to buy', interactive: true, collapsible: false },
  { category: 'alreadyOnList', label: 'Already on your list', interactive: true, collapsible: false },
  { category: 'inCart', label: 'In your cart', interactive: false, collapsible: false },
  // Collapsed by default, same reasoning as probablyHave below: salt and
  // water aren't a decision the user asked to make on every add.
  { category: 'staple', label: 'Always have', interactive: true, collapsible: true },
  // Collapsed by default: this is grocerySuggest's pantry guess, not
  // something the user asked for, so it starts out of the way with its
  // count visible rather than pre-expanded among rows that need a decision.
  { category: 'probablyHave', label: 'Probably have', interactive: true, collapsible: true },
];

/**
 * Review-then-commit, same shape as GroceryAISheet and the recipe detail
 * screen's "Add ingredients to list" — a week's worth of recipes is exactly
 * the kind of bulk add that must never silently land on a list the user may
 * have curated.
 *
 * Ticking follows the table this feature was speced against: "Need to buy"
 * starts ticked (that's the point of the button), "Already on your list"
 * starts unticked because the only thing ticking it does is top up the
 * quantity of a row that's already there, and "In your cart" is shown for
 * information but can't be toggled at all — it's already been dealt with
 * this trip.
 */
export function AddWeekToListSheet({ visible, entries, recipesById, range, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const unitSystem = useSettingsStore(s => s.unitSystem);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const addFromPlan = useGroceryStore(s => s.addFromPlan);
  const stampAddedToList = useMealPlanStore(s => s.stampAddedToList);

  const classified = useMemo(() => {
    const planned = collectPlannedIngredients(entries, recipesById, range);
    return classifyPlanned(planned, items, new Date(), itemSubs);
  }, [entries, recipesById, range, items, itemSubs]);

  const byCategory = useMemo(() => {
    const out: Record<PlanCategory, ClassifiedIngredient[]> = {
      needToBuy: [], alreadyOnList: [], inCart: [], probablyHave: [], staple: [],
    };
    for (const row of classified) out[row.category].push(row);
    return out;
  }, [classified]);

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<PlanCategory>>(
    new Set(['probablyHave']),
  );
  // What `ticked` was reset to on open — compared against on dismiss so a
  // swipe-down or Cancel with real unticks/reticks pending asks first. See
  // handleCancel.
  const tickedBaselineRef = useRef<string>('');

  // Reset to the default tick state fresh each time the sheet opens, rather
  // than living-recompute against classified while it's up — same model
  // GroceryAISheet uses for its own accepted-rows state.
  useEffect(() => {
    if (!visible) return;
    const defaultTicked = new Set(byCategory.needToBuy.map(r => r.nameKey));
    setTicked(defaultTicked);
    tickedBaselineRef.current = JSON.stringify([...defaultTicked].sort());
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

  // Same shape RecipeToListSheet's own handleCancel uses.
  const handleCancel = () => {
    const dirty = JSON.stringify([...ticked].sort()) !== tickedBaselineRef.current;
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
    const rows: PlannedRow[] = classified
      .filter(r => r.category !== 'inCart' && ticked.has(r.nameKey))
      .map(r => ({
        name: r.name,
        quantity: r.quantity || null,
        aisle: r.aisle,
        sourceRecipeId: r.sourceRecipeId,
        sourceRecipeTitle: r.sourceRecipeTitle,
      }));

    if (rows.length === 0) { onClose(); return; }

    const result = addFromPlan(rows);
    stampAddedToList(range.startKey);
    haptics.success();

    // Each count on its own terms, never added together — the same
    // discipline describeShops and RecipeDetailScreen's addToList keep.
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
          <Text style={styles.headerTitle}>Add week to list</Text>
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
              subtitle="Plan a dinner from your recipe box and its ingredients show up here."
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
                        // A pantry-guess reason takes priority over the source
                        // breakdown — it's the more useful "why is this here"
                        // for a probablyHave row, and a single-source row has
                        // no breakdown to show anyway.
                        const subtitle = row.reason ?? (row.sources.length > 1 ? row.sources.join(' · ') : null);
                        // Shown in the reader's units; what gets written to the
                        // list is still row.quantity, as the recipes wrote it.
                        const shownQuantity = convertQuantity(row.quantity, unitSystem).text;
                        return (
                          <React.Fragment key={row.nameKey}>
                            {i > 0 && <View style={styles.sep} />}
                            <TouchableOpacity
                              style={styles.row}
                              activeOpacity={interactive ? interaction.activeOpacity : 1}
                              onPress={interactive ? () => toggle(row) : undefined}
                              disabled={!interactive}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on, disabled: !interactive }}
                              accessibilityLabel={
                                [row.name, shownQuantity, subtitle, !interactive ? 'already in your cart' : null]
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
                          </React.Fragment>
                        );
                      })}
                    </View>
                  )}
                  {category === 'alreadyOnList' && (
                    <Text style={styles.sectionHint}>
                      Already on the list — tick one to top up its quantity for this week.
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
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
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
    maxWidth: 110,
  },
  qtyText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
});
