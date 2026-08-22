import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  iconSize,
  interaction,
  checkboxRadius,
  type Colors,
} from '../theme';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  extractRecipe, type ExtractedRecipe, type RecipeGroceryItem,
} from '../services/aiSuggestions';
import { describeImportError, isRetryableImportError } from '../services/recipePage';
import { normalizeIngredient, cleanRecipeName, formatServingsRange } from '../utils/recipeUtils';
import { groceryNameKey } from '../utils/groceryParse';
import { aisleForName } from '../utils/groceryAisles';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker, type RecipeInputMode } from './RecipeSourcePicker';
import { ExtractedIngredientRow, type ExtractedIngredientRowHandle } from './ExtractedIngredientRow';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { useRecipeComponentImports } from '../hooks/useRecipeComponentImports';
import { ImportedComponentRow } from './ImportedComponentRow';
import { coveredIngredients, importableReferences } from '../utils/recipeImportComponents';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  /** Which tab to open on — the add menu's item decides, see RecipesScreen. */
  initialMode?: RecipeInputMode;
  onClose: () => void;
  /** Handed the new (or matched existing) recipe id; the caller navigates. */
  onCreated: (recipeId: string) => void;
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
 * **A link import fills in more of the recipe than the other two sources can**,
 * and that asymmetry is the page's doing rather than a policy: a page that
 * publishes `schema.org/Recipe` hands over its method and its attribution as
 * structured data, so the method is written straight to `Recipe.steps` and the
 * site to `source`/`sourceUrl` rather than being re-derived by a model that is
 * under instruction to ignore the method. A paste and a photo carry neither, so
 * neither is invented for them.
 */
export function RecipeCreateSheet({ visible, initialMode = 'photo', onClose, onCreated }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // One ref per visible row, so handleCreate can flush whichever one is
  // mid-edit — see ExtractedIngredientRowHandle.resolvePendingEdit.
  const rowRefs = useRef(new Map<number, ExtractedIngredientRowHandle | null>());

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const setServings = useRecipeStore(s => s.setServings);
  const setEstimatedMinutes = useRecipeStore(s => s.setEstimatedMinutes);
  const setSourceUrl = useRecipeStore(s => s.setSourceUrl);
  const setSource = useRecipeStore(s => s.setSource);
  const setAuthor = useRecipeStore(s => s.setAuthor);
  const setSourceType = useRecipeStore(s => s.setSourceType);
  const addStep = useRecipeStore(s => s.addStep);
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
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  // Whichever add-menu item opened it — "From a link" and "From a photo" both
  // land here, and each opens on its own tab rather than making that tap feel
  // ignored. Every other tab is still one tap away.
  const input = useRecipeImportSource(initialMode);
  const { resolveSource, reset: resetInput } = input;

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

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setExtracted(null);
    setIngredients([]);
    setName('');
    setAccepted(new Set());
    setApplyDetails(true);
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
      // The page's own title is the better answer when the model didn't give
      // one — a page that says what it's called is not a recipe with no name.
      setName(result.name || resolved.page?.title || '');
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

  // Checked as they type rather than on tap, so the way out ("Open it", or just
  // keep typing) is visible before the button they'd reach for is disabled.
  const cleaned = cleanRecipeName(name);
  const duplicate = useMemo(() => {
    if (!cleaned) return null;
    const key = groceryNameKey(cleaned);
    return recipes.find(r => r.nameKey === key) ?? null;
  }, [cleaned, recipes]);

  const handleCreate = () => {
    if (!extracted || !cleaned || duplicate) return;
    const recipe = addRecipe(cleaned);
    if (!recipe) {
      // The store refused a name the live check said was free — the box changed
      // under a sheet left open. Land them on the recipe they were after.
      const existing = recipes.find(r => r.nameKey === groceryNameKey(cleaned));
      if (existing) { onClose(); onCreated(existing.id); }
      return;
    }
    // Tapping Create can beat a row's own blur — merge in whatever's still
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
    // After the recipe exists, so the links have something to hang off.
    components.commitTo(recipe.id);
    if (applyDetails) {
      if (extracted.servings !== null) {
        setServings(recipe.id, extracted.servings, extracted.servingsMax);
      }
      // Was read off the recipe and shown on the row, then dropped on the way
      // out — the row promised a time the new recipe never got.
      //
      // Lands on `estimatedMinutes`, NOT on the identically-named
      // `Recipe.prepMinutes`: the extractor's field is the recipe's *total*
      // time, while the model's prepMinutes/estimatedMinutes pair splits prep
      // from cook. A total in the cook half leaves `totalMinutes()` correct;
      // in the prep half it would claim the whole recipe is mise en place.
      if (extracted.prepMinutes !== null) setEstimatedMinutes(recipe.id, extracted.prepMinutes);
    }
    // Everything a page told us about itself. Only ever set from structured
    // markup, so a paste and a photo leave all of it null as they always did.
    const { page } = input;
    if (page) {
      setSourceUrl(recipe.id, page.url);
      setSourceType(recipe.id, 'website');
      if (page.siteName) setSource(recipe.id, page.siteName);
      if (page.author) setAuthor(recipe.id, page.author);
      page.steps.forEach(step => addStep(recipe.id, step));
    }
    haptics.success();
    // Close first, then navigate: a navigate fired from under a live pageSheet
    // renders the destination behind the sheet.
    onClose();
    onCreated(recipe.id);
  };

  const canCreate = !loading && !!extracted && !!cleaned && !duplicate;

  // One checkbox applying two facts has to name both when it has both, and it
  // reads out exactly what the row shows rather than a second phrasing of it.
  const detailsLabel = !extracted ? ''
    : extracted.servings !== null
      ? `Serves ${formatServingsRange(extracted.servings, extracted.servingsMax)}${
          extracted.prepMinutes !== null ? `, about ${extracted.prepMinutes} min` : ''}`
      : `About ${extracted.prepMinutes} min`;

  // The method isn't in the review list — it's taken verbatim off the page, so
  // there's nothing to tick or correct — but arriving with steps nobody
  // mentioned is a surprise, so the count is said out loud.
  const stepCount = input.page?.steps.length ?? 0;


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
                onPress={() => { haptics.tap(); onClose(); onCreated(duplicate.id); }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${duplicate.name}`}
              >
                <Text style={styles.dupeAction}>Open it</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.intro}>
          Untick anything you don't want added, or tap a name or amount to change it.
          {stepCount > 0 && ` The method comes across too — ${stepCount} step${stepCount === 1 ? '' : 's'}.`}
        </Text>

        {(extracted.servings !== null || extracted.prepMinutes !== null) && (
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
      color: colors.textTertiary,
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
