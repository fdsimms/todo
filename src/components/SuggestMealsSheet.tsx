import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { dayKeyOf } from '../utils/dateUtils';
import { describeRecipe } from '../utils/recipeUtils';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** Already ranked by suggestRecipesForEmptyNight — this sheet doesn't re-sort. */
  recipes: Recipe[];
  weekDays: Date[];
  onPlan: (recipe: Recipe, dateKey: string) => void;
  onClose: () => void;
}

/**
 * "What can I make from what I've got" for an empty week — offline, ranked by
 * scoreRecipeAgainstCatalog, no API key involved. This is deliberately the
 * whole feature: inventing a brand-new meal idea from nothing is a separate,
 * much larger surface (a real generation flow, not a ranking one) and isn't
 * part of this.
 *
 * Accepting a suggestion doesn't open a day picker — it lands on the next
 * still-empty dinner slot in week order and the row shows where it went, so
 * working down the list fills the week without a decision per recipe.
 */
export function SuggestMealsSheet({ visible, recipes, weekDays, onPlan, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [plannedCount, setPlannedCount] = useState(0);
  const [landedOn, setLandedOn] = useState<Map<string, Date>>(new Map());

  const accept = (recipe: Recipe) => {
    if (landedOn.has(recipe.id) || weekDays.length === 0) return;
    const day = weekDays[plannedCount % weekDays.length];
    haptics.success();
    onPlan(recipe, dayKeyOf(day));
    setLandedOn(prev => new Map(prev).set(recipe.id, day));
    setPlannedCount(c => c + 1);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Suggest meals</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={72} />
        </View>

        {recipes.length === 0 ? (
          <View style={styles.centered}>
            <EmptyState
              icon="restaurant-outline"
              title="Nothing to suggest"
              subtitle="None of your recipes share enough with what's in your grocery catalog yet."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.intro}>
              Made from what's already in your grocery catalog — tap one to plan it.
            </Text>
            {recipes.map(recipe => {
              const landedDay = landedOn.get(recipe.id);
              return (
                <TouchableOpacity
                  key={recipe.id}
                  style={[styles.row, !!landedDay && styles.rowDone]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => accept(recipe)}
                  disabled={!!landedDay}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!landedDay }}
                  accessibilityLabel={landedDay
                    ? `${recipe.name}, planned for ${format(landedDay, 'EEEE')}`
                    : `Plan ${recipe.name}`}
                >
                  <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={1}>{recipe.name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {landedDay ? `Planned for ${format(landedDay, 'EEEE')}` : describeRecipe(recipe)}
                    </Text>
                  </View>
                  <Ionicons
                    name={landedDay ? 'checkmark-circle' : 'add-circle-outline'}
                    size={iconSize.md}
                    color={landedDay ? colors.green : colors.accent}
                  />
                </TouchableOpacity>
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
  headerSpacer: { width: 72 },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  intro: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  list: { paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  rowDone: { opacity: 0.6 },
  body: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  meta: { fontSize: font.xs, color: colors.textTertiary },
});
