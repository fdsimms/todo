import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  interaction,
  type Colors,
} from '../theme';
import { RECIPE_NAME_MAX_LENGTH, RECIPE_SOURCE_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  extractRecipe, type ExtractedRecipe, type RecipeGroceryItem, type ExtractedPrepTask,
} from '../services/aiSuggestions';
import { describeImportError, isRetryableImportError } from '../services/recipePage';
import {
  normalizeIngredient, cleanRecipeName, formatServingsRange, parseServingsRange,
} from '../utils/recipeUtils';
import { groceryNameKey } from '../utils/groceryParse';
import { aisleForName } from '../utils/groceryAisles';
import { sectionsOf } from '../utils/recipeSections';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker, type RecipeInputMode } from './RecipeSourcePicker';
import { ExtractedIngredientRow } from './ExtractedIngredientRow';
import { ImportApplyRow } from './ImportApplyRow';
import {
  methodRowMeta, prepTasksRowMeta, methodPreviewLines, prepTaskPreviewLines,
} from '../utils/recipeImportPreview';
import { InlineEditableText } from './InlineEditableText';
import { usePendingEdits } from '../hooks/usePendingEdits';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { useRecipeComponentImports } from '../hooks/useRecipeComponentImports';
import { ImportedComponentRow } from './ImportedComponentRow';
import { coveredIngredients, importableReferences } from '../utils/recipeImportComponents';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** Which tab to open on — the add menu's item decides, see RecipesScreen. */
  initialMode?: RecipeInputMode;
  /**
   * A link to open with already in the field, for an import the user didn't
   * type: a page saved from another app's share sheet (see
   * `useSharedRecipeLinks`). Only meaningful alongside `initialMode="link"`.
   * The run still waits for a tap — this fills the box, it doesn't press Import.
   */
  initialUrl?: string | null;
  onClose: () => void;
  /**
   * Handed the new (or matched existing) recipe id; the caller navigates.
   *
   * `sourceUrl` is the page it was read off, when it was read off one, so a
   * caller holding a queue of pages to import can tell *which* it just
   * finished — the sheet's tabs mean the link it opened with isn't necessarily
   * the source the recipe ended up with.
   */
  onCreated: (recipeId: string, sourceUrl: string | null) => void;
}

/**
 * Builds a whole new recipe out of a photo or a paste — the Recipes screen's
 * import entry, as opposed to `RecipeExtractSheet` which fills in a recipe that
 * already exists.
 *
 * Deliberately a separate component rather than a `recipe === null` mode on that
 * one: `RecipeExtractSheet` is documented as never touching a recipe's name, and
 * producing a name is this sheet's entire job. What they genuinely share —
 * `RecipeSourcePicker` and the extraction itself — is shared; the review list is
 * a few lines and having its own copy is cheaper than a two-personality sheet.
 *
 * The name is editable before commit because it becomes an identity here
 * (`nameKey` is UNIQUE), so a model's guess must be correctable — and having the
 * field on screen is what makes the already-have-this case cheap: the duplicate
 * check runs as you type and offers to open the recipe you meant.
 *
 * **A link import still gets more for free than a paste or a photo can**, and
 * that's the page's doing rather than a policy: a page that publishes
 * `schema.org/Recipe` hands over its method and its attribution as structured
 * data, written straight to `Recipe.steps` and `source`/`sourceUrl` rather than
 * re-derived by the model. But all three sources now come back with a method
 * and any prep tasks — `extractRecipe` reads them off a paste or a photo the
 * same way it reads the ingredients, and off a link's own page text as a
 * fallback for whichever a site doesn't publish as structured data. The page's
 * own steps are preferred when both exist; only attribution stays link-only,
 * since nothing else names where a recipe came from.
 *
 * **The method and the prep tasks are reviewable rows, not a footnote** (#1618).
 * They used to be written to the new recipe unconditionally, announced only by
 * a sentence in the intro saying how many of each had been found — so the one
 * part of an import you couldn't check before committing to it was the part
 * with the most words in it, and prep tasks additionally schedule themselves
 * days ahead of the meal. Both now sit in the list as `ImportApplyRow`s that
 * unfold what they'd add, ticked by default because a new recipe has nothing
 * of the user's own for them to land on top of.
 */
export function RecipeCreateSheet({
  visible, initialMode = 'photo', initialUrl = null, onClose, onCreated,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const setServings = useRecipeStore(s => s.setServings);
  const setRecipeYield = useRecipeStore(s => s.setRecipeYield);
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
  // A working copy of extracted.ingredients, edited in place before Create
  // (#1608) — extracted itself is left untouched, since its .name/.servings
  // fields are still read straight off it below.
  const [ingredients, setIngredients] = useState<RecipeGroceryItem[]>([]);
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [applyDetails, setApplyDetails] = useState(true);
  // Both default *on*, unlike `RecipeExtractSheet`'s: the recipe is being
  // created here, so there is nothing of the user's own for these to land on
  // top of and nothing a tick could overwrite. The checkbox exists so a method
  // the model read badly can be declined, not to protect existing content.
  const [applyMethod, setApplyMethod] = useState(true);
  const [applyPrepTasks, setApplyPrepTasks] = useState(true);
  // Same "nothing to overwrite" reasoning as applyMethod/applyPrepTasks above —
  // the recipe doesn't exist yet, so there's nothing of the user's own for this
  // to land on top of.
  const [applySource, setApplySource] = useState(true);
  // Working copies of everything the review list can correct, on the same
  // terms `ingredients` above has been on since #1608: `extracted` is what the
  // model said and is never written back to, these are what gets created.
  const [steps, setSteps] = useState<string[]>([]);
  const [acceptedSteps, setAcceptedSteps] = useState<Set<number>>(new Set());
  const [prepTasks, setPrepTasks] = useState<ExtractedPrepTask[]>([]);
  const [acceptedPrepTasks, setAcceptedPrepTasks] = useState<Set<number>>(new Set());
  const [servingsText, setServingsText] = useState('');
  const [minutesText, setMinutesText] = useState('');
  const [yieldText, setYieldText] = useState('');
  const [siteName, setSiteName] = useState('');
  const [sourceAuthor, setSourceAuthor] = useState('');
  const edits = usePendingEdits();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  // Whichever add-menu item opened it — "From a link" and "From a photo" both
  // land here, and each opens on its own tab rather than making that tap feel
  // ignored. Every other tab is still one tap away.
  const input = useRecipeImportSource(initialMode);
  const { resolveSource, reset: resetInput, setMode, setUrl } = input;

  // "…and there's a salsa verde on page 45." Nothing is filtered out here for
  // an existing parent, because there isn't one yet — see importableReferences.
  const candidates = useMemo(
    () => (extracted ? importableReferences(extracted.references, recipes, null) : []),
    [extracted, recipes],
  );
  const components = useRecipeComponentImports(candidates, aisleOrder);
  const { reset: resetComponents, acceptedKeys } = components;
  // An ingredient line naming a recipe that's about to become a component is
  // already shopped for through that component — see coveredIngredients.
  const covered = useMemo(
    () => coveredIngredients(ingredients, candidates, acceptedKeys),
    [ingredients, candidates, acceptedKeys],
  );

  // Every heading the Section picker can offer, for a recipe that doesn't
  // exist yet: just whatever this batch has already been filed under.
  const existingSections = useMemo(
    () => sectionsOf(ingredients.map((row, i) => ({ id: String(i), section: row.section }))),
    [ingredients],
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setExtracted(null);
    setIngredients([]);
    setName('');
    setAccepted(new Set());
    setApplyDetails(true);
    setApplyMethod(true);
    setApplyPrepTasks(true);
    setApplySource(true);
    setSteps([]);
    setAcceptedSteps(new Set());
    setPrepTasks([]);
    setAcceptedPrepTasks(new Set());
    setServingsText('');
    setMinutesText('');
    setYieldText('');
    setSiteName('');
    setSourceAuthor('');
    resetInput();
    resetComponents();
  }, [resetInput, resetComponents]);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  // `input` keeps its own `mode` and `url` state, and both only pick up the
  // props on first mount — while this sheet stays mounted for the screen's whole
  // life. So a later tap on a different add-menu item (link vs. photo) changed
  // `initialMode` without the sheet re-opening on that tab, and a page arriving
  // from the share sheet arrives as a prop rather than as typing. Both are
  // synced on the same transition that opens the sheet, which is also the only
  // point *after* the reset above: that runs on close, and would wipe a value
  // set any earlier.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    // Only when there is one — the add menu's two items open with an empty
    // field, and clearing it here would fight the reset that just ran.
    if (initialUrl) setUrl(initialUrl);
  }, [visible, initialMode, initialUrl, setMode, setUrl]);

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
      // The page's own title is the better answer when the model didn't give
      // one — a page that says what it's called is not a recipe with no name.
      setName(result.name || resolved.page?.title || '');
      setAccepted(new Set(result.ingredients.map((_, i) => i)));
      setApplyDetails(result.servings !== null || result.prepMinutes !== null || result.recipeYield !== null);
      const methodStepsFound = (resolved.page?.steps.length ?? 0) > 0
        ? resolved.page!.steps
        : result.steps;
      setSteps(methodStepsFound);
      setAcceptedSteps(new Set(methodStepsFound.map((_, i) => i)));
      setPrepTasks(result.prepTasks);
      setAcceptedPrepTasks(new Set(result.prepTasks.map((_, i) => i)));
      setServingsText(formatServingsRange(result.servings, result.servingsMax) ?? '');
      setMinutesText(result.prepMinutes !== null ? String(result.prepMinutes) : '');
      setYieldText(result.recipeYield ?? '');
      const { page } = resolved;
      setApplySource(!!page);
      setSiteName(page?.siteName ?? '');
      setSourceAuthor(page?.author ?? '');
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

  const editIngredient = (
    index: number, patch: Partial<Pick<RecipeGroceryItem, 'name' | 'quantity' | 'section'>>,
  ) => {
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

  // Checked as they type rather than on tap, so the way out ("Open it", or just
  // keep typing) is visible before the button they'd reach for is disabled.
  const cleaned = cleanRecipeName(name);
  const duplicate = useMemo(() => {
    if (!cleaned) return null;
    const key = groceryNameKey(cleaned);
    return recipes.find(r => r.nameKey === key) ?? null;
  }, [cleaned, recipes]);

  const toggleIn = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
  ) => (index: number) => setter(prev => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
  const toggleStep = toggleIn(setAcceptedSteps);
  const togglePrepTask = toggleIn(setAcceptedPrepTasks);

  const editStep = (index: number, text: string) => {
    haptics.success();
    setSteps(prev => prev.map((step, i) => (i === index ? text : step)));
  };

  const editPrepTask = (index: number, patch: Partial<ExtractedPrepTask>) => {
    haptics.success();
    setPrepTasks(prev => prev.map((task, i) => (i === index ? { ...task, ...patch } : task)));
  };

  const handleCreate = () => {
    if (!extracted || !cleaned || duplicate) return;
    const recipe = addRecipe(cleaned);
    if (!recipe) {
      // The store refused a name the live check said was free — the box changed
      // under a sheet left open. Land them on the recipe they were after.
      const existing = recipes.find(r => r.nameKey === groceryNameKey(cleaned));
      if (existing) { onClose(); onCreated(existing.id, input.page?.url ?? null); }
      return;
    }
    // Tapping Create can beat a field's own blur, so every value below is read
    // through the pending-edit registry rather than straight off state a draft
    // hasn't landed in yet (same race TaskEditor's resolveX functions guard
    // against — see usePendingEdits for why the resolvers return values
    // instead of committing).
    const pending = edits.resolveAll();
    const pendingText = (key: string, fallback: string) => pending.get(key) ?? fallback;
    const resolvedIngredients = ingredients.map((row, i) => {
      const itemName = pending.get(`ingredient:${i}:name`);
      const quantity = pending.get(`ingredient:${i}:quantity`);
      if (itemName === undefined && quantity === undefined) return row;
      const next = {
        ...row,
        ...(itemName !== undefined && { name: itemName }),
        ...(quantity !== undefined && { quantity }),
      };
      if (itemName !== undefined) {
        next.aisle = rememberedAisleFor(itemName) ?? aisleForName(itemName) ?? 'Other';
      }
      return next;
    });
    const chosen = resolvedIngredients
      .filter((_, i) => accepted.has(i) && !covered.has(i))
      .map(item => normalizeIngredient(item))
      .filter((i): i is NonNullable<typeof i> => i !== null);
    if (chosen.length > 0) addStructuredIngredients(recipe.id, chosen);
    // After the recipe exists, so the links have something to hang off.
    components.commitTo(recipe.id);
    if (applyDetails) {
      // Whatever's in the box now, not what the model first said — the row is
      // editable, so `extracted` is only ever the starting value here.
      const servings = parseServingsRange(pendingText('details:servings', servingsText));
      if (servings) setServings(recipe.id, servings.servings, servings.servingsMax);
      // Was read off the recipe and shown on the row, then dropped on the way
      // out — the row promised a time the new recipe never got.
      //
      // Lands on `estimatedMinutes`, NOT on the identically-named
      // `Recipe.prepMinutes`: the extractor's field is the recipe's *total*
      // time, while the model's prepMinutes/estimatedMinutes pair splits prep
      // from cook. A total in the cook half leaves `totalMinutes()` correct;
      // in the prep half it would claim the whole recipe is mise en place.
      const minutes = parseInt(pendingText('details:minutes', minutesText), 10);
      if (minutes > 0) setEstimatedMinutes(recipe.id, minutes);
      const yieldValue = pendingText('details:yield', yieldText).trim();
      if (yieldValue) setRecipeYield(recipe.id, yieldValue);
    }
    // Everything a page told us about itself. Only ever set from structured
    // markup, so a paste and a photo leave all of it null as they always did.
    const { page } = input;
    if (page && applySource) {
      setSourceUrl(recipe.id, page.url);
      setSourceType(recipe.id, 'website');
      // The URL is the link that was pasted and isn't editable; the two the
      // page merely claims about itself are.
      const site = pendingText('source:site', siteName).trim();
      const by = pendingText('source:author', sourceAuthor).trim();
      if (site) setSource(recipe.id, site);
      if (by) setAuthor(recipe.id, by);
    }
    // The page's own steps when it has them (verbatim structured data),
    // otherwise whatever the model read off the source itself. Both of these
    // used to be written unconditionally, announced only by a sentence in the
    // intro — now they're rows you can read and untick like everything else.
    if (applyMethod) {
      steps.forEach((step, i) => {
        if (!acceptedSteps.has(i)) return;
        addStep(recipe.id, pendingText(`step:${i}:text`, step));
      });
    }
    if (applyPrepTasks) {
      prepTasks.forEach((task, i) => {
        if (!acceptedPrepTasks.has(i)) return;
        const added = addPrepTask(recipe.id, pendingText(`prep:${i}:text`, task.title));
        if (added && task.offsetDays !== added.offsetDays) {
          updatePrepTask(recipe.id, added.id, { offsetDays: task.offsetDays });
        }
      });
    }
    haptics.success();
    // Close first, then navigate: a navigate fired from under a live pageSheet
    // renders the destination behind the sheet.
    onClose();
    onCreated(recipe.id, page?.url ?? null);
  };

  const canCreate = !loading && !!extracted && !!cleaned && !duplicate;

  // One checkbox applying up to three facts has to name all it has, and it
  // reads out exactly what the row shows rather than a second phrasing of it.
  // Reads the boxes, not `extracted`, so it stays true once they're edited.
  const detailsLabel = !extracted ? '' : (() => {
    const parts: string[] = [];
    if (servingsText) parts.push(`Serves ${servingsText}`);
    if (minutesText) parts.push(`about ${minutesText} min`);
    if (yieldText) parts.push(`makes ${yieldText}`);
    if (parts.length === 0) return '';
    const [first, ...rest] = parts;
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(', ');
  })();

  // What the run found decides whether the details row exists; what's in its
  // boxes decides what it applies. Emptying them must not unmount the row
  // mid-edit — there'd be no way to type a value back in.
  const foundDetails = !!extracted
    && (extracted.servings !== null || extracted.prepMinutes !== null || extracted.recipeYield !== null);

  // Nothing to append after: this recipe doesn't exist yet.
  const methodMeta = methodRowMeta(acceptedSteps.size, steps.length, false);
  const prepTasksMeta = prepTasksRowMeta(acceptedPrepTasks.size, prepTasks.length, false);

  // The URL is what identifies the page, so it stays on the row even though
  // the two editable fields sit above it.
  const sourceMeta = input.page?.url ?? '';


  // A deterministic failure — a mistyped address, a site that refuses us, a page
  // that builds its recipe in the browser — fails identically however many times
  // you ask. What it needs is the input back, not another attempt at it.
  const backLabel = input.usingLink ? 'Change the link' : 'Go back';
  const goBack = () => { setError(null); setExtracted(null); };

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
            intro="Open a recipe link, photograph a cookbook page, or paste a recipe, and it’ll be added to your recipe box: name, servings and all."
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

    if (ingredients.length === 0 && !extracted.name) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="Nothing found"
            subtitle={input.usingPhoto
              ? 'Nothing readable turned up in that photo. Try again in better light, or paste the text instead.'
              : input.usingLink
              ? 'No recipe turned up on that page. Copy the recipe from it and paste it instead.'
              : 'No recipe turned up in that text.'}
            actionLabel={input.usingPhoto ? 'Try another photo' : undefined}
            onAction={input.usingPhoto ? () => { setExtracted(null); input.clearPhoto(); } : undefined}
          />
        </View>
      );
    }

    return (
      <ScrollView
        ref={keyboardScroll.ref}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        {...keyboardScroll.props}
      >
        <View style={styles.nameCard}>
          <Text style={styles.nameLabel}>NAME</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="Recipe name"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_NAME_MAX_LENGTH}
            accessibilityLabel="Recipe name"
          />
          {!!duplicate && (
            <View style={styles.dupeRow}>
              <Text style={styles.dupeText} numberOfLines={2}>
                You already have a recipe called “{duplicate.name}”.
              </Text>
              <TouchableOpacity
                activeOpacity={interaction.activeOpacity}
                // The page still counts as dealt with: they shared a recipe,
                // it turned out to already be in the box, and this lands them
                // on it. A queue entry the caller can now drop.
                onPress={() => {
                  haptics.tap();
                  onClose();
                  onCreated(duplicate.id, input.page?.url ?? null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${duplicate.name}`}
              >
                <Text style={styles.dupeAction}>Open it</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.intro}>
          Uncheck anything you don't want added. Tap any line to change it before it's saved.
        </Text>

        {foundDetails && (
          <ImportApplyRow
            checked={applyDetails}
            onToggle={() => setApplyDetails(v => !v)}
            title="Serves"
            accessibilityLabel={detailsLabel}
          >
            <View style={styles.detailFields}>
              <InlineEditableText
                edits={edits}
                editKey="details:servings"
                value={servingsText}
                onCommit={setServingsText}
                allowEmpty
                textStyle={styles.detailValue}
                placeholder="e.g. 4"
                accessibilityLabel="servings"
                maxLength={12}
                numberOfLines={1}
              />
              <Text style={styles.detailSep}>·</Text>
              <InlineEditableText
                edits={edits}
                editKey="details:minutes"
                value={minutesText}
                onCommit={setMinutesText}
                allowEmpty
                textStyle={styles.detailValue}
                placeholder="e.g. 45"
                accessibilityLabel="total minutes"
                maxLength={4}
                numberOfLines={1}
              />
              <Text style={styles.detailSep}>min</Text>
            </View>
            <View style={styles.detailFields}>
              <Text style={styles.detailSep}>Makes</Text>
              <InlineEditableText
                edits={edits}
                editKey="details:yield"
                value={yieldText}
                onCommit={setYieldText}
                allowEmpty
                textStyle={styles.detailValue}
                placeholder="e.g. 2 loaves"
                accessibilityLabel="yield"
                maxLength={RECIPE_SOURCE_MAX_LENGTH}
                numberOfLines={1}
              />
            </View>
          </ImportApplyRow>
        )}

        {steps.length > 0 && (
          <ImportApplyRow
            checked={applyMethod}
            onToggle={() => setApplyMethod(v => !v)}
            title="Method"
            meta={methodMeta}
            accessibilityLabel={`Method, ${methodMeta}`}
            preview={methodPreviewLines(steps)}
            acceptedLines={acceptedSteps}
            onToggleLine={toggleStep}
            onEditLine={editStep}
            ordered
            previewNoun="step"
            edits={edits}
            editKeyPrefix="step"
          />
        )}

        {prepTasks.length > 0 && (
          <ImportApplyRow
            checked={applyPrepTasks}
            onToggle={() => setApplyPrepTasks(v => !v)}
            title="Prep tasks"
            meta={prepTasksMeta}
            accessibilityLabel={`Prep tasks, ${prepTasksMeta}`}
            preview={prepTaskPreviewLines(prepTasks)}
            acceptedLines={acceptedPrepTasks}
            onToggleLine={togglePrepTask}
            onEditLine={(i, title) => editPrepTask(i, { title })}
            onEditLead={(i, offsetDays) => editPrepTask(i, { offsetDays })}
            previewNoun="task"
            edits={edits}
            editKeyPrefix="prep"
          />
        )}

        {!!input.page && (
          <ImportApplyRow
            checked={applySource}
            onToggle={() => setApplySource(v => !v)}
            title="Where it’s from"
            meta={sourceMeta}
            accessibilityLabel={`Where it’s from, ${sourceMeta}`}
          >
            <View style={styles.detailFields}>
              <InlineEditableText
                edits={edits}
                editKey="source:site"
                value={siteName}
                onCommit={setSiteName}
                allowEmpty
                textStyle={styles.detailValue}
                placeholder="e.g. Serious Eats"
                accessibilityLabel="site name"
                maxLength={80}
                numberOfLines={1}
              />
              <Text style={styles.detailSep}>·</Text>
              <InlineEditableText
                edits={edits}
                editKey="source:author"
                value={sourceAuthor}
                onCommit={setSourceAuthor}
                allowEmpty
                textStyle={styles.detailValue}
                placeholder="e.g. Kenji"
                accessibilityLabel="author"
                maxLength={80}
                numberOfLines={1}
              />
            </View>
          </ImportApplyRow>
        )}

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
              row={row}
              edits={edits}
              index={i}
              checked={accepted.has(i) && !coveredBy}
              onToggle={() => toggle(i)}
              onEditName={name => editIngredient(i, { name })}
              onEditQuantity={quantity => editIngredient(i, { quantity })}
              onEditSection={section => editIngredient(i, { section })}
              existingSections={existingSections}
              catalogItems={groceryItems}
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
            <Text style={styles.headerTitle}>Import a recipe</Text>
          </View>
          <SheetHeaderButton
            label="Create"
            onPress={handleCreate}
            disabled={!canCreate}
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
    detailFields: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    detailValue: { fontSize: font.sm, color: colors.textSecondary },
    detailSep: { fontSize: font.sm, color: colors.textTertiary },
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
    nameCard: {
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    nameLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    nameInput: {
      color: colors.text,
      fontSize: font.lg,
      fontWeight: fontWeight.semibold,
      paddingVertical: spacing.xs,
      minHeight: 36,
    },
    dupeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingTop: spacing.xs,
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
    },
    dupeText: { flex: 1, color: colors.textSecondary, fontSize: font.xs },
    dupeAction: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  });
}
