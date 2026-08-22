import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  normalizeIngredient, formatServingsRange, recipeHasMethod, recipeHasPrepTasks, recipeHasAttribution,
} from '../utils/recipeUtils';
import { aisleForName } from '../utils/groceryAisles';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { ExtractedIngredientRow, type ExtractedIngredientRowHandle } from './ExtractedIngredientRow';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { useRecipeComponentImports } from '../hooks/useRecipeComponentImports';
import { ImportedComponentRow } from './ImportedComponentRow';
import { coveredIngredients, importableReferences } from '../utils/recipeImportComponents';
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
 *
 * **The method, prep tasks, and attribution are the deliberate exception to
 * "never touches the recipe's name or notes" above**, and they're offered as
 * their own tick-to-apply rows for it: off by default whenever the recipe
 * already has one of its own, appending rather than replacing even then. A
 * link import's steps and site are the page's own structured data, taken
 * verbatim (see `parseRecipeJsonLd`) — the same provenance as the ingredients
 * this sheet has always applied, and why they were the original exception. The
 * method (from a paste or a photo) and prep tasks (from any source) are a
 * *model's* guess instead, same as the ingredient list already is — reviewed
 * the same way, by the row's tick and its count, rather than left un-offered.
 * A link's own steps are still preferred over the model's read of the same
 * page when both exist.
 */
export function RecipeExtractSheet({ visible, recipe, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // One ref per visible row, so handleApply can flush whichever one is
  // mid-edit — see ExtractedIngredientRowHandle.resolvePendingEdit.
  const rowRefs = useRef(new Map<number, ExtractedIngredientRowHandle | null>());

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const setServings = useRecipeStore(s => s.setServings);
  const setEstimatedMinutes = useRecipeStore(s => s.setEstimatedMinutes);
  const setSourceUrl = useRecipeStore(s => s.setSourceUrl);
  const setSource = useRecipeStore(s => s.setSource);
  const setAuthor = useRecipeStore(s => s.setAuthor);
  const setSourceType = useRecipeStore(s => s.setSourceType);
  const addStep = useRecipeStore(s => s.addStep);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const updatePrepTask = useRecipeStore(s => s.updatePrepTask);
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
  // Both default to *off* whenever the recipe already has the thing they'd
  // write — see the defaults set in `run`. This sheet's standing rule is that
  // it doesn't overwrite what the user already put here, and a tick is how
  // they say otherwise.
  const [applyMethod, setApplyMethod] = useState(false);
  const [applyPrepTasks, setApplyPrepTasks] = useState(false);
  const [applySource, setApplySource] = useState(false);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  const input = useRecipeImportSource();
  const { resolveSource, reset: resetInput } = input;

  // "…and there's a salsa verde on page 45." Filtered against this recipe, so a
  // component it already has isn't offered twice — see importableReferences.
  const candidates = useMemo(
    () => (extracted ? importableReferences(extracted.references, recipes, recipe) : []),
    [extracted, recipes, recipe],
  );
  const components = useRecipeComponentImports(candidates, aisleOrder);
  const { reset: resetComponents, acceptedKeys } = components;
  // An ingredient line naming a recipe that's about to become a component is
  // already shopped for through that component — see coveredIngredients.
  const covered = useMemo(
    () => coveredIngredients(ingredients, candidates, acceptedKeys),
    [ingredients, candidates, acceptedKeys],
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setExtracted(null);
    setIngredients([]);
    setAccepted(new Set());
    setApplyDetails(true);
    setApplyMethod(false);
    setApplyPrepTasks(false);
    setApplySource(false);
    resetInput();
    resetComponents();
  }, [resetInput, resetComponents]);

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
      // A method is offered whichever source it came from — the page's own
      // steps when it publishes them, otherwise the model's read of the same
      // source. Attribution stays link-only, since nothing else names where a
      // recipe came from. All three are offered *ticked* only when there's
      // nothing of the user's own to land on top of.
      const page = resolved.page;
      const methodStepsFound = (page?.steps.length ?? 0) > 0 ? page!.steps : result.steps;
      setApplyMethod(methodStepsFound.length > 0 && !recipeHasMethod(recipe));
      setApplyPrepTasks(result.prepTasks.length > 0 && !recipeHasPrepTasks(recipe));
      setApplySource(!!page && !recipeHasAttribution(recipe));
    } catch (e) {
      setError(describeImportError(e));
      setCanRetry(isRetryableImportError(e));
    } finally {
      setLoading(false);
    }
  }, [resolveSource, aisleOrder, recipe]);

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
    // Tapping Apply can beat a row's own blur — merge in whatever's still
    // mid-edit instead of trusting `ingredients` state a pending edit
    // hasn't reached yet (same race TaskEditor's resolveX functions guard
    // against). Read directly rather than going through onEditName/
    // onEditQuantity, which write via setState and wouldn't land in time
    // for this same synchronous read.
    const resolvedIngredients = ingredients.map((row, i) => {
      const pending = rowRefs.current.get(i)?.resolvePendingEdit();
      if (!pending) return row;
      const next = { ...row, [pending.field]: pending.value };
      if (pending.field === 'name') {
        next.aisle = rememberedAisleFor(pending.value) ?? aisleForName(pending.value) ?? 'Other';
      }
      return next;
    });
    const chosen = resolvedIngredients
      .filter((_, i) => accepted.has(i) && !covered.has(i))
      .map(item => normalizeIngredient(item))
      .filter((i): i is NonNullable<typeof i> => i !== null);
    if (chosen.length > 0) addStructuredIngredients(recipe.id, chosen);
    components.commitTo(recipe.id);
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
    // Appended, never replacing what's there. A recipe with its own method or
    // prep tasks arrives here unticked, so reaching this line at all means the
    // user asked for these on top of it — and appending is the only version
    // of that they can undo by hand.
    if (applyMethod) methodSteps.forEach(step => addStep(recipe.id, step));
    if (applyPrepTasks) {
      extractedPrepTasks.forEach(task => {
        const added = addPrepTask(recipe.id, task.title);
        if (added && task.offsetDays !== added.offsetDays) {
          updatePrepTask(recipe.id, added.id, { offsetDays: task.offsetDays });
        }
      });
    }
    const page = input.page;
    if (page && applySource) {
      setSourceUrl(recipe.id, page.url);
      setSourceType(recipe.id, 'website');
      if (page.siteName) setSource(recipe.id, page.siteName);
      if (page.author) setAuthor(recipe.id, page.author);
    }
    haptics.success();
    onClose();
  };

  const hasDetails = !!extracted && (extracted.servings !== null || extracted.prepMinutes !== null);
  // The page's own steps (verbatim structured data) when it has them,
  // otherwise whatever the model read off the source itself.
  const methodSteps = (input.page?.steps.length ?? 0) > 0 ? input.page!.steps : (extracted?.steps ?? []);
  // Always the model's read — no page ever publishes these as structured data.
  const extractedPrepTasks = extracted?.prepTasks ?? [];
  const canApply = !loading && !!extracted && (
    accepted.size > 0
    || (applyDetails && hasDetails)
    || (applyMethod && methodSteps.length > 0)
    || (applyPrepTasks && extractedPrepTasks.length > 0)
    || (applySource && !!input.page)
    // A run that found nothing but a "see page 45" is still worth an Add: the
    // link is the whole result.
    || acceptedKeys.size > 0
  );

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

  // Says what will happen rather than only what was found: the method row is
  // the one place a recipe can end up with two methods, so the row that does
  // it is where that has to be readable.
  const methodMeta = `${methodSteps.length} step${methodSteps.length === 1 ? '' : 's'}${
    recipeHasMethod(recipe) ? ', added after the method it already has' : ''}`;

  const prepTasksMeta = `${extractedPrepTasks.length} task${extractedPrepTasks.length === 1 ? '' : 's'}${
    recipeHasPrepTasks(recipe) ? ', added after what it already has' : ''}`;

  const sourceMeta = [
    [input.page?.siteName, input.page?.author].filter(Boolean).join(' · ') || input.page?.url,
    recipeHasAttribution(recipe) ? 'replaces what’s there' : null,
  ].filter(Boolean).join(' — ');

  /**
   * The referenced-recipes block, above the ingredients it changes the meaning
   * of. Above rather than below because accepting one unticks a line further
   * down: the cause has to be on screen before the effect, or the ingredient
   * list appears to edit itself.
   */
  const renderReferences = () => {
    if (candidates.length === 0) return null;
    return (
      <>
        <Text style={styles.groupLabel}>OTHER RECIPES THIS ONE USES</Text>
        <Text style={styles.groupHint}>
          Link the ones you already have, or photograph the page for the ones you don't.
        </Text>
        {/* Its own bottom margin: the ingredient rows below have none of their
            own, and a 2pt gap would read as one continuous list. */}
        <View style={styles.groupBlock}>
          {candidates.map(candidate => (
            <ImportedComponentRow
              key={candidate.key}
              candidate={candidate}
              state={components.stateFor(candidate.key)}
              accepted={components.accepted.has(candidate.key)}
              onToggle={() => components.toggle(candidate.key)}
              onImport={source => components.importFrom(candidate.key, source)}
            />
          ))}
        </View>
      </>
    );
  };

  /** The tick-to-apply row this list is built from — three of them now. */
  const renderToggle = ({ checked, onToggle, title, meta, label }: {
    checked: boolean;
    onToggle: () => void;
    title: string;
    meta: string | null;
    label: string;
  }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={() => { haptics.tap(); onToggle(); }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{title}</Text>
        {!!meta && <Text style={styles.meta}>{meta}</Text>}
      </View>
    </TouchableOpacity>
  );

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

    if (
      ingredients.length === 0 && !hasDetails
      && methodSteps.length === 0 && extractedPrepTasks.length === 0
      && candidates.length === 0
    ) {
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

        {hasDetails && renderToggle({
          checked: applyDetails,
          onToggle: () => setApplyDetails(v => !v),
          title: extracted.servings !== null
            ? `Serves ${formatServingsRange(extracted.servings, extracted.servingsMax)}`
            : `About ${extracted.prepMinutes} min`,
          meta: extracted.servings !== null && extracted.prepMinutes !== null
            ? `About ${extracted.prepMinutes} min`
            : null,
          label: detailsLabel,
        })}

        {methodSteps.length > 0 && renderToggle({
          checked: applyMethod,
          onToggle: () => setApplyMethod(v => !v),
          title: 'Method',
          meta: methodMeta,
          label: `Method, ${methodMeta}`,
        })}

        {extractedPrepTasks.length > 0 && renderToggle({
          checked: applyPrepTasks,
          onToggle: () => setApplyPrepTasks(v => !v),
          title: 'Prep tasks',
          meta: prepTasksMeta,
          label: `Prep tasks, ${prepTasksMeta}`,
        })}

        {!!input.page && renderToggle({
          checked: applySource,
          onToggle: () => setApplySource(v => !v),
          title: 'Where it’s from',
          meta: sourceMeta,
          label: `Where it’s from, ${sourceMeta}`,
        })}

        {renderReferences()}

        {ingredients.map((row, i) => {
          // A new heading whenever this row's section differs from the one
          // right before it — same display-only grouping RecipeDetailScreen
          // does over the saved list, run here over the preview instead.
          const prevSection = i > 0 ? ingredients[i - 1].section : null;
          const sectionHeader = row.section && row.section !== prevSection ? row.section : null;
          const coveredBy = covered.get(i);
          return (
            <ExtractedIngredientRow
              key={`${row.name}-${i}`}
              ref={el => { if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i); }}
              row={row}
              checked={accepted.has(i) && !coveredBy}
              onToggle={() => toggle(i)}
              onEditName={name => editIngredient(i, { name })}
              onEditQuantity={quantity => editIngredient(i, { quantity })}
              sectionHeader={sectionHeader}
              note={coveredBy ? `made from the ${coveredBy} recipe` : null}
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
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    groupHint: {
      color: colors.textTertiary,
      fontSize: font.xs,
      paddingHorizontal: spacing.md,
      paddingTop: 2,
      paddingBottom: spacing.xs,
    },
    groupBlock: { marginBottom: spacing.sm },
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
