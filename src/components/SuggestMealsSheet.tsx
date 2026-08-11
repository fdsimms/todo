import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, interaction, type Colors } from '../theme';
import { dayKeyOf } from '../utils/dateUtils';
import { describeCookHistory, describePantryCoverage, describeRecipe, type PantryCoverage } from '../utils/recipeUtils';
import {
  mergeMealSuggestions, mealIdeaRecipeDraft, mealTitleKey,
  type MealIdea, type MealSuggestion,
} from '../utils/mealIdeas';
import { suggestMealIdeas, suggestMealIngredients, describeAIError } from '../services/aiSuggestions';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** Already ranked by suggestRecipesForEmptyNight — this sheet doesn't re-sort. */
  recipes: Recipe[];
  /**
   * The visible half of #1103's pantry signal — a recipe missing from this
   * map (rather than present with `total: 0`) just renders with no badge, so
   * a caller that hasn't computed it yet degrades to the pre-#1103 row.
   */
  pantryByRecipeId?: ReadonlyMap<string, PantryCoverage>;
  weekDays: Date[];
  /**
   * #1063's gate, decided by the caller: `!!anthropicApiKey`. False (the
   * default) and this sheet is exactly the offline one it was before — no
   * generate affordance, no network call, no mention of AI anywhere.
   */
  aiIdeasEnabled?: boolean;
  /** Meals already on the week, so the model isn't asked to invent one of them again. */
  plannedTitles?: readonly string[];
  /** What's been cooked lately (see recentlyCookedTitles) — same "don't suggest that again" job. */
  recentTitles?: readonly string[];
  /** Empty dinners to fill; clamped into the MIN/MAX idea band by clampIdeaCount. */
  slotsToFill?: number;
  onPlan: (recipe: Recipe, dateKey: string) => void;
  onClose: () => void;
}

/**
 * "What can I make from what I've got" for an empty week — offline, ranked by
 * scoreRecipeAgainstCatalog (catalog coverage, nudged by how recently the
 * recipe itself was last cooked — #1103), no API key involved.
 *
 * Since #1063 it has a second, optional half: **AI-invented** meal ideas, for
 * when the offline ranking has little or nothing to offer. The two never mix
 * and never compete —
 *
 * - The ranked recipes are computed and rendered exactly as before, whether or
 *   not a key is configured. `mergeMealSuggestions` puts every one of them
 *   ahead of every idea and drops an idea whose name collides with one, so an
 *   invention can't displace, reorder or hide a recipe the user actually owns.
 *   That's the settled call from #1041, restated in #1063.
 * - Generation is behind `aiIdeasEnabled` (`!!anthropicApiKey` at the call
 *   site) *and* behind an explicit tap. Opening this sheet never spends a
 *   request; the offline list is what it opens with.
 * - An idea is visibly not a recipe: dashed border, a sparkles glyph, an "AI
 *   idea" tag and no pantry/cook-history signals, because it has none. The
 *   user has to be able to tell which is which before accepting.
 *
 * Accepting a *recipe* doesn't open a day picker — it lands on the next
 * still-empty dinner slot in week order and the row shows where it went, so
 * working down the list fills the week without a decision per recipe.
 * Accepting an *idea* does the same, after a second call that drafts its
 * shopping list and saves it as a real `Recipe` (`addRecipe` +
 * `addStructuredIngredients`) — so the meal enters the recipe box and is
 * rankable, cookable and shoppable from then on, rather than being a
 * one-off free-text entry that has to be invented again next month.
 */
export function SuggestMealsSheet({
  visible, recipes, pantryByRecipeId, weekDays,
  aiIdeasEnabled = false, plannedTitles, recentTitles, slotsToFill,
  onPlan, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const allRecipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const addStructuredIngredients = useRecipeStore(s => s.addStructuredIngredients);

  const [plannedCount, setPlannedCount] = useState(0);
  const [landedOn, setLandedOn] = useState<Map<string, Date>>(new Map());

  // Ideas live only as long as the sheet does: they're a proposal, not data.
  const [ideas, setIdeas] = useState<MealIdea[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [hints, setHints] = useState('');
  /** The idea whose ingredients are being drafted — one at a time, by design. */
  const [savingIdeaId, setSavingIdeaId] = useState<string | null>(null);
  const [ideaError, setIdeaError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (visible) return;
    setPlannedCount(0);
    setLandedOn(new Map());
    setIdeas([]);
    setGenerating(false);
    setGenerateError(null);
    setHints('');
    setSavingIdeaId(null);
    setIdeaError(null);
  }, [visible]);

  /** The next still-empty dinner of the week, in week order. */
  const nextDay = () => weekDays[plannedCount % weekDays.length];

  const markPlanned = (key: string, day: Date) => {
    setLandedOn(prev => new Map(prev).set(key, day));
    setPlannedCount(c => c + 1);
  };

  const acceptRecipe = (recipe: Recipe) => {
    if (landedOn.has(recipe.id) || weekDays.length === 0) return;
    const day = nextDay();
    haptics.success();
    onPlan(recipe, dayKeyOf(day));
    markPlanned(recipe.id, day);
  };

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    setIdeaError(null);
    try {
      const result = await suggestMealIdeas(
        [...(plannedTitles ?? [])],
        [...(recentTitles ?? [])],
        slotsToFill ?? weekDays.length,
        hints,
      );
      // The service dedupes against the context it was given; the recipe box
      // is the other half of "new". A dish the user already owns isn't an
      // idea — if it fits this week the offline ranking above should be the
      // one offering it, with its real ingredients behind it.
      const owned = new Set(allRecipes.map(r => mealTitleKey(r.name)));
      setIdeas(result.filter(i => !owned.has(mealTitleKey(i.title))));
    } catch (e) {
      setIdeas([]);
      setGenerateError(describeAIError(e));
    } finally {
      setGenerating(false);
    }
  }, [plannedTitles, recentTitles, allRecipes, slotsToFill, weekDays.length, hints]);

  const dismissIdea = (idea: MealIdea) => {
    haptics.tap();
    setIdeas(prev => prev.filter(i => i.id !== idea.id));
    setIdeaError(prev => (prev?.id === idea.id ? null : prev));
  };

  /**
   * Accepting an invention: draft its shopping list, save it as a real
   * recipe, then plan it. Recipe first, plan second — a failed plan leaves a
   * recipe the user can still use, whereas planning a recipe that was never
   * saved would leave an entry pointing at nothing.
   */
  const acceptIdea = async (idea: MealIdea) => {
    if (savingIdeaId || landedOn.has(idea.id) || weekDays.length === 0) return;
    setSavingIdeaId(idea.id);
    setIdeaError(null);
    try {
      const items = await suggestMealIngredients(idea.title, [...aisleOrder], null);
      const draft = mealIdeaRecipeDraft(idea, items);
      if (!draft.name) {
        setIdeaError({ id: idea.id, message: 'That name didn’t survive — try regenerating.' });
        return;
      }
      // addRecipe refuses a name already in the box (nameKey is UNIQUE); land
      // on the existing recipe rather than telling the user no.
      const recipe = addRecipe(draft.name)
        ?? allRecipes.find(r => r.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
        ?? null;
      if (!recipe) {
        setIdeaError({ id: idea.id, message: 'Couldn’t save that to your recipe box.' });
        return;
      }
      if (draft.ingredients.length > 0) addStructuredIngredients(recipe.id, draft.ingredients);
      const day = nextDay();
      haptics.success();
      onPlan(recipe, dayKeyOf(day));
      markPlanned(idea.id, day);
    } catch (e) {
      setIdeaError({ id: idea.id, message: describeAIError(e) });
    } finally {
      setSavingIdeaId(null);
    }
  };

  const suggestions = useMemo(
    () => mergeMealSuggestions(recipes, ideas),
    [recipes, ideas],
  );

  const renderRecipeRow = (recipe: Recipe) => {
    const landedDay = landedOn.get(recipe.id);
    const coverage = pantryByRecipeId?.get(recipe.id);
    const pantryLabel = coverage ? describePantryCoverage(coverage) : null;
    const pantryKnown = !!coverage && coverage.catalogMatches > 0;
    const cookHistory = describeCookHistory(recipe);
    const signalsLabel = [cookHistory, pantryLabel].filter(Boolean).join('. ');
    return (
      <TouchableOpacity
        style={[styles.row, !!landedDay && styles.rowDone]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => acceptRecipe(recipe)}
        disabled={!!landedDay}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!landedDay }}
        accessibilityLabel={landedDay
          ? `${recipe.name}, planned for ${format(landedDay, 'EEEE')}`
          : `Plan ${recipe.name}. ${describeRecipe(recipe)}${signalsLabel ? `. ${signalsLabel}` : ''}`}
      >
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{recipe.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {landedDay ? `Planned for ${format(landedDay, 'EEEE')}` : describeRecipe(recipe)}
          </Text>
          {!landedDay && (pantryLabel || cookHistory) && (
            <View style={styles.signalRow}>
              {pantryLabel && (
                <View style={[styles.pantryBadge, pantryKnown ? styles.pantryBadgeKnown : styles.pantryBadgeUnknown]}>
                  <Text
                    style={[styles.pantryBadgeText, pantryKnown ? styles.pantryBadgeTextKnown : styles.pantryBadgeTextUnknown]}
                    numberOfLines={1}
                  >
                    {pantryLabel}
                  </Text>
                </View>
              )}
              {cookHistory ? (
                <Text style={styles.cookHistory} numberOfLines={1}>{cookHistory}</Text>
              ) : null}
            </View>
          )}
        </View>
        <Ionicons
          name={landedDay ? 'checkmark-circle' : 'add-circle-outline'}
          size={iconSize.md}
          color={landedDay ? colors.green : colors.accent}
        />
      </TouchableOpacity>
    );
  };

  const renderIdeaRow = (idea: MealIdea) => {
    const landedDay = landedOn.get(idea.id);
    const saving = savingIdeaId === idea.id;
    const error = ideaError?.id === idea.id ? ideaError.message : null;
    return (
      <View style={[styles.row, styles.ideaRow, !!landedDay && styles.rowDone]}>
        <View style={styles.body}>
          <View style={styles.ideaTitleRow}>
            <Ionicons name="sparkles" size={iconSize.xs} color={colors.purple} />
            <Text style={styles.name} numberOfLines={1}>{idea.title}</Text>
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {landedDay
              ? `Planned for ${format(landedDay, 'EEEE')} · saved to your recipe box`
              : (idea.blurb || 'A new idea — accepting it adds it to your recipe box.')}
          </Text>
          {!landedDay && (
            <View style={styles.signalRow}>
              <View style={styles.ideaTag}>
                <Text style={styles.ideaTagText}>AI idea · no recipe yet</Text>
              </View>
            </View>
          )}
          {!!error && <Text style={styles.ideaError}>{error}</Text>}
        </View>
        {landedDay ? (
          <Ionicons name="checkmark-circle" size={iconSize.md} color={colors.green} />
        ) : saving ? (
          <ActivityIndicator color={colors.purple} />
        ) : (
          <View style={styles.ideaActions}>
            <TouchableOpacity
              onPress={() => dismissIdea(idea)}
              activeOpacity={interaction.activeOpacity}
              disabled={!!savingIdeaId}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${idea.title}`}
              hitSlop={8}
            >
              <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => acceptIdea(idea)}
              activeOpacity={interaction.activeOpacity}
              disabled={!!savingIdeaId}
              accessibilityRole="button"
              accessibilityLabel={`Plan ${idea.title} and add it to your recipe box`}
              hitSlop={8}
            >
              <Ionicons name="add-circle-outline" size={iconSize.md} color={colors.purple} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // The generation half of the sheet: the ask, the wait, the failure, and the
  // regenerate — all of it below the offline list, and none of it rendered at
  // all without a key.
  const renderIdeaSection = () => {
    if (!aiIdeasEnabled) return null;
    return (
      <View style={styles.ideaSection}>
        <Text style={styles.sectionHeader}>NEW IDEAS</Text>
        {/* Stays up while the request is in flight — with no offline matches
            this section is the whole screen, and a spinner alone in it says
            nothing about what's being waited for. */}
        {ideas.length === 0 && !generateError && (
          <Text style={styles.sectionHint}>
            {recipes.length === 0
              ? 'Nothing in your recipe box fits this week — Claude can invent a few meals instead. Accepting one saves it as a real recipe.'
              : 'Want something you haven’t made before? Claude can invent a few. Accepting one saves it as a real recipe.'}
          </Text>
        )}

        {!generating && (
          <TextInput
            style={styles.hintInput}
            value={hints}
            onChangeText={setHints}
            placeholder="Anything in mind? e.g. quick, vegetarian"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={() => { if (!generating) generate(); }}
            accessibilityLabel="What kind of meals to suggest"
          />
        )}

        {generating ? (
          <View style={styles.generating}>
            <ActivityIndicator color={colors.purple} />
            <Text style={styles.generatingText}>Thinking up meals…</Text>
          </View>
        ) : generateError ? (
          <View style={styles.generateError}>
            <Text style={styles.generateErrorText}>{generateError}</Text>
            <InlineAction
              label="Try again"
              icon="refresh"
              variant="neutral"
              onPress={() => { haptics.tap(); generate(); }}
              accessibilityLabel="Try generating meal ideas again"
            />
          </View>
        ) : (
          <View style={styles.ideaCta}>
            <InlineAction
              label={ideas.length > 0 ? 'More ideas' : 'Invent meals'}
              icon={ideas.length > 0 ? 'refresh' : 'sparkles-outline'}
              tint={colors.purple}
              onPress={() => { haptics.tap(); generate(); }}
              accessibilityLabel={ideas.length > 0
                ? 'Generate more meal ideas'
                : 'Invent new meal ideas with Claude'}
            />
          </View>
        )}
      </View>
    );
  };

  const nothingAtAll = recipes.length === 0 && ideas.length === 0 && !aiIdeasEnabled;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Suggest meals</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={72} />
        </View>

        {nothingAtAll ? (
          <View style={styles.centered}>
            <EmptyState
              icon="restaurant-outline"
              title="Nothing to suggest"
              subtitle="None of your recipes share enough with what's in your grocery catalog yet."
            />
          </View>
        ) : (
          <ScrollView
            ref={keyboardScroll.ref}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
          >
            {recipes.length > 0 && (
              <Text style={styles.intro}>
                Made from what's already in your grocery catalog — tap one to plan it.
              </Text>
            )}
            {suggestions.map((item: MealSuggestion) => (
              <React.Fragment key={item.key}>
                {item.kind === 'recipe' ? renderRecipeRow(item.recipe) : renderIdeaRow(item.idea)}
              </React.Fragment>
            ))}
            {renderIdeaSection()}
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
  meta: { fontSize: font.xs, color: colors.textTertiary, lineHeight: lineHeight.xs },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  pantryBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  // Green tint once there's real purchase history behind the number — the
  // same "known and good news" treatment probablyHave gets everywhere else
  // in the grocery flow. Neutral (no color claim) when there's nothing to
  // judge from yet, so an untracked recipe doesn't read as "0% on hand".
  pantryBadgeKnown: { backgroundColor: `${colors.green}26` },
  pantryBadgeUnknown: { backgroundColor: colors.bgTertiary },
  pantryBadgeText: { fontSize: font.xs, fontWeight: fontWeight.medium },
  pantryBadgeTextKnown: { color: colors.green },
  pantryBadgeTextUnknown: { color: colors.textTertiary },
  cookHistory: { fontSize: font.xs, color: colors.textTertiary, flexShrink: 1 },

  // An idea is deliberately a *different object* from a recipe row, not a
  // recipe row with a badge: a dashed purple edge on the same card, which
  // reads as "provisional" at a glance and can't be mistaken for one of the
  // user's own recipes while scrolling past.
  ideaRow: {
    borderWidth: border.sm,
    borderStyle: 'dashed',
    borderColor: `${colors.purple}66`,
  },
  ideaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ideaTag: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: `${colors.purple}26`,
  },
  ideaTagText: { fontSize: font.xs, fontWeight: fontWeight.medium, color: colors.purple },
  ideaActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ideaError: { fontSize: font.xs, color: colors.red, marginTop: spacing.xs },

  ideaSection: { marginTop: spacing.lg, paddingHorizontal: spacing.md, gap: spacing.sm },
  sectionHeader: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textTertiary,
    letterSpacing: 0.8,
  },
  sectionHint: { fontSize: font.sm, color: colors.textTertiary, lineHeight: lineHeight.sm },
  // No lineHeight on a TextInput — see CLAUDE.md; minHeight is what keeps the
  // box from resizing.
  hintInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    color: colors.text,
    fontSize: font.md,
  },
  ideaCta: { alignItems: 'flex-start' },
  generating: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  generatingText: { fontSize: font.sm, color: colors.textSecondary },
  generateError: { gap: spacing.sm, alignItems: 'flex-start' },
  generateErrorText: { fontSize: font.sm, color: colors.red, lineHeight: lineHeight.sm },
});
