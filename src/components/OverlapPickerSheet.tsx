import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { dayKeyOf } from '../utils/dateUtils';
import type { OverlapMatch } from '../utils/recipeOverlap';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyNote } from './EmptyNote';
import { haptics } from '../utils/haptics';

/** Order-independent, so the dirty check compares sets rather than tap order. */
function serializeSelection(selected: ReadonlySet<string>): string {
  return [...selected].sort().join('\u0000');
}

interface Props {
  visible: boolean;
  /**
   * Ranked by the caller and **captured when the sheet opens** — the list it
   * opens with is the list it keeps, the same rule SuggestMealsSheet works by.
   * A ranking that re-sorted under the user's finger as they picked would move
   * the row they were reaching for.
   */
  matches: readonly OverlapMatch[];
  /** What the overlap is measured against: "this week's meals", or a recipe name. */
  seedLabel: string;
  /**
   * The nights a pick can land on, in order. Present only from the meal plan,
   * which is the one screen that owns a visible week — see `onHandOff`.
   */
  openDays?: readonly Date[];
  onPlan?: (recipe: Recipe, dateKey: string) => void;
  /**
   * Carry the picks over to the meal plan instead of planning them here.
   *
   * The recipe-side entry points have no week in hand: open nights live in
   * `useMealPlanStore`, which is range-scoped, so asking it from the Recipes
   * screen would silently move the window the meal plan is showing. So they
   * hand the ids over and the meal plan plans them against its own week.
   */
  onHandOff?: (recipeIds: string[]) => void;
  onOpenRecipe?: (recipe: Recipe) => void;
  /**
   * Recipes already picked — the set carried over from a recipe-side pick, so
   * the meal plan opens on the choice the user already made rather than on an
   * empty sheet they have to make again.
   */
  initialSelected?: readonly string[];
  onClose: () => void;
}

/**
 * "Cook these together" — recipes ranked by what they'd share with something
 * you're already making.
 *
 * Two modes, decided by whether the caller has nights to offer:
 *
 * - **Planning** (`openDays`): picks land on the open nights in list order,
 *   capped at however many there are, and Save plans them.
 * - **Discovery** (`onHandOff`): no nights here to land on, so Save is
 *   replaced by handing the picks to the meal plan.
 *
 * The count on a row is *ingredients in common*, never a saving — nothing
 * here reads a quantity, and the copy is careful not to imply it does. See
 * `recipeOverlap.ts` for why.
 */
export function OverlapPickerSheet({
  visible,
  matches,
  seedLabel,
  openDays,
  onPlan,
  onHandOff,
  onOpenRecipe,
  initialSelected,
  onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const planning = !!openDays && openDays.length > 0 && !!onPlan;
  const capacity = planning ? openDays!.length : matches.length;

  // A fresh pick set every time it opens: the sheet is about one comparison,
  // and carrying a tick over from the last one would plan a meal nobody chose
  // this time. What it does open with is whatever was carried in from a
  // recipe-side pick, capped at the nights there are to land on.
  //
  // The baseline is stamped alongside it so a pre-ticked sheet doesn't read as
  // dirty before it's been touched — same reason RecipeToListSheet keeps one,
  // and the reason `selected.size > 0` isn't the test.
  const baselineRef = useRef('');
  useEffect(() => {
    if (!visible) return;
    const opening = new Set((initialSelected ?? []).slice(0, capacity));
    setSelected(opening);
    baselineRef.current = serializeSelection(opening);
    // Only on the opening edge: re-running this as the props behind `capacity`
    // settle would throw away picks already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * Which night each selected pick lands on — assigned in the list's own order
   * rather than in tap order, so the preview under a row doesn't reshuffle
   * when an earlier row is ticked.
   */
  const dayByRecipe = useMemo(() => {
    const out = new Map<string, Date>();
    if (!planning) return out;
    let next = 0;
    for (const match of matches) {
      if (!selected.has(match.recipe.id)) continue;
      const day = openDays![next];
      if (!day) break;
      out.set(match.recipe.id, day);
      next += 1;
    }
    return out;
  }, [planning, matches, selected, openDays]);

  const toggle = (recipeId: string) => {
    haptics.tap();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else if (next.size < capacity) next.add(recipeId);
      return next;
    });
  };

  const handleCancel = () => {
    if (serializeSelection(selected) === baselineRef.current) {
      onClose();
      return;
    }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const handleSave = () => {
    if (!planning) return;
    for (const match of matches) {
      const day = dayByRecipe.get(match.recipe.id);
      if (!day) continue;
      onPlan!(match.recipe, dayKeyOf(day));
    }
    haptics.success();
    onClose();
  };

  const handOff = () => {
    if (!onHandOff) return;
    const ids = matches.filter(m => selected.has(m.recipe.id)).map(m => m.recipe.id);
    if (ids.length === 0) return;
    haptics.tap();
    onHandOff(ids);
  };

  const count = selected.size;
  const full = count >= capacity;

  return (
    <SheetModal
      name="OverlapPickerSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title="Cook these together"
          left={
            <SheetHeaderButton
              label={planning ? 'Cancel' : 'Done'}
              role="cancel"
              onPress={handleCancel}
              minWidth={72}
            />
          }
          right={
            planning ? (
              <SheetHeaderButton
                label={count > 0 ? `Plan ${count}` : 'Plan'}
                onPress={handleSave}
                disabled={count === 0}
                minWidth={72}
              />
            ) : undefined
          }
        />

        <Text style={styles.intro}>
          {matches.length === 0
            ? `Nothing in your recipes shares ingredients with ${seedLabel}.`
            : `Recipes that share ingredients with ${seedLabel}, most in common first.`}
        </Text>

        <ScrollView contentContainerStyle={styles.list}>
          {matches.length === 0 ? (
            <View style={styles.notePad}>
              <EmptyNote icon="git-merge-outline">
                Add a few more recipes and this will find the ones you could shop for together.
              </EmptyNote>
            </View>
          ) : (
            matches.map(match => {
              const picked = selected.has(match.recipe.id);
              const day = dayByRecipe.get(match.recipe.id);
              const disabled = !picked && full;
              return (
                <View key={match.recipe.id} style={styles.row}>
                  {/* The name gets its own full-width line and the chips get
                      theirs. A name sharing a flex row with content that can
                      grow is what truncates the one thing the row is for.

                      Selection shows in the glyph and nowhere else: tinting
                      the card would have to use bgTertiary, which is what the
                      staple chips and the neutral InlineAction inside it are
                      already filled with, so a selected row swallowed both.
                      Same answer TaskItem reached — the indicator carries it. */}
                  <TouchableOpacity
                    style={styles.rowHead}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => toggle(match.recipe.id)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled, selected: picked }}
                    accessibilityLabel={`${picked ? 'Deselect' : 'Select'} ${match.recipe.name}, shares ${match.score} ${match.score === 1 ? 'ingredient' : 'ingredients'}`}
                  >
                    <View style={styles.rowName}>
                      <Text style={styles.name} numberOfLines={2}>
                        {match.recipe.name}
                      </Text>
                      <Text style={styles.meta}>
                        {day
                          ? `Shares ${match.score} · lands on ${format(day, 'EEEE')}`
                          : `Shares ${match.score} ${match.score === 1 ? 'ingredient' : 'ingredients'}`}
                      </Text>
                    </View>
                    <Ionicons
                      name={picked ? 'checkmark-circle' : 'add-circle-outline'}
                      size={iconSize.md}
                      color={picked ? colors.accent : disabled ? colors.textTertiary : colors.accent}
                    />
                  </TouchableOpacity>

                  <View style={styles.chips}>
                    {match.shared.map(share => (
                      <View key={share.key} style={styles.chip}>
                        <Text style={styles.chipText}>{share.name}</Text>
                      </View>
                    ))}
                    {/* Staples last and quieter: they are shared, and saying so
                        is honest, but they are not why this row is here. */}
                    {match.sharedStaples.map(share => (
                      <View key={share.key} style={[styles.chip, styles.chipStaple]}>
                        <Text style={[styles.chipText, styles.chipTextStaple]}>{share.name}</Text>
                      </View>
                    ))}
                  </View>

                  {onOpenRecipe && (
                    <View style={styles.rowActions}>
                      <InlineAction
                        label="Open recipe"
                        variant="neutral"
                        onPress={() => onOpenRecipe(match.recipe)}
                        accessibilityLabel={`Open ${match.recipe.name}`}
                      />
                    </View>
                  )}
                </View>
              );
            })
          )}

          {!planning && onHandOff && matches.length > 0 && (
            <View style={styles.footer}>
              <InlineAction
                label={count > 0 ? `Plan ${count} on the meal plan` : 'Plan these on the meal plan'}
                icon="calendar-outline"
                onPress={handOff}
                disabled={count === 0}
                accessibilityLabel="Take the selected recipes to the meal plan"
              />
            </View>
          )}

          {planning && full && (
            <Text style={styles.footnote}>
              {openDays!.length === 1
                ? 'That fills the one open night this week.'
                : `That fills all ${openDays!.length} open nights this week.`}
            </Text>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  intro: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  list: { paddingBottom: spacing.xl },
  notePad: { paddingHorizontal: spacing.md },
  row: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowName: { flex: 1 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  meta: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xxs,
  },
  chipStaple: { backgroundColor: colors.bgTertiary },
  chipText: { fontSize: font.xxs, fontWeight: fontWeight.medium, color: colors.accentText },
  chipTextStaple: { color: colors.textSecondary },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  footnote: {
    fontSize: font.xs,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
