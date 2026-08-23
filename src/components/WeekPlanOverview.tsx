import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { InlineAction } from './InlineAction';
import { titleForEntry } from '../utils/mealPlan';
import { hasShoppableMeals } from '../utils/mealPlanGroceries';
import { describePantryCoverage, type PantryCoverage } from '../utils/recipeUtils';
import {
  describeWeekDecision,
  type WeekNight,
  type WeekShoppingCopy,
} from '../utils/weekPlan';

interface Props {
  /** The week, already marked up — see weekPlan.weekNights. */
  nights: readonly WeekNight[];
  recipesById: ReadonlyMap<string, Recipe>;
  /** `describeBareWeek`'s line, in place of a stack of empty sections. */
  hint: string | null;
  onPlanDay: (dayKey: string) => void;
  /**
   * Shops one night — the same day-scoped add the day list's own headers
   * carry, so the shortcut is wherever a day is. Only offered on a night that
   * has something to shop (hasShoppableMeals), which is usually two or three
   * of the seven.
   */
  onAddDayToList: (dayKey: string) => void;
  /** Null when the week has nothing shoppable behind it — the section doesn't render. */
  shopping: WeekShoppingCopy | null;
  onAddWeekToList: () => void;
  /** Already ranked by suggestRecipesForEmptyNight; this renders the order it's given. */
  suggestions: readonly Recipe[];
  pantryByRecipeId: ReadonlyMap<string, PantryCoverage>;
  /**
   * The night a suggestion would land on. Null when the week has no night left
   * to decide, and the shelf then doesn't render at all — the same call the day
   * list's own `canSuggestMeals` makes: the week decides whether suggestions
   * are *offered*, never what is on them, and a shelf with nowhere to land is
   * a row of recipes you can only look at.
   */
  planTarget: Date | null;
  onPlanSuggestion: (recipe: Recipe) => void;
  /** The full planning pass. Null when there's nowhere for it to land. */
  onSuggestMeals: (() => void) | null;
  /** "Copy 27 Jul – 2 Aug", when this week is empty and there's a week behind it. */
  copyWeekLabel: string | null;
  onCopyWeek: () => void;
  bottomInset: number;
}

/**
 * "Whole week" — the deciding lens (#1669).
 *
 * The moment this exists for is the sit-down one: which nights aren't decided,
 * what the plan still owes the shop, and what could be made from what's already
 * in the catalog. Those three answers currently live on three surfaces, and
 * none of them is a *new* answer — this renders the meal plan screen's own
 * selectors in the order that decision is actually made, which is why it's a
 * lens over that screen's week rather than a screen of its own with a second
 * copy of the range window.
 *
 * Every section that has nothing to say renders nothing at all, and the week's
 * seven nights carry the whole surface when they're all it has: a cold install
 * gets one hint line and seven tappable nights rather than four headings with
 * empty cards under them.
 */
export function WeekPlanOverview({
  nights,
  recipesById,
  hint,
  onPlanDay,
  onAddDayToList,
  shopping,
  onAddWeekToList,
  suggestions,
  pantryByRecipeId,
  planTarget,
  onPlanSuggestion,
  onSuggestMeals,
  copyWeekLabel,
  onCopyWeek,
  bottomInset,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const decision = describeWeekDecision(nights);
  const targetLabel = planTarget ? format(planTarget, 'EEE') : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      keyboardShouldPersistTaps="handled"
    >
      {!!hint && <Text style={styles.hint}>{hint}</Text>}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Nights</Text>
        {!!decision && <Text style={styles.sectionValue}>{decision}</Text>}
      </View>
      <View style={styles.card}>
        {nights.map((night, idx) => {
          const titles = night.entries.map(e => titleForEntry(e, recipesById)).filter(Boolean);
          const dayLabel = format(night.date, 'EEEE d MMMM');
          const shoppable = hasShoppableMeals(
            night.entries, recipesById, { startKey: night.dayKey, endKey: night.dayKey }
          );
          const spoken = [
            dayLabel,
            titles.length > 0 ? titles.join(', ') : null,
            night.open && !night.past ? 'no dinner planned' : null,
          ].filter(Boolean).join(', ');
          return (
            <React.Fragment key={night.dayKey}>
              {idx > 0 && <View style={styles.sep} />}
              <TouchableOpacity
                style={styles.night}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); onPlanDay(night.dayKey); }}
                accessibilityRole="button"
                accessibilityLabel={`${spoken}. Plan a meal.`}
              >
                <Text
                  style={[
                    styles.nightDay,
                    night.today && styles.nightDayToday,
                    night.past && styles.nightPast,
                  ]}
                >
                  {night.today ? 'Today' : format(night.date, 'EEE d')}
                </Text>
                <View style={styles.nightBody}>
                  {titles.length > 0 && (
                    <Text
                      style={[styles.nightMeals, night.past && styles.nightPast]}
                      numberOfLines={2}
                    >
                      {titles.join(' · ')}
                    </Text>
                  )}
                  {/* The open ones, made obvious — and only where there's still
                      something to decide. An empty Monday read on a Thursday is
                      not an open night, it's a night nobody cooked, so it says
                      that instead of inviting a decision that can't be made. */}
                  {night.open && !night.past && (
                    <View style={styles.openChip}>
                      <Text style={styles.openChipText}>No dinner</Text>
                    </View>
                  )}
                  {night.open && night.past && titles.length === 0 && (
                    <Text style={[styles.nightMeals, styles.nightPast]}>Nothing planned</Text>
                  )}
                </View>
                {/*
                  Nested inside the row rather than beside it, unlike the day
                  list's pair: there the header is a collapse toggle with the +
                  next to it, here the whole row *is* the plan target and the +
                  is its glyph, so the cart is a control living inside a
                  control. RN gives the inner responder the touch; the 16pt gap
                  and the clipped hitSlop are what keep the cart's target off
                  the + beside it, which would plan a meal instead.
                */}
                <View style={styles.nightActions}>
                  {shoppable && (
                    <TouchableOpacity
                      onPress={() => { haptics.tap(); onAddDayToList(night.dayKey); }}
                      activeOpacity={interaction.activeOpacity}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${dayLabel}'s ingredients to the grocery list`}
                    >
                      <Ionicons name="cart-outline" size={iconSize.md} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                  <Ionicons name="add-circle" size={iconSize.lg} color={colors.accent} />
                </View>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </View>

      {shopping && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Still to buy</Text>
          </View>
          <TouchableOpacity
            style={[styles.card, styles.shopRow]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); onAddWeekToList(); }}
            accessibilityRole="button"
            accessibilityLabel={
              `${shopping.lead}${shopping.rest ? `. ${shopping.rest}` : ''}. ` +
              'Review this week’s ingredients and add them to your list.'
            }
          >
            <View style={styles.shopText}>
              <Text style={styles.shopLead}>{shopping.lead}</Text>
              {!!shopping.rest && <Text style={styles.shopRest}>{shopping.rest}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        </>
      )}

      {!!planTarget && suggestions.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>From what you have</Text>
          </View>
          <View style={styles.card}>
            {suggestions.map((recipe, idx) => {
              const coverage = pantryByRecipeId.get(recipe.id);
              const line = coverage ? describePantryCoverage(coverage) : null;
              return (
                <React.Fragment key={recipe.id}>
                  {idx > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.suggestion}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { haptics.tap(); onPlanSuggestion(recipe); }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `Plan ${recipe.name} for ${format(planTarget, 'EEEE')}${line ? `. ${line}` : ''}`
                    }
                  >
                    <View style={styles.suggestionText}>
                      <Text style={styles.suggestionName} numberOfLines={1}>{recipe.name}</Text>
                      {!!line && <Text style={styles.suggestionCoverage} numberOfLines={1}>{line}</Text>}
                    </View>
                    {/* The night it would land on, named rather than implied —
                        a tap that silently picks a day is the one thing a
                        one-tap plan mustn't do. */}
                    <View style={styles.targetChip}>
                      <Ionicons name="add" size={iconSize.xs} color={colors.accent} />
                      <Text style={styles.targetChipText}>{targetLabel}</Text>
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
        </>
      )}

      {(!!onSuggestMeals || !!copyWeekLabel) && (
        <View style={styles.actions}>
          {!!onSuggestMeals && (
            <InlineAction
              label="Plan the week"
              icon="restaurant-outline"
              onPress={() => { haptics.tap(); onSuggestMeals(); }}
              accessibilityLabel="Suggest meals for the nights still open this week"
            />
          )}
          {!!copyWeekLabel && (
            <InlineAction
              label={`Copy ${copyWeekLabel}`}
              icon="copy-outline"
              variant="neutral"
              surface="page"
              onPress={onCopyWeek}
              accessibilityLabel={`Copy the meals from ${copyWeekLabel} onto this week`}
            />
          )}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  hint: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: 18,
    paddingBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionValue: { color: colors.textSecondary, fontSize: font.xs },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 62 + spacing.sm,
  },
  night: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 46,
  },
  nightDay: {
    width: 62,
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  nightDayToday: { color: colors.accent },
  nightPast: { color: colors.textTertiary },
  nightBody: { flex: 1, alignItems: 'flex-start', gap: 5 },
  nightMeals: { color: colors.text, fontSize: font.md, lineHeight: 20 },
  // See the note in the row: `md` rather than the row's own `sm`, so the
  // cart's hitSlop and the + it sits beside don't share any pixels.
  nightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  openChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  openChipText: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  shopText: { flex: 1, gap: 2 },
  shopLead: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  shopRest: { color: colors.textSecondary, fontSize: font.sm },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 52,
  },
  suggestionText: { flex: 1, gap: 2 },
  suggestionName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  suggestionCoverage: { color: colors.textSecondary, fontSize: font.xs },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 6,
    paddingRight: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  targetChipText: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
});
