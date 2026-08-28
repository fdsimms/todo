import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, interaction, type Colors } from '../theme';
import {
  MIN_MEAL_IDEAS, mealTitleKey, mealIdeaRecipeDraft, recentlyCookedTitles, type MealIdea,
} from '../utils/mealIdeas';
import { suggestMealIdeas, draftMealRecipe, describeAIError } from '../services/aiSuggestions';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The new recipe's id — the caller navigates. */
  onCreated: (recipeId: string) => void;
}

/**
 * The Recipes FAB's fourth way in, alongside the three imports: no source to
 * read from, just a description of what's wanted. Two steps, deliberately —
 * a bare "Invent" tap with no way to steer it would either invent something
 * nobody asked for or take another round trip to fix. Same shape as the idea
 * half of `SuggestMealsSheet` (a hint, a generate tap, a dashed-border idea
 * row), reused rather than reinvented: `suggestMealIdeas`/`draftMealRecipe`
 * are the same calls, gated behind the same `mealIdeas` AI feature toggle.
 *
 * **One tap on an idea both drafts and creates it — there is no separate
 * review step.** This sheet only ever makes one recipe per open (like "New
 * recipe" and the three imports), so there's nothing to batch and nothing
 * for a second "Save" button to mean. That matches `SuggestMealsSheet`'s own
 * idea rows, which commit the same way: a blind save that becomes a fully
 * editable recipe in the box afterward, not a preview to approve first.
 * Every recipe this creates is stamped `source: 'AI generated'` — see
 * `mealIdeaRecipeDraft`.
 */
export function InventRecipeSheet({ visible, onClose, onCreated }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const addStructuredIngredients = useRecipeStore(s => s.addStructuredIngredients);
  const setNotes = useRecipeStore(s => s.setNotes);
  const setSource = useRecipeStore(s => s.setSource);
  const addStep = useRecipeStore(s => s.addStep);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const updatePrepTask = useRecipeStore(s => s.updatePrepTask);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));

  const [hints, setHints] = useState('');
  // Ideas live only as long as the sheet does — a proposal, not data.
  const [ideas, setIdeas] = useState<MealIdea[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  /** Which idea is being drafted right now, for its row's spinner. */
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (visible) return;
    setHints('');
    setIdeas([]);
    setGenerating(false);
    setGenerateError(null);
    setCreatingKey(null);
    setCreateErrors(new Map());
  }, [visible]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const recent = recentlyCookedTitles(recipes, new Date());
      const result = await suggestMealIdeas([], recent, MIN_MEAL_IDEAS, hints, []);
      // suggestMealIdeas only dedupes against the titles it was handed
      // (recently cooked); a dish already in the box under any other name
      // isn't "new" just because it wasn't cooked lately.
      const owned = new Set(recipes.map(r => mealTitleKey(r.name)));
      setIdeas(result.filter(i => !owned.has(mealTitleKey(i.title))));
    } catch (e) {
      setIdeas([]);
      setGenerateError(describeAIError(e));
    } finally {
      setGenerating(false);
    }
  }, [recipes, hints]);

  const dismissIdea = (idea: MealIdea) => {
    haptics.tap();
    setIdeas(prev => prev.filter(i => i.id !== idea.id));
    setCreateErrors(prev => {
      if (!prev.has(idea.id)) return prev;
      const next = new Map(prev);
      next.delete(idea.id);
      return next;
    });
  };

  /**
   * Drafts an idea's shopping list and method, then saves it as a real
   * recipe and hands the sheet's caller the id to navigate to — same
   * addRecipe/addStructuredIngredients/setNotes/setSource/addStep/
   * addPrepTask sequence `SuggestMealsSheet.saveIdeaAsRecipe` uses for an
   * accepted idea there. A failure leaves the row in place with an inline
   * error, retried by tapping it again.
   */
  const createFromIdea = useCallback(async (idea: MealIdea) => {
    haptics.tap();
    setCreatingKey(idea.id);
    setCreateErrors(prev => {
      if (!prev.has(idea.id)) return prev;
      const next = new Map(prev);
      next.delete(idea.id);
      return next;
    });
    try {
      const drafted = await draftMealRecipe(idea.title, [...aisleOrder], null);
      const draft = mealIdeaRecipeDraft(idea, drafted.ingredients, drafted);
      if (!draft.name) throw new Error('IDEA_NAME_EMPTY');
      // addRecipe refuses a name already in the box (nameKey is UNIQUE); land
      // on the existing recipe rather than telling the user no.
      const recipe = addRecipe(draft.name)
        ?? recipes.find(r => r.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
        ?? null;
      if (!recipe) throw new Error('IDEA_SAVE_FAILED');
      if (draft.ingredients.length > 0) addStructuredIngredients(recipe.id, draft.ingredients);
      if (draft.notes) setNotes(recipe.id, draft.notes);
      setSource(recipe.id, draft.source);
      draft.steps.forEach(step => addStep(recipe.id, step));
      draft.prepTasks.forEach(task => {
        const added = addPrepTask(recipe.id, task.title);
        if (added && task.offsetDays !== added.offsetDays) {
          updatePrepTask(recipe.id, added.id, { offsetDays: task.offsetDays });
        }
      });
      haptics.success();
      setCreatingKey(null);
      onClose();
      onCreated(recipe.id);
    } catch (e) {
      setCreatingKey(null);
      const message = e instanceof Error && e.message === 'IDEA_NAME_EMPTY'
        ? 'That name didn’t survive. Try regenerating.'
        : e instanceof Error && e.message === 'IDEA_SAVE_FAILED'
          ? 'Couldn’t save that to your recipe box.'
          : describeAIError(e);
      setCreateErrors(prev => new Map(prev).set(idea.id, message));
    }
  }, [
    aisleOrder, addRecipe, recipes, addStructuredIngredients,
    setNotes, setSource, addStep, addPrepTask, updatePrepTask, onClose, onCreated,
  ]);

  // A typed hint and a generated batch are both real work a swipe-down would
  // otherwise drop with no dialog.
  const handleCancel = () => {
    const dirty = hints.trim() !== '' || ideas.length > 0;
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

  const renderIdeaRow = (idea: MealIdea) => {
    const isCreating = creatingKey === idea.id;
    const error = createErrors.get(idea.id) ?? null;
    const disabled = creatingKey !== null;
    return (
      <TouchableOpacity
        key={idea.id}
        style={[styles.row, styles.ideaRow]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => createFromIdea(idea)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Add ${idea.title} to your recipe box. ${idea.blurb}`}
      >
        <View style={styles.body}>
          <View style={styles.ideaTitleRow}>
            <Ionicons name="sparkles" size={iconSize.xs} color={colors.purple} />
            <Text style={styles.name} numberOfLines={1}>{idea.title}</Text>
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {idea.blurb || 'A new idea, invented from scratch.'}
          </Text>
          {!!error && <Text style={styles.ideaError}>{error}</Text>}
        </View>
        {isCreating ? (
          <ActivityIndicator color={colors.purple} />
        ) : (
          <View style={styles.ideaActions}>
            <TouchableOpacity
              onPress={() => dismissIdea(idea)}
              activeOpacity={interaction.activeOpacity}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${idea.title}`}
              hitSlop={8}
            >
              <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
            <Ionicons
              name="add-circle-outline"
              size={iconSize.md}
              color={disabled ? colors.textTertiary : colors.purple}
            />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={72} />
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={14} color={colors.purple} />
            <Text style={styles.headerTitle}>Invent a recipe</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {ideas.length === 0 && !generateError && (
            <Text style={styles.intro}>
              Describe what you're after and Claude will invent a few dishes. Tap one to add it
              to your recipe box, fully stocked with ingredients and a method.
            </Text>
          )}

          {!generating && (
            <TextInput
              style={styles.hintInput}
              value={hints}
              onChangeText={setHints}
              placeholder="e.g. quick, vegetarian, use up spinach"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={() => { if (!generating) generate(); }}
              accessibilityLabel="What kind of recipe to invent"
            />
          )}

          {generating ? (
            <View style={styles.generating}>
              <ActivityIndicator color={colors.purple} />
              <Text style={styles.generatingText}>Thinking up recipes…</Text>
            </View>
          ) : generateError ? (
            <View style={styles.generateError}>
              <Text style={styles.generateErrorText}>{generateError}</Text>
              <InlineAction
                label="Try again"
                icon="refresh"
                variant="neutral"
                surface="page"
                onPress={() => { haptics.tap(); generate(); }}
                accessibilityLabel="Try generating recipe ideas again"
              />
            </View>
          ) : (
            <View style={styles.ideaCta}>
              <InlineAction
                label={ideas.length > 0 ? 'More ideas' : 'Invent recipes'}
                icon={ideas.length > 0 ? 'refresh' : 'sparkles-outline'}
                tint={colors.purple}
                onPress={() => { haptics.tap(); generate(); }}
                accessibilityLabel={ideas.length > 0
                  ? 'Generate more recipe ideas'
                  : 'Invent recipe ideas with Claude'}
              />
            </View>
          )}

          {ideas.map(renderIdeaRow)}
        </ScrollView>
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
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  // Balances the Cancel button's own minWidth so the title stays centered.
  headerSpacer: { width: 72 },
  list: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  intro: { color: colors.textTertiary, fontSize: font.sm, lineHeight: lineHeight.sm, paddingBottom: spacing.xs },
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  // Same dashed-purple "provisional" treatment SuggestMealsSheet's idea rows
  // use, so an invented dish reads the same way on either surface.
  ideaRow: {
    borderWidth: border.sm,
    borderStyle: 'dashed',
    borderColor: `${colors.purple}66`,
  },
  body: { flex: 1, gap: 2 },
  ideaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  meta: { fontSize: font.xs, color: colors.textTertiary, lineHeight: lineHeight.xs },
  ideaActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ideaError: { fontSize: font.xs, color: colors.red, marginTop: spacing.xs },
});
