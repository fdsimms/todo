import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
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
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  extractRecipe, type ExtractedRecipe, type RecipeGroceryItem,
} from '../services/aiSuggestions';
import { describeImportError, isRetryableImportError } from '../services/recipePage';
import { normalizeIngredient, formatServingsRange } from '../utils/recipeUtils';
import { aisleForName } from '../utils/groceryAisles';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { ExtractedIngredientRow } from './ExtractedIngredientRow';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  recipe: Recipe | null;
  onClose: () => void;
}

/**
 * The counterpart to GroceryAISheet's "From a recipe" mode: that one turns a
 * paste into grocery items and throws the text away; this one keeps it,
 * filling in *this* recipe's servings and ingredients instead of just
 * shopping for it. Reuses extractRecipe — same prompt, same schema, same
 * validation — so a paste here and a paste there read the ingredients
 * identically.
 *
 * Never touches the recipe's name or notes: the recipe already exists (this
 * opens from RecipeDetailScreen), so overwriting what the user already typed
 * with whatever the model guessed would be a surprise, not a convenience.
 */
export function RecipeExtractSheet({ visible, recipe, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const setServings = useRecipeStore(s => s.setServings);
  const setEstimatedMinutes = useRecipeStore(s => s.setEstimatedMinutes);
  const addStructuredIngredients = useRecipeStore(s => s.addStructuredIngredients);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the error state offers a retry or a way back to the input —
  // a mistyped address fails identically however many times you ask.
  const [canRetry, setCanRetry] = useState(true);
  const [extracted, setExtracted] = useState<ExtractedRecipe | null>(null);
  // A working copy of extracted.ingredients, edited in place before Add
  // (#1608) — extracted itself is left untouched.
  const [ingredients, setIngredients] = useState<RecipeGroceryItem[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [applyDetails, setApplyDetails] = useState(true);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  const input = useRecipeImportSource();
  const { resolveSource, reset: resetInput } = input;

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setExtracted(null);
    setIngredients([]);
    setAccepted(new Set());
    setApplyDetails(true);
    resetInput();
  }, [resetInput]);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // A link is fetched first; a paste and a photo resolve to themselves.
      const resolved = await resolveSource();
      if (!resolved) return;
      const result = await extractRecipe(resolved.source, [...aisleOrder]);
      setExtracted(result);
      setIngredients(result.ingredients);
      setAccepted(new Set(result.ingredients.map((_, i) => i)));
      setApplyDetails(result.servings !== null || result.prepMinutes !== null);
    } catch (e) {
      setError(describeImportError(e));
      setCanRetry(isRetryableImportError(e));
    } finally {
      setLoading(false);
    }
  }, [resolveSource, aisleOrder]);

  const toggle = (index: number) => {
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const editIngredient = (index: number, patch: Partial<Pick<RecipeGroceryItem, 'name' | 'quantity'>>) => {
    haptics.success();
    setIngredients(prev => prev.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      // A renamed line is renamed for filing purposes too — "chicken breast"
      // filed under Meat is wrong once the row says "tofu". Same precedence
      // RecipeIngredientSheet's own aisle picker defaults to: the user's own
      // filing first, then the offline lexicon, then Other.
      if (patch.name !== undefined) {
        next.aisle = rememberedAisleFor(patch.name) ?? aisleForName(patch.name) ?? 'Other';
      }
      return next;
    }));
  };

  const handleApply = () => {
    if (!recipe || !extracted) { onClose(); return; }
    const chosen = ingredients
      .filter((_, i) => accepted.has(i))
      .map(item => normalizeIngredient(item))
      .filter((i): i is NonNullable<typeof i> => i !== null);
    if (chosen.length > 0) addStructuredIngredients(recipe.id, chosen);
    if (applyDetails) {
      if (extracted.servings !== null) {
        setServings(recipe.id, extracted.servings, extracted.servingsMax);
      }
      // Was read off the recipe and shown on the row, then dropped on the way
      // out — the row promised a time the recipe never got.
      //
      // Lands on `estimatedMinutes`, NOT on the identically-named
      // `Recipe.prepMinutes`: the extractor's field is the recipe's *total*
      // time, while the model's prepMinutes/estimatedMinutes pair splits prep
      // from cook. A total in the cook half leaves `totalMinutes()` correct;
      // in the prep half it would claim the whole recipe is mise en place.
      if (extracted.prepMinutes !== null) setEstimatedMinutes(recipe.id, extracted.prepMinutes);
    }
    haptics.success();
    onClose();
  };

  const hasDetails = !!extracted && (extracted.servings !== null || extracted.prepMinutes !== null);
  const canApply = !loading && !!extracted && (accepted.size > 0 || (applyDetails && hasDetails));

  // One checkbox applying two facts has to name both when it has both, and it
  // reads out exactly what the row shows rather than a second phrasing of it.
  const detailsLabel = !extracted ? ''
    : extracted.servings !== null
      ? `Serves ${formatServingsRange(extracted.servings, extracted.servingsMax)}${
          extracted.prepMinutes !== null ? `, about ${extracted.prepMinutes} min` : ''}`
      : `About ${extracted.prepMinutes} min`;


  // A deterministic failure — a mistyped address, a site that refuses us, a page
  // that builds its recipe in the browser — fails identically however many times
  // you ask. What it needs is the input back, not another attempt at it.
  const backLabel = input.usingLink ? 'Change the link' : 'Go back';
  const goBack = () => { setError(null); setExtracted(null); };

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.loadingText}>
            {input.fetching ? 'Opening the page…'
              : input.usingPhoto ? 'Reading the photo…'
              : 'Reading the recipe…'}
          </Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="alert-circle-outline"
            title="That didn’t work"
            subtitle={error}
            actionLabel={canRetry ? 'Try again' : backLabel}
            onAction={canRetry ? run : goBack}
          />
        </View>
      );
    }

    if (!extracted) {
      return (
        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.pasteWrap}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <RecipeSourcePicker
            intro={`Open a recipe link, paste a recipe, or photograph the page. Its servings and shopping list get added to ${recipe?.name ?? 'this recipe'} instead of just going on the grocery list.`}
            mode={input.mode}
            onChangeMode={input.setMode}
            text={input.text}
            onChangeText={input.setText}
            url={input.url}
            onChangeUrl={input.setUrl}
            photo={input.photo}
            onPickPhoto={input.pick}
            onClearPhoto={input.clearPhoto}
            picking={input.picking}
            ctaLabel={
              input.usingLink ? 'Get the recipe'
                : input.usingPhoto ? 'Read the photo'
                : 'Read the recipe'
            }
            onRun={run}
          />
          {!!input.photoError && <Text style={styles.photoError}>{input.photoError}</Text>}
        </ScrollView>
      );
    }

    if (ingredients.length === 0 && !hasDetails) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="Nothing found"
            subtitle={input.usingPhoto
              ? 'Nothing readable turned up in that photo. Try again in better light, or paste the text instead.'
              : input.usingLink
              ? 'No recipe turned up on that page. Copy the recipe from it and paste it instead.'
              : 'No servings or shopping items turned up in that text.'}
            actionLabel={input.usingPhoto ? 'Try another photo' : undefined}
            onAction={input.usingPhoto ? () => { setExtracted(null); input.clearPhoto(); } : undefined}
          />
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Untick anything you don't want added, or tap a name or amount to change it.
        </Text>

        {hasDetails && (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setApplyDetails(v => !v); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: applyDetails }}
            accessibilityLabel={detailsLabel}
          >
            <View style={[styles.checkbox, applyDetails && styles.checkboxOn]}>
              {applyDetails && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
            </View>
            <View style={styles.body}>
              <Text style={styles.name}>
                {extracted.servings !== null
                  ? `Serves ${formatServingsRange(extracted.servings, extracted.servingsMax)}`
                  : `About ${extracted.prepMinutes} min`}
              </Text>
              {extracted.servings !== null && extracted.prepMinutes !== null && (
                <Text style={styles.meta}>About {extracted.prepMinutes} min</Text>
              )}
            </View>
          </TouchableOpacity>
        )}

        {ingredients.map((row, i) => {
          // A new heading whenever this row's section differs from the one
          // right before it — same display-only grouping RecipeDetailScreen
          // does over the saved list, run here over the preview instead.
          const prevSection = i > 0 ? ingredients[i - 1].section : null;
          const sectionHeader = row.section && row.section !== prevSection ? row.section : null;
          return (
            <ExtractedIngredientRow
              key={`${row.name}-${i}`}
              row={row}
              checked={accepted.has(i)}
              onToggle={() => toggle(i)}
              onEditName={name => editIngredient(i, { name })}
              onEditQuantity={quantity => editIngredient(i, { quantity })}
              sectionHeader={sectionHeader}
            />
          );
        })}
      </ScrollView>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={14} color={colors.purple} />
            <Text style={styles.headerTitle}>From a recipe</Text>
          </View>
          <SheetHeaderButton
            label="Add"
            onPress={handleApply}
            disabled={!canApply}
            minWidth={72}
          />
        </View>
        {renderBody()}
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
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
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    loadingText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
    intro: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
    pasteWrap: { padding: spacing.md, gap: spacing.md },
    photoError: { color: colors.red, fontSize: font.sm, textAlign: 'center' },
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
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
  });
}
