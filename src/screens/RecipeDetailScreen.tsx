// One recipe: ingredients, sections, prep tasks, method, cook mode. A single
// component of ~1,420 lines with two top-level symbols, so grep a landmark
// rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
//
// Composition, sections, scaling and unit conversion are all written up in
// docs/arch/recipes.md; read that before changing how a line is resolved.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
  Share,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeIngredient, RecipePrepTask, RecipeStep } from '../types';
import { GROCERY_NAME_MAX_LENGTH, RECIPE_SECTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRowSelection } from '../hooks/useRowSelection';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { StepTimerRow } from '../components/StepTimerRow';
import { CountStepper } from '../components/CountStepper';
import { PressableScale } from '../components/PressableScale';
import { SortableList, type SortableRenderItem } from '../components/SortableList';
import { IngredientCatalogMatchSheet } from '../components/IngredientCatalogMatchSheet';
import {
  catalogMatchSummary,
  matchIngredientsToCatalog,
} from '../utils/ingredientCatalogMatch';
import { ListBulkBar } from '../components/ListBulkBar';
import { RecipeEditor } from '../components/RecipeEditor';
import { RecipeIngredientSheet } from '../components/RecipeIngredientSheet';
import { PrepTaskSheet } from '../components/PrepTaskSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { PlanMealSheet } from '../components/PlanMealSheet';
import { RecipeExtractSheet } from '../components/RecipeExtractSheet';
import { RecipeComponentPicker } from '../components/RecipeComponentPicker';
import { ComponentChoiceSheet } from '../components/ComponentChoiceSheet';
import { usePlanMeal } from '../hooks/usePlanMeal';
import { useRecipeTimer } from '../hooks/useRecipeTimer';
import { useStepTimers } from '../hooks/useStepTimers';
import { RecipeTimerRow } from '../components/RecipeTimerRow';
import { CookModeSheet } from '../components/CookModeSheet';
import { cookSteps } from '../utils/cookMode';
import { MAX_STEP_TIMER_SECONDS, formatStepDuration, parseStepDurations, stepDurationOffers } from '../utils/stepTimers';
import { featureHidden, featureShown } from '../utils/simpleMode';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { pickRecipeImage, resolveRecipeImagePath, type RecipePhotoSource } from '../utils/recipePhoto';
import { describeRecipe, totalMinutes } from '../utils/recipeUtils';
import { buildIngredientsText, buildRecipeShareText } from '../utils/shareText';
import { allSectionsOf, sectionsFromMergedOrder, type SectionListEntry } from '../utils/recipeSections';
import { PillGroup } from '../components/PillGroup';
import { describeUnscaled, scaleQuantity } from '../utils/recipeScale';
import { convertQuantity } from '../utils/unitConvert';
import { RecipeScaleChips } from '../components/RecipeScaleChips';
import { tagColor } from '../utils/tagColor';
import { formatDuration } from '../utils/effort';
import {
  alternativeCaptions,
  flattenRecipeIngredients,
  recipeMap,
  resolveComponents,
  type ResolvedComponent,
} from '../utils/recipeComponents';
import { applyStandingSwap, describeStandingSwap, standingSwapMap } from '../utils/standingSwaps';
import { describeRecipeCost, estimateRecipeCost } from '../utils/recipeCost';
import { formatOffsetLabel } from '../utils/templateUtils';
import { splitAlternativeNames, splitGroceryLines } from '../utils/groceryParse';

type RootStackParamList = {
  RecipeDetail: { recipeId: string };
};

/** One row of the merged list the ingredients SortableList drags over — see mergedIngredientRows. */
type MergedIngredientRow =
  | { kind: 'ingredient'; id: string; ingredient: RecipeIngredient }
  | { kind: 'heading'; id: string; name: string; empty: boolean };

export function RecipeDetailScreen() {
  // ==== store bindings and layout insets ====
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'RecipeDetail'>>();
  const { recipeId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const recipe = recipes.find(r => r.id === recipeId);
  const addIngredient = useRecipeStore(s => s.addIngredient);
  const addIngredientsFromText = useRecipeStore(s => s.addIngredientsFromText);
  const removeIngredient = useRecipeStore(s => s.removeIngredient);
  const reorderIngredients = useRecipeStore(s => s.reorderIngredients);
  const bulkRemoveIngredients = useRecipeStore(s => s.bulkRemoveIngredients);
  const bulkSetIngredientAisle = useRecipeStore(s => s.bulkSetIngredientAisle);
  const addEmptySection = useRecipeStore(s => s.addEmptySection);
  const removeEmptySection = useRecipeStore(s => s.removeEmptySection);
  const toggleFavorite = useRecipeStore(s => s.toggleFavorite);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const removePrepTask = useRecipeStore(s => s.removePrepTask);
  const addStep = useRecipeStore(s => s.addStep);
  const updateStep = useRecipeStore(s => s.updateStep);
  const removeStep = useRecipeStore(s => s.removeStep);
  const reorderSteps = useRecipeStore(s => s.reorderSteps);
  const setStepTimerSeconds = useRecipeStore(s => s.setStepTimerSeconds);
  const setImage = useRecipeStore(s => s.setImage);
  const addComponent = useRecipeStore(s => s.addComponent);
  const removeComponent = useRecipeStore(s => s.removeComponent);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addAisle = useGroceryStore(s => s.addAisle);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));

  // The user's standing swaps — "always use oat milk for milk" (#1571). Shown
  // here as well as on the shopping read, because a cook reading the recipe
  // needs to know which line they'll actually be cooking with. Display only:
  // the row still edits, reorders and removes the recipe's own line, and
  // nothing here writes a swapped name back.
  const standingSwaps = useMemo(
    () => standingSwapMap(itemSubs, groceryItems),
    [itemSubs, groceryItems]
  );

  const recipesById = useMemo(() => recipeMap(recipes), [recipes]);
  const components = useMemo(
    () => (recipe ? resolveComponents(recipe, recipesById) : []),
    [recipe, recipesById]
  );
  // What the grocery add is actually going to offer — the recipe's own lines
  // plus every component's, which is the number the footer button gates on.
  // ==== the resolved recipe: components, counts, cost, the scaled lines ====
  const shoppableCount = useMemo(
    () => (recipe ? flattenRecipeIngredients(recipe, recipesById).length : 0),
    [recipe, recipesById]
  );
  // What cook mode would have to read out — this recipe's steps and every
  // component's, or the notes blob a recipe predating Recipe.steps still keeps
  // its method in. Zero means there is no method here at all, and the footer
  // simply doesn't offer the button rather than offering a disabled one: an
  // absent verb reads as "nothing written down yet", where a greyed one reads
  // as a feature that's broken.
  const cookableCount = useMemo(
    () => (recipe ? cookSteps(recipe, recipesById).length : 0),
    [recipe, recipesById]
  );

  // How much of the recipe you're reading it for. Screen state, deliberately
  // written nowhere: halving a recipe to cook for one tonight is not an edit to
  // the recipe, and the lasting form of the same fact lives on the meal that
  // was planned (MealPlanEntry.recipeScale). It does travel into the add-to-list
  // sheet, which is the one place the number turns into something bought.
  const [scale, setScale] = useState(1);

  // Only lines that *have* a quantity can fail to scale; a line with none was
  // never going to say a number either way.
  const unscaledNote = useMemo(() => {
    if (!recipe) return null;
    const count = recipe.ingredients.filter(
      i => i.quantity.trim() && !scaleQuantity(i.quantity, scale).scaled
    ).length;
    return describeUnscaled(count, scale);
  }, [recipe, scale]);

  // Priced through the same flattening the shopping read uses (components,
  // standing swaps, this much of the recipe) — null while too little of it is
  // priced to say anything (see recipeCost.ts).
  const costEstimate = useMemo(
    () => (recipe ? estimateRecipeCost(recipe, groceryItems, recipesById, undefined, scale, standingSwaps) : null),
    [recipe, groceryItems, recipesById, scale, standingSwaps]
  );
  const costLine = useMemo(
    () => describeRecipeCost(costEstimate, currencySymbol, new Date()),
    [costEstimate, currencySymbol]
  );

  // ==== local state (drafts, the sheets this screen opens) ====
  const [draft, setDraft] = useState('');
  // What new ingredients are filed under, until changed or cleared — the add
  // field's own equivalent of RecipeIngredientSheet's Section field, and its
  // picker works the same way (same PillGroup, same onCreate): it used to be
  // free text, on the theory that a picker would be empty exactly when
  // someone first needed it, but the grid's own "New section" reveal field
  // fills that gap without letting a typo mint a heading nothing else can
  // find. Re-filing a row that already exists is the sheet's job, or a drag.
  const [sectionDraft, setSectionDraft] = useState('');
  const [pickingImage, setPickingImage] = useState(false);
  const draftInputRef = useRef<TextInput>(null);
  const [prepDraft, setPrepDraft] = useState('');
  // One field does both jobs — add and edit — rather than a second sheet like
  // PrepTaskSheet: a step is a single field, so a whole extra component would
  // outweigh what it's editing. editingStepId null means the field is
  // building a new step; set, it's replacing that step's text on submit.
  const [stepDraft, setStepDraft] = useState('');
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const stepInputRef = useRef<TextInput>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  const [editingPrepTask, setEditingPrepTask] = useState<RecipePrepTask | null>(null);
  const [addToListVisible, setAddToListVisible] = useState(false);
  const [planVisible, setPlanVisible] = useState(false);
  const { planRecipe, offerPrepTasks } = usePlanMeal();
  const [extractVisible, setExtractVisible] = useState(false);
  const [cookModeVisible, setCookModeVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [componentPickerVisible, setComponentPickerVisible] = useState(false);
  const [choiceComponent, setChoiceComponent] = useState<ResolvedComponent | null>(null);
  // The catalog-match review sheet, and what it's scoped to: null means the
  // whole recipe (opened from the summary row), a list of ids means the lines
  // one paste just added (opened from its banner).
  const [matchSheetOpen, setMatchSheetOpen] = useState(false);
  const [matchScopeIds, setMatchScopeIds] = useState<readonly string[] | null>(null);
  // The banner a multi-line paste leaves behind, or null once dismissed or
  // acted on. Session-only and deliberately not persisted: it reports on one
  // paste that just happened, and a banner still sitting there tomorrow would
  // be reporting on an edit nobody remembers making.
  const [pasteResult, setPasteResult] =
    useState<{ addedIds: string[]; added: number; unresolved: number } | null>(null);
  // Turns the list's own scroll off while a row is being dragged. Without it
  // the drag is silently dead — see the note on SortableList.onDragStateChange.
  const [dragging, setDragging] = useState(false);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  // Bulk-selecting ingredients — same plain useRowSelection every non-task list
  // in the app reuses (Templates, Grocery), plus the ingredient-specific "Move
  // to Aisle" / delete actions below. Entered from a header button rather than
  // a swipe or long press: both of a row's own gestures are already spoken for
  // (tap opens the edit sheet, long press starts a reorder drag).
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
  } = useRowSelection();

  // Both timers, wired up — the clock, the derivation and the store calls all
  // live in the hook now, because cook mode (#1695) keeps the cook timer on
  // screen too and a second copy of this is how the two would come to disagree
  // about what "running" means. Called above the "the row is gone" guard
  // below, which is why the hook tolerates an undefined recipe.
  const prepTimer = useRecipeTimer(recipe, 'Prep');
  const cookTimer = useRecipeTimer(recipe, 'Cook');
  // Takes an undefined recipe id for the same reason the two above take an
  // undefined recipe: this is called above the screen's own "the row is gone"
  // guard.
  const stepTimers = useStepTimers(recipe?.id);

  // The row can be gone while the screen is still mounted (deleted from the
  // editor), so this renders rather than crashing on the next read.
  if (!recipe) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="Recipe" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="restaurant-outline"
          title="This recipe is gone"
          subtitle="It was deleted from another screen"
        />
      </View>
    );
  }

  const totalTimeMinutes = totalMinutes(recipe);

  const submitDraft = () => {
    const text = draft;
    if (!text.trim()) return;
    animateLayout();
    const section = sectionDraft.trim() || null;
    // A multi-line paste is the common way a recipe arrives, so one field
    // handles both — splitGroceryLines tells them apart.
    const isPaste = splitGroceryLines(text).length > 1;
    const before = new Set(recipe.ingredients.map(i => i.id));
    const added = isPaste
      ? addIngredientsFromText(recipe.id, text, section)
      : (addIngredient(recipe.id, text, section) ? 1 : 0);
    setDraft('');
    if (added > 0) haptics.tap();
    else haptics.warning();
    // Only a paste gets the banner. Adding one line at a time already shows
    // its own answer — the row appears with its badge (or without one) right
    // where you're looking — so a banner there would narrate what is already
    // on screen. A paste is the case where six rows land at once, several
    // scrolls of them, and nothing says which the app could place.
    //
    // Read back from the store rather than from `recipe`, which is this
    // render's closure and predates the write by a line.
    if (isPaste && added > 0) {
      const after = useRecipeStore.getState().recipes.find(r => r.id === recipe.id)?.ingredients ?? [];
      const addedIds = after.filter(i => !before.has(i.id)).map(i => i.id);
      const now = new Date();
      const unresolved = matchIngredientsToCatalog(
        after.filter(i => !before.has(i.id)).map(i => i.name), groceryItems, now
      ).filter(m => m.kind !== 'linked').length;
      animateLayout();
      setPasteResult(unresolved > 0 ? { addedIds, added, unresolved } : null);
    }
    // Keep the keyboard up so adding several ingredients in a row doesn't
    // need a re-tap of the field each time — see the chain-step add input
    // in TaskEditor for the same pattern. The short delay lets the field's
    // own submit-triggered blur settle before we pull focus back.
    setTimeout(() => {
      draftInputRef.current?.focus();
    }, 50);
  };

  // ==== actions: add to list, share, plan, edit an ingredient ====
  const addToList = () => {
    if (shoppableCount === 0) return;
    haptics.tap();
    setAddToListVisible(true);
  };

  const confirmRemoveComponent = (resolved: ResolvedComponent) => {
    animateLayout();
    removeComponent(recipe.id, resolved.component.id);
    haptics.tap();
  };

  const confirmRemove = (ingredient: RecipeIngredient) => {
    animateLayout();
    removeIngredient(recipe.id, ingredient.id);
    haptics.tap();
  };

  // No confirm alert, matching confirmRemove above — an ingredient is a typed
  // line, trivially re-added, not a delete that needs a safety net.
  const handleBulkRemoveIngredients = () => {
    animateLayout();
    bulkRemoveIngredients(recipe.id, Array.from(selectedIds));
    haptics.tap();
    exitSelection();
  };

  const handleBulkSetAisle = (aisle: string | null) => {
    if (!aisle) return;
    animateLayout();
    bulkSetIngredientAisle(recipe.id, Array.from(selectedIds), aisle);
    exitSelection();
  };

  const submitPrepDraft = () => {
    if (!prepDraft.trim()) return;
    animateLayout();
    const added = addPrepTask(recipe.id, prepDraft);
    setPrepDraft('');
    if (added) haptics.tap();
    else haptics.warning();
  };

  const confirmRemovePrepTask = (prepTask: RecipePrepTask) => {
    animateLayout();
    removePrepTask(recipe.id, prepTask.id);
    haptics.tap();
  };

  // The ingredients alone, as the plain lines another app's paste box wants
  // — built here rather than at press time so the copy and share actions can
  // both gate themselves on it being non-empty (see shareText.ts).
  const ingredientsText = useMemo(
    () => (recipe ? buildIngredientsText(recipe, recipesById, { scale, unitSystem }) : ''),
    [recipe, recipesById, scale, unitSystem]
  );

  const { copied: copiedIngredients, copy: copyIngredients } = useCopyToClipboard();

  const handleShareIngredients = () => {
    if (!ingredientsText) return;
    haptics.tap();
    Share.share({ message: ingredientsText }).catch(() => {});
  };

  // Renders through the same scale and unit system the screen is showing,
  // so what gets sent matches what's on screen rather than the recipe's raw
  // numbers — see shareText.ts. A rejection (the user backed out of the
  // share sheet) is not an error and needs no handling.
  const handleShare = () => {
    haptics.tap();
    const message = buildRecipeShareText(recipe, recipesById, { scale, unitSystem });
    Share.share({ message }).catch(() => {});
  };

  // Skip Linking.canOpenURL — recipe links are always http(s), and openURL
  // fails harmlessly with nothing to catch beyond ignoring it (see the same
  // call in TaskItem's handleOpenLink).
  const handleOpenSourceUrl = async () => {
    if (!recipe.sourceUrl) return;
    haptics.tap();
    try {
      await Linking.openURL(recipe.sourceUrl);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };

  // The step being edited, resolved live so its timer control reads the store
  // rather than a copy of it — the length is written through on every press,
  // the same way every other picker in this screen writes.
  const editingStep = editingStepId === null ? null : recipe.steps.find(s => s.id === editingStepId) ?? null;
  const editingStepParsed = editingStep === null ? null : parseStepDurations(editingStep.text)[0] ?? null;

  const submitStepDraft = () => {
    if (!stepDraft.trim()) return;
    animateLayout();
    if (editingStepId) {
      updateStep(recipe.id, editingStepId, stepDraft);
      setEditingStepId(null);
      haptics.tap();
    } else {
      const added = addStep(recipe.id, stepDraft);
      if (added) haptics.tap();
      else haptics.warning();
    }
    setStepDraft('');
  };

  const beginEditStep = (step: RecipeStep) => {
    haptics.tap();
    setEditingStepId(step.id);
    setStepDraft(step.text);
    stepInputRef.current?.focus();
  };

  const cancelEditStep = () => {
    haptics.tap();
    setEditingStepId(null);
    setStepDraft('');
  };

  const confirmRemoveStep = (step: RecipeStep) => {
    animateLayout();
    // Editing the very step being deleted would otherwise leave the field
    // pointed at an id that no longer resolves.
    if (editingStepId === step.id) { setEditingStepId(null); setStepDraft(''); }
    removeStep(recipe.id, step.id);
    haptics.tap();
  };

  // Same denial copy as useRecipePhotoSource's — iOS only prompts once, so a
  // second tap on either button needs an alert naming the permission or does
  // nothing visible.
  const pickImage = async (source: RecipePhotoSource) => {
    setPickingImage(true);
    try {
      const result = await pickRecipeImage(source);
      if (result.status === 'ok') {
        haptics.success();
        setImage(recipe.id, result.image.uri);
      } else if (result.status === 'denied') {
        const what = source === 'camera' ? 'the camera' : 'your photos';
        Alert.alert(
          `dundundun can't reach ${what}`,
          result.canAskAgain
            ? `Allow access to ${what} to attach a photo to this recipe.`
            : `Turn on access to ${what} in Settings to attach a photo to this recipe.`,
          result.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ],
        );
      } else if (result.status === 'failed') {
        Alert.alert('Could not attach photo', result.message);
      }
      // 'canceled' is a deliberate no-op — they changed their mind.
    } finally {
      setPickingImage(false);
    }
  };

  const openImagePicker = () => {
    if (pickingImage) return;
    haptics.tap();
    const options: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: 'Take Photo', onPress: () => pickImage('camera') },
      { text: 'Choose from Library', onPress: () => pickImage('library') },
    ];
    if (recipe.imagePath) {
      options.push({ text: 'Remove Photo', style: 'destructive', onPress: () => setImage(recipe.id, null) });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Recipe Photo', undefined, options);
  };
  // The ingredients list, plus one marker per heading it has — populated ones
  // where a row's section first differs from the row before it, and every
  // declared-but-empty one (Recipe.emptySections) trailing at the end. This is
  // what SortableList actually drags over: a heading is a row in this list,
  // not a caption inferred from a row's own label, which is what makes an
  // empty heading a real drop target and not just static text. See
  // sectionsFromMergedOrder for how a drag commit turns back into
  // per-ingredient `section` values.
  const mergedIngredientRows = useMemo(() => {
    const rows: MergedIngredientRow[] = [];
    let prevSection: string | null = null;
    for (const ing of recipe.ingredients) {
      if (ing.section && ing.section !== prevSection) {
        rows.push({ kind: 'heading', id: `heading:${ing.section}`, name: ing.section, empty: false });
      }
      rows.push({ kind: 'ingredient', id: ing.id, ingredient: ing });
      prevSection = ing.section;
    }
    for (const name of recipe.emptySections) {
      rows.push({ kind: 'heading', id: `heading:${name}`, name, empty: true });
    }
    return rows;
  }, [recipe.ingredients, recipe.emptySections]);

  // The row currently under the drag, by id — set from SortableList's
  // onHoverChange so an empty heading can light up as a live drop target the
  // same way row-shifting already signals a target among populated ones. Only
  // empty headings read it (see renderHeadingRow): a populated one already
  // gets that feedback for free from the rows around it visibly opening a gap.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const handleIngredientHoverChange = (index: number | null) => {
    setHoveredRowId(index === null ? null : mergedIngredientRows[index]?.id ?? null);
  };

  // Every heading this recipe already has, real or declared — what "New
  // section" checks the typed name against so it can't redeclare one that
  // already exists.
  const allSections = useMemo(
    () => allSectionsOf(recipe.ingredients, recipe.emptySections),
    [recipe.ingredients, recipe.emptySections]
  );

  // The same display-only treatment for choice groups: the *first* row of each
  // group opens a heading, and is also the group's default (see
  // RecipeComponent.choiceGroup), so one pass over stored order answers both.
  // Unlike the ingredient sections above, a group's options need not be
  // adjacent — the heading opens at the first one and the rest keep their
  // places, because the list order is what the recipe reads like and reordering
  // it here would be editing the recipe to draw it.
  const choiceHeadersOf = (rows: readonly { id: string; choiceGroup: string | null }[]) => {
    const headers = new Map<string, string>();
    const defaults = new Set<string>();
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.choiceGroup || seen.has(row.choiceGroup)) continue;
      seen.add(row.choiceGroup);
      headers.set(row.id, row.choiceGroup);
      defaults.add(row.id);
    }
    return { headers, defaults };
  };

  const componentGroups = useMemo(() => choiceHeadersOf(recipe.components), [recipe.components]);
  const ingredientGroups = useMemo(() => choiceHeadersOf(recipe.ingredients), [recipe.ingredients]);

  // The header above only opens at a group's *first* option, so on its own every
  // other option reads as an ordinary line — and a list you read as ordinary is
  // a list you buy all of. Each option carries its own "or manchego" instead.
  // Built off the *resolved* components, not the stored links: the row shows the
  // referenced recipe's live name, and a caption naming the captured one would
  // go stale the moment that recipe is renamed.
  const componentAlternatives = useMemo(
    () => alternativeCaptions(components.map(c => ({
      id: c.component.id,
      choiceGroup: c.component.choiceGroup,
      name: c.name || 'Deleted recipe',
    }))),
    [components],
  );
  const ingredientAlternatives = useMemo(
    () => alternativeCaptions(recipe.ingredients),
    [recipe.ingredients],
  );

  // Lines the app can see wanting to be two — "corn tortillas or flour
  // tortillas" — so the row can say so. Without this the suggestion existed
  // only inside RecipeIngredientSheet, which is to say only for someone who
  // already suspected it was there.
  //
  // A row already filed under a choice group is skipped: it sits under a
  // "choose one" header, so nudging it to become a choice reads as the app
  // not having noticed what the user just did. Which is also why this and the
  // "or manchego" caption above can never appear on the same row — one names
  // a choice that exists, the other offers to make one.
  const splittableCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ing of recipe.ingredients) {
      if (ing.choiceGroup) continue;
      const parts = splitAlternativeNames(ing.name);
      if (parts) counts.set(ing.id, parts.length);
    }
    return counts;
  }, [recipe.ingredients]);

  // What each line resolves to in the grocery catalog — see
  // ingredientCatalogMatch.ts. `nameKey` has always been that bridge, but
  // nothing on this screen ever said whether a line had crossed it, so a line
  // one character or one leading word off read exactly like a line naming
  // something genuinely new.
  //
  // Keyed on the ingredients and the catalog together, because either moving
  // changes the answer: renaming a line relinks it, and so does the catalog
  // gaining the row it was looking for.
  const catalogMatches = useMemo(
    () => {
      const now = new Date();
      const matches = matchIngredientsToCatalog(
        recipe.ingredients.map(i => i.name), groceryItems, now
      );
      return new Map(recipe.ingredients.map((ing, i) => [ing.id, matches[i]]));
    },
    [recipe.ingredients, groceryItems],
  );
  const catalogSummary = useMemo(
    () => catalogMatchSummary([...catalogMatches.values()]),
    [catalogMatches],
  );

  const renderIngredient = (
    ingredient: RecipeIngredient,
    _index: number,
    drag: () => void,
    isDragging: boolean,
  ) => {
    const selected = selectedIds.has(ingredient.id);
    // Tinted only where the number on screen is genuinely not what the recipe
    // says, so the pills that did change are findable at a glance and the ones
    // rule 3 passed through are visibly untouched. A converted pill earns the
    // same tint for the same reason — scaled or converted, it's the app's
    // number rather than the recipe's.
    // Scaled first, then converted: the multiplication is exact and the
    // conversion rounds, so rounding last is the only order that doesn't
    // compound.
    //
    // The standing swap runs first, on the line as the recipe wrote it: its
    // ratio is stated per the recipe's own unit, so handing it an already
    // multiplied amount would convert something the recipe never said. What
    // the row then scales and converts is the swapped line — and everything
    // else about the row (edit, remove, reorder) still uses `ingredient`, the
    // recipe's own, which is what keeps the swap read-only.
    const swapped = applyStandingSwap(ingredient, standingSwaps);
    const line = swapped.ingredient;
    const swapNote = swapped.swappedFrom ? describeStandingSwap(swapped.swappedFrom) : null;
    const scaledResult = scaleQuantity(line.quantity, scale);
    const convertedResult = convertQuantity(scaledResult.text, unitSystem);
    const scaledQuantity = convertedResult.text;
    const scaledHere = scaledResult.scaled
      || convertedResult.converted
      // A ratio'd swap is the app's number too — the same tint, for the same
      // reason a converted one earns it.
      || line.quantity !== ingredient.quantity;
    // A line can open both: the section it belongs to (now its own row in the
    // merged list, not rendered here — see renderHeadingRow), then the either/or
    // slot it fills within that section.
    const choiceHeader = ingredientGroups.headers.get(ingredient.id);
    const choiceGroup = ingredient.choiceGroup;
    const isChoiceDefault = ingredientGroups.defaults.has(ingredient.id);
    const alternativeNote = ingredientAlternatives.get(ingredient.id);
    const splitInto = splittableCounts.get(ingredient.id);
    // Only a line with something to act on gets a badge: an exact match is the
    // healthy common case and a line naming something genuinely new is the
    // other one, so marking either would put a glyph on most rows to say
    // "nothing to do here". The count above the list is where a well-matched
    // recipe says so instead.
    //
    // Suppressed while a split is offered, the same mutual exclusion the
    // split pill and the "or manchego" caption already keep: "this line wants
    // to be two" comes first, and each half gets matched on its own once it
    // is. Two competing offers on one row is a row nobody reads.
    const catalogMatch = catalogMatches.get(ingredient.id);
    const catalogSuggestion = !splitInto && catalogMatch?.kind === 'suggested'
      ? catalogMatch
      : null;
    return (
      <View>
        {/* Its own treatment, deliberately not the section heading's. The two
            said entirely different things — "these belong to the frosting"
            versus "buy exactly one of these" — in identical uppercase grey,
            which is most of why a choice group read as another section that
            had somehow acquired a suffix. A tinted inline label with the same
            branch glyph the split suggestion uses reads as a rule about the
            rows under it. */}
        {!!choiceHeader && (
          <View style={styles.choiceHeader}>
            <Ionicons name="git-branch-outline" size={iconSize.xs} color={colors.accent} />
            <Text style={styles.choiceHeaderText} numberOfLines={1}>
              Choose one · {choiceHeader}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.ingredient,
            isDragging && styles.ingredientDragging,
            selectionMode && selected && styles.ingredientSelected,
            // Every option of a group, not just the first: the header only
            // opens at the top of one, so without this the second and third
            // options read as ordinary lines you buy as well.
            !!choiceGroup && styles.ingredientChoice,
          ]}
          activeOpacity={interaction.activeOpacity}
          onPress={() => {
            if (selectionMode) { toggleSelection(ingredient.id); return; }
            haptics.tap();
            setEditingIngredient(ingredient);
          }}
          onLongPress={selectionMode ? undefined : drag}
          delayLongPress={interaction.delayLongPress}
          accessibilityRole={selectionMode ? 'checkbox' : 'button'}
          accessibilityState={selectionMode ? { checked: selected } : undefined}
          accessibilityLabel={
            [ingredient.section, line.name, swapNote, scaledQuantity, ingredient.prep,
             ingredient.purpose && `for ${ingredient.purpose}`,
             choiceGroup && (isChoiceDefault ? `usual choice for ${choiceGroup}` : `alternative for ${choiceGroup}`)]
              .filter(Boolean).join(', ')
          }
          accessibilityHint={selectionMode ? 'Double tap to select' : 'Double tap to edit. Long press to reorder.'}
        >
          {selectionMode && (
            <View style={styles.ingredientSelect}>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={selected ? colors.accent : colors.textTertiary}
              />
            </View>
          )}
          <View style={styles.ingredientText}>
            <Text style={styles.ingredientName}>{line.name}</Text>
            {/* Directly under the name it replaced, in the same tint the
                quantity pill uses when the number isn't the recipe's: a
                swapped line has to be legible as the app's substitution
                rather than as what the recipe says. */}
            {!!swapNote && (
              <Text style={styles.swapNote} numberOfLines={1}>{swapNote}</Text>
            )}
            {(!!ingredient.prep || !!ingredient.purpose) && (
              <Text style={styles.ingredientPrep}>
                {[ingredient.prep, ingredient.purpose && `for ${ingredient.purpose}`].filter(Boolean).join(' · ')}
              </Text>
            )}
            {!!alternativeNote && (
              <Text style={styles.alternativeNote} numberOfLines={1}>{alternativeNote}</Text>
            )}
            {/* A signpost, not a second place to accept: it opens the same
                sheet the suggestion has always lived in — hence the ellipsis
                — so the split is confirmed against the actual parts in
                exactly one place, the way removing a component stays a
                Components-section action. Hidden while selecting, like the
                remove ×, since the row's press means something else then. */}
            {!!splitInto && !selectionMode && (
              <PressableScale
                style={styles.splitPill}
                haptic
                onPress={() => setEditingIngredient(ingredient)}
                accessibilityLabel={`Split ${ingredient.name} into alternatives`}
                accessibilityHint="Double tap to review the split"
              >
                <Ionicons name="git-branch-outline" size={iconSize.xs} color={colors.accent} />
                <Text style={styles.splitPillText}>Split into {splitInto}…</Text>
              </PressableScale>
            )}
            {/* The same signpost the split pill is, for the same reason: it
                names what it would link to, and opens the sheet where the
                link is confirmed rather than being a second place to accept.
                Naming the target is the whole point — an abstract glyph makes
                you tap to find out what it even found. */}
            {!!catalogSuggestion && !selectionMode && (
              <PressableScale
                style={styles.matchPill}
                haptic
                onPress={() => setEditingIngredient(ingredient)}
                accessibilityLabel={
                  `Did you mean ${catalogSuggestion.suggestedName}? It's in your groceries.`
                }
                accessibilityHint="Double tap to review the match"
              >
                <Ionicons name="basket-outline" size={iconSize.xs} color={colors.accent} />
                <Text style={styles.matchPillText} numberOfLines={1}>
                  {catalogSuggestion.suggestedName}?
                </Text>
              </PressableScale>
            )}
          </View>
          {!!scaledQuantity && (
            <View style={[styles.qtyPill, scaledHere && styles.qtyPillScaled]}>
              <Text
                style={[styles.qtyText, scaledHere && styles.qtyTextScaled]}
                numberOfLines={1}
              >
                {scaledQuantity}
              </Text>
            </View>
          )}
          {!selectionMode && (
            <TouchableOpacity
              onPress={() => confirmRemove(ingredient)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${ingredient.name}`}
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // A heading row in the merged list — populated (plain caption, matching
  // what used to render inline above an ingredient row) or declared-empty
  // (Recipe.emptySections: a real drop target, so it's a whole row rather than
  // a caption, with a hover-lit state and its own remove). Neither wires up
  // `drag`: a heading doesn't move by being picked up, only ingredients do.
  // ==== row renderers ====
  const renderHeadingRow = (row: Extract<MergedIngredientRow, { kind: 'heading' }>) => {
    if (!row.empty) {
      return <Text style={styles.ingredientSectionHeader}>{row.name}</Text>;
    }
    const isTarget = hoveredRowId === row.id;
    return (
      <View style={[styles.emptySectionRow, isTarget && styles.emptySectionRowTarget]}>
        <TouchableOpacity
          style={styles.emptySectionBody}
          activeOpacity={interaction.activeOpacity}
          onPress={() => {
            haptics.tap();
            setSectionDraft(row.name);
            draftInputRef.current?.focus();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${row.name}, no ingredients yet`}
          accessibilityHint="Double tap to start adding ingredients under this heading, or drag a row here"
        >
          <Text style={[styles.emptySectionTitle, isTarget && styles.emptySectionTitleTarget]}>
            {row.name}
          </Text>
          <Text style={[styles.emptySectionHint, isTarget && styles.emptySectionHintTarget]}>
            {isTarget ? 'Drop here' : 'Nothing here yet. Drag a row here'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { haptics.tap(); animateLayout(); removeEmptySection(recipe.id, row.name); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${row.name} heading`}
        >
          <Ionicons name="close" size={iconSize.sm} color={isTarget ? colors.accent : colors.textTertiary} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderMergedRow: SortableRenderItem<MergedIngredientRow> = (row, displayIndex, drag, isDragging) =>
    row.kind === 'heading'
      ? renderHeadingRow(row)
      : renderIngredient(row.ingredient, displayIndex, drag, isDragging);

  // A drag commit hands back the whole merged order; sectionsFromMergedOrder
  // is the one-pass walk that turns "which heading marker precedes this row"
  // into per-ingredient sections, and reorderIngredients applies both the new
  // order and those sections in a single write.
  const handleMergedReorder = (rows: MergedIngredientRow[]) => {
    const entries: SectionListEntry[] = rows.map(row =>
      row.kind === 'heading' ? { kind: 'heading', name: row.name } : { kind: 'row', id: row.id }
    );
    const sectionById = sectionsFromMergedOrder(entries);
    const ids = rows.filter((r): r is Extract<MergedIngredientRow, { kind: 'ingredient' }> => r.kind === 'ingredient')
      .map(r => r.id);
    reorderIngredients(recipe.id, ids, sectionById);
  };

  // A component row opens the recipe it points at, so the shared part is one
  // tap from the dish that uses it — editing it there is the whole feature.
  // A link whose recipe is gone can't be opened, only removed.
  //
  // `marker` renders the same row as it appears inside the Ingredients card
  // (see below) rather than in its own Components section: a leading badge
  // instead of no icon, and no remove-× — removing a component stays a
  // Components-section-only action, so there's exactly one place to do it,
  // even though there are now two places to *see* it.
  const renderComponent = (resolved: ResolvedComponent, marker = false) => {
    const target = resolved.recipe;
    const label = resolved.name || 'Deleted recipe';
    const groupHeader = componentGroups.headers.get(resolved.component.id);
    const group = resolved.component.choiceGroup;
    const isDefault = componentGroups.defaults.has(resolved.component.id);
    const alternativeNote = componentAlternatives.get(resolved.component.id);
    return (
      <View key={resolved.component.id}>
        {!!groupHeader && (
          <View style={styles.choiceHeader}>
            <Ionicons name="git-branch-outline" size={iconSize.xs} color={colors.accent} />
            <Text style={styles.choiceHeaderText} numberOfLines={1}>
              Choose one · {groupHeader}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.ingredient, !!group && styles.ingredientChoice]}
          activeOpacity={target ? interaction.activeOpacity : 1}
          disabled={!target}
          onPress={() => {
            if (!target) return;
            haptics.tap();
            // Same-route navigate, exactly as TemplateDetailScreen opens a nested
            // template: it swaps this screen's params rather than stacking a
            // second copy, so Back still means "back to the library".
            (navigation as any).navigate('RecipeDetail', { recipeId: target.id });
          }}
          // Long press is free on these rows (unlike an ingredient's, which
          // drags) and is where making this an either/or lives.
          onLongPress={() => { haptics.impactLight(); setChoiceComponent(resolved); }}
          delayLongPress={interaction.delayLongPress}
          accessibilityRole="button"
          accessibilityLabel={
            [
              marker ? 'Component' : null,
              label,
              group ? (isDefault ? `usual choice for ${group}` : `alternative for ${group}`) : null,
              target ? describeRecipe(target) : 'no longer in your recipes',
            ].filter(Boolean).join(', ')
          }
          accessibilityHint={
            target
              ? 'Double tap to open this recipe. Long press to make it an alternative.'
              : 'Long press to make it an alternative.'
          }
        >
          {marker && (
            <View style={styles.componentMarker}>
              <Ionicons name="restaurant-outline" size={12} color={colors.accent} />
            </View>
          )}
          <View style={styles.ingredientText}>
            <Text style={[styles.ingredientName, !target && styles.componentBrokenName]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.componentMeta} numberOfLines={1}>
              {target ? describeRecipe(target) : 'No longer in your recipes'}
            </Text>
            {!!alternativeNote && (
              <Text style={styles.alternativeNote} numberOfLines={1}>{alternativeNote}</Text>
            )}
          </View>
          {!!target && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
          {!marker && (
            <TouchableOpacity
              onPress={() => confirmRemoveComponent(resolved)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${label} from this recipe`}
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // No drag-to-reorder here — unlike ingredients, prep tasks don't read as a
  // list with a meaningful order (each just names its own day).
  const renderPrepTask = (prepTask: RecipePrepTask) => (
    <TouchableOpacity
      key={prepTask.id}
      style={styles.ingredient}
      activeOpacity={interaction.activeOpacity}
      onPress={() => { haptics.tap(); setEditingPrepTask(prepTask); }}
      accessibilityRole="button"
      accessibilityLabel={`${prepTask.title}, ${formatOffsetLabel(prepTask.offsetDays)}`}
      accessibilityHint="Double tap to edit"
    >
      <View style={styles.ingredientText}>
        <Text style={styles.ingredientName}>{prepTask.title}</Text>
      </View>
      <View style={styles.qtyPill}>
        <Text style={styles.qtyText} numberOfLines={1}>{formatOffsetLabel(prepTask.offsetDays)}</Text>
      </View>
      <TouchableOpacity
        onPress={() => confirmRemovePrepTask(prepTask)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${prepTask.title}`}
      >
        <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // Numbered by position rather than a stored index — the order lives in the
  // array, same as ingredients and components; a stored number would be a
  // second thing a reorder has to keep in step with the list.
  // The first duration only: the row is a one-line caption, and a step naming
  // three of them is answered by opening cook mode, which offers all three.
  const stepTimerLabel = (step: RecipeStep): string | null => {
    const [offer] = stepDurationOffers(step);
    return offer ? formatStepDuration(offer.seconds) : null;
  };

  const renderStep = (step: RecipeStep, displayIndex: number, drag: () => void) => (
    <View
      key={step.id}
      style={[styles.ingredient, editingStepId === step.id && styles.stepEditing]}
    >
      <Text style={styles.stepNumber}>{displayIndex + 1}</Text>
      <TouchableOpacity
        style={styles.ingredientText}
        activeOpacity={interaction.activeOpacity}
        onPress={() => beginEditStep(step)}
        accessibilityRole="button"
        accessibilityLabel={step.text}
        accessibilityHint="Double tap to edit"
      >
        <Text style={styles.ingredientName}>{step.text}</Text>
        {/* What cook mode will offer for this step, said on the row so the
            reading is visible before anyone is standing at a stove — and so a
            step the parse gets nothing out of is obvious while it's still
            being written. */}
        {stepTimerLabel(step) !== null && (
          <Text style={styles.stepTimerNote}>Timer · {stepTimerLabel(step)}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onLongPress={drag}
        delayLongPress={150}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Reorder step ${displayIndex + 1}`}
      >
        <Ionicons name="reorder-three" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => confirmRemoveStep(step)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove step ${displayIndex + 1}`}
      >
        <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );

  // ==== render. Everything below is JSX ====
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader
        title={recipe.name}
        onBack={() => navigation.goBack()}
        actions={
          <View style={styles.headerActions}>
            {recipe.ingredients.length > 0 && (
              <TouchableOpacity
                onPress={() => { haptics.tap(); selectionMode ? exitSelection() : enterSelectionMode(); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={selectionMode ? 'Done selecting' : 'Select ingredients'}
              >
                <Ionicons
                  name={selectionMode ? 'checkmark-circle' : 'checkmark-circle-outline'}
                  size={iconSize.md}
                  color={selectionMode ? colors.accent : colors.textSecondary}
                />
              </TouchableOpacity>
            )}
            {!selectionMode && !!anthropicApiKey && (
              <TouchableOpacity
                onPress={() => { haptics.tap(); setExtractVisible(true); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Fill in from a pasted recipe"
              >
                <Ionicons name="sparkles" size={iconSize.md} color={colors.purple} />
              </TouchableOpacity>
            )}
            {!selectionMode && (
              <TouchableOpacity
                onPress={() => { haptics.tap(); toggleFavorite(recipe.id); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={recipe.favorite ? 'Unstar this recipe' : 'Star this recipe'}
              >
                <Ionicons
                  name={recipe.favorite ? 'star' : 'star-outline'}
                  size={iconSize.md}
                  color={recipe.favorite ? colors.orange : colors.textSecondary}
                />
              </TouchableOpacity>
            )}
            {!selectionMode && (
              <TouchableOpacity
                onPress={handleShare}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Share this recipe"
              >
                <Ionicons name="share-outline" size={iconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            {!selectionMode && !!recipe.sourceUrl && (
              <TouchableOpacity
                onPress={handleOpenSourceUrl}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Open original recipe"
              >
                <Ionicons name="open-outline" size={iconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            {!selectionMode && (
              <TouchableOpacity
                onPress={() => { haptics.tap(); setEditorVisible(true); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Recipe Details"
              >
                <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <ScrollView
        ref={keyboardScroll.ref}
        scrollEnabled={!dragging}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        {...keyboardScroll.props}
      >
        {recipe.imagePath ? (
          <TouchableOpacity
            style={styles.hero}
            activeOpacity={interaction.activeOpacity}
            onPress={openImagePicker}
            disabled={pickingImage}
            accessibilityRole="button"
            accessibilityLabel="Change recipe photo"
          >
            <Image
              source={{ uri: resolveRecipeImagePath(recipe.imagePath) ?? undefined }}
              style={styles.heroImage}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          </TouchableOpacity>
        ) : pickingImage ? (
          <View style={styles.heroEmptyRow}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          // A small pill, not the full-width hero a photo gets once there is
          // one — a photo is optional, and the big empty box this used to be
          // read as the app expecting one. Same treatment "Add a component"
          // gets further down this screen.
          <InlineAction
            icon="camera-outline"
            label="Add a photo"
            variant="neutral"
            surface="page"
            onPress={openImagePicker}
          />
        )}

        <Text style={styles.summary}>{describeRecipe(recipe)}</Text>
        {/* Chips rather than another clause in the summary line above: tags are
            the cook's own words and there can be several, so they'd swamp a
            sentence whose other parts are all single facts. Not tappable —
            filtering by one is the recipe box's job, and a tap here that
            navigated back to it would take the recipe off screen. */}
        {recipe.tags.length > 0 && (
          <View style={styles.tagRow}>
            {recipe.tags.map(tag => (
              <View key={tag} style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}>
                <Text style={[styles.tagChipText, { color: tagColor(tag) }]}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
        {/* Steps below are the structured replacement for a method written into
            notes — showing both would say the same thing twice in two
            formats, so notes renders here only for a recipe that hasn't been
            given steps yet. Notes itself is untouched and still edits from
            RecipeEditor; a recipe with steps can still carry notes, they just
            don't auto-render as the method once steps exist. */}
        {recipe.steps.length === 0 && !!recipe.notes && <Text style={styles.notes}>{recipe.notes}</Text>}

        {totalTimeMinutes != null && (
          <Text style={styles.totalTimeSummary}>Total time {formatDuration(totalTimeMinutes)}</Text>
        )}
        {/* One card holding both, where each used to be a card of its own —
            see RecipeTimerRow. Two stopwatches are one subject, and stacked as
            two separate cards they read as two of the recipe's facts. */}
        <View style={styles.timerCard}>
          <RecipeTimerRow verb="Prep" {...prepTimer} />
          <View style={styles.timerDivider} />
          <RecipeTimerRow verb="Cook" {...cookTimer} />
          {/* Any step timer still counting down, on the same card as the two
              clocks it's running alongside. Cook mode is where these are
              started, and closing it is the ordinary thing to do while one
              runs — so this is where a cook who came back to the recipe finds
              them, rather than having to reopen cook mode to pause a pan. */}
          {stepTimers.timers.map(timer => (
            <React.Fragment key={timer.id}>
              <View style={styles.timerDivider} />
              <StepTimerRow
                timer={timer}
                now={stepTimers.now}
                hideRecipeName
                onToggle={() => stepTimers.toggle(timer)}
                onAddTime={() => stepTimers.addTime(timer.id)}
                onRestart={() => stepTimers.restart(timer.id)}
                onRemove={() => stepTimers.remove(timer.id)}
              />
            </React.Fragment>
          ))}
        </View>

        {/* The two ways the list leaves the app, on the card they act on
            rather than up in the screen header — that header's share button
            sends the whole recipe (name, method, source), and these send the
            ingredient lines alone, which is what another app's "paste your
            ingredients" box can actually read. Hidden while selecting, like
            every other action on this screen. */}
        <View style={styles.ingredientsHeaderRow}>
          <Text style={[styles.sectionLabel, styles.sectionLabelFlush]}>Ingredients</Text>
          {!selectionMode && !!ingredientsText && (
            <View style={styles.ingredientsHeaderActions}>
              <TouchableOpacity
                onPress={() => copyIngredients(ingredientsText)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Copy the ingredients as plain text"
              >
                <Ionicons
                  name={copiedIngredients ? 'checkmark' : 'copy-outline'}
                  size={iconSize.sm}
                  color={copiedIngredients ? colors.green : colors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShareIngredients}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Share the ingredients on their own"
              >
                <Ionicons name="share-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Above the list rather than up by the summary: it's the quantities
            below that visibly change, and a control that far from what it
            changes reads as another fact about the recipe. Gated the same as
            the empty hint below — a purely composed recipe (no lines of its
            own, all components) still has quantities to scale once its parts
            are flattened out at shopping time. */}
        {(recipe.ingredients.length > 0 || components.length > 0)
          && !featureHidden('recipeScaling', simpleMode) && (
          <RecipeScaleChips
            value={scale}
            onChange={setScale}
            baseServings={recipe.servings}
            baseServingsMax={recipe.servingsMax}
            style={styles.scaleRow}
          />
        )}
        {/* Live off the same scale chips above — a doubled dinner reads as a
            doubled cost. Renders nothing rather than a guess while too few
            lines are priced to say (see recipeCost.ts's coverage floor). */}
        {!!costLine && <Text style={styles.summary}>{costLine}</Text>}

        {/* Where a well-matched recipe says so. The per-row badge is reserved
            for lines with something to act on, so without this line a recipe
            whose every ingredient resolves looks identical to one the app has
            never been able to place — which is the confusion the whole feature
            started from. Doubles as the way into the review sheet, so the
            batch pass needs no menu item of its own. */}
        {catalogSummary.total > 0 && !selectionMode && (
          <TouchableOpacity
            style={styles.matchSummaryRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setMatchScopeIds(null); setMatchSheetOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={
              `${catalogSummary.linked} of ${catalogSummary.total} ingredients are in your groceries`
            }
            accessibilityHint="Double tap to review the ones that aren't"
          >
            <Ionicons name="basket-outline" size={iconSize.sm} color={colors.textSecondary} />
            <Text style={styles.matchSummaryText}>
              {catalogSummary.linked} of {catalogSummary.total} in your groceries
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {mergedIngredientRows.length === 0 && components.length === 0 ? (
          <Text style={styles.hint}>
            Type one ingredient at a time, or paste a whole list — “2 lb chicken thighs”
            keeps the quantity out of the name so the list stays tidy.
          </Text>
        ) : (
          <View style={styles.card}>
            {mergedIngredientRows.length > 0 && (
              <SortableList
                data={mergedIngredientRows}
                onReorder={handleMergedReorder}
                onDragStateChange={setDragging}
                onHoverChange={handleIngredientHoverChange}
                renderItem={renderMergedRow}
              />
            )}
            {/* Marked so a shared part reads as part of this recipe from the
                first list you'd check, not only several scrolls down in its
                own Components section (which stays the place to remove one or
                set a choice-group default). */}
            {components.map(resolved => renderComponent(resolved, true))}
          </View>
        )}

        {/* Rule 3 made visible: "a pinch" doubled is still "a pinch", and a cook
            reading a doubled list deserves to know which lines the app didn't do
            the arithmetic for rather than assuming it did. */}
        {!!unscaledNote && <Text style={styles.scaleNote}>{unscaledNote}</Text>}

        {/* Sits down here by the field that produced it rather than up at the
            top of the screen: the add field is the last thing on this screen,
            so after a paste that's where you're looking and a banner above the
            list would land off-screen. Accent-tinted, not the warning yellow —
            a pasted ingredient the app can't place is the ordinary case, not a
            problem to clear. */}
        {!!pasteResult && !selectionMode && (
          <View style={styles.pasteBanner}>
            <View style={styles.pasteBannerBody}>
              <Text style={styles.pasteBannerTitle}>
                {pasteResult.added} {pasteResult.added === 1 ? 'ingredient' : 'ingredients'} added
              </Text>
              <Text style={styles.pasteBannerDetail}>
                {pasteResult.unresolved}{' '}
                {pasteResult.unresolved === 1 ? "isn't" : "aren't"} in your groceries.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                haptics.tap();
                setMatchScopeIds(pasteResult.addedIds);
                setMatchSheetOpen(true);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Review the ingredients that aren't in your groceries"
            >
              <Text style={styles.pasteBannerAction}>Review</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { haptics.tap(); animateLayout(); setPasteResult(null); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Which heading newly-typed ingredients below file under — a picker
            over headings this recipe already has, not a field you type a new
            one into. That used to be free text, on the theory that a picker
            would be empty exactly when it's first needed; the grid's own
            "New section" reveal field (onCreate) removed that problem, so
            typing a heading here is deliberate and validated instead of a
            typo that mints one nothing else matches. Always shown, even with
            no sections yet, since this is now the only way to declare one —
            including a heading with nothing filed under it yet
            (Recipe.emptySections), if the field's blurred before an
            ingredient names it. Rows already on the list are moved between
            headings by dragging them, which is what the hint below says. */}
        <View style={styles.sectionPickerWrap}>
          <Text style={styles.inputHint}>New ingredients below go under:</Text>
          <PillGroup
            noun="section"
            surface="page"
            filterPlaceholder="Find or name a section…"
            createMaxLength={RECIPE_SECTION_MAX_LENGTH}
            onCreate={name => {
              const cleaned = name.trim();
              if (allSections.includes(cleaned)) return 'Already a heading on this recipe.';
              if (!addEmptySection(recipe.id, name)) return 'That isn’t a usable section name.';
              haptics.success();
              setSectionDraft(cleaned.slice(0, RECIPE_SECTION_MAX_LENGTH));
            }}
            options={[
              {
                key: '__none__',
                label: 'No section',
                pinned: true,
                selected: !sectionDraft,
                onPress: () => { haptics.tap(); setSectionDraft(''); },
              },
              ...allSections.map(name => ({
                key: name,
                label: name,
                selected: sectionDraft === name,
                onPress: () => { haptics.tap(); setSectionDraft(name); },
              })),
            ]}
          />
        </View>
        {/* Only once there's a heading to drag under. Sections are a label on a
            flat list, so the order *is* the grouping — this is the one place
            that's worth saying out loud, since nothing about a row suggests
            dragging it changes which heading it sits below. */}
        {allSections.length > 0 && (
          <Text style={styles.inputHint}>
            Drag an ingredient under a heading to move it there.
          </Text>
        )}

        <View style={styles.addRow}>
          <TextInput
            ref={draftInputRef}
            style={styles.addInput}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            placeholder="Add an ingredient"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_NAME_MAX_LENGTH * 4}
            multiline
            returnKeyType="done"
            autoCapitalize="none"
            accessibilityLabel="Add an ingredient"
          />
          <InlineAction
            label="Add"
            icon="add"
            onPress={submitDraft}
            disabled={!draft.trim()}
          />
        </View>
        <Text style={styles.inputHint}>
          Quantity and unit go first, e.g. “2 cups flour” — add a comma for prep, e.g.
          “garlic, minced”
        </Text>

        <Text style={styles.sectionLabel}>Steps</Text>

        {recipe.steps.length === 0 ? (
          <Text style={styles.hint}>
            Write the method as steps instead of one block of notes, and it stays legible
            when the recipe's scaled or shown in a different unit. Notes still works if you'd
            rather leave it as one block.
          </Text>
        ) : (
          <View style={styles.card}>
            <SortableList
              data={recipe.steps}
              onReorder={reordered => reorderSteps(recipe.id, reordered.map(s => s.id))}
              onDragStateChange={setDragging}
              renderItem={renderStep}
            />
          </View>
        )}

        <View style={styles.addRow}>
          <TextInput
            ref={stepInputRef}
            style={styles.addInput}
            value={stepDraft}
            onChangeText={setStepDraft}
            onSubmitEditing={submitStepDraft}
            placeholder={editingStepId ? 'Edit this step' : 'Add a step'}
            placeholderTextColor={colors.textTertiary}
            multiline
            blurOnSubmit
            returnKeyType="done"
            accessibilityLabel={editingStepId ? 'Edit step' : 'Add a step'}
          />
          {editingStepId && (
            <TouchableOpacity
              onPress={cancelEditStep}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing this step"
            >
              <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          <InlineAction
            label={editingStepId ? 'Save' : 'Add'}
            icon={editingStepId ? 'checkmark' : 'add'}
            onPress={submitStepDraft}
            disabled={!stepDraft.trim()}
          />
        </View>

        {/* Only while a step is open for editing. Cook mode reads the length out
            of the sentence for nearly every step, so a control asking for it
            again on every row would be a second copy of a number that's already
            written down — this is here for the step that doesn't give one, and
            the step whose wording the reading gets wrong. */}
        {editingStep !== null && (
          <>
            <View style={styles.stepTimerEditRow}>
              <Text style={styles.stepTimerEditLabel}>Timer length</Text>
              <CountStepper
                value={editingStep.timerSeconds != null ? Math.max(1, Math.round(editingStep.timerSeconds / 60)) : null}
                onChange={next => setStepTimerSeconds(recipe.id, editingStep.id, next === null ? null : next * 60)}
                min={1}
                max={MAX_STEP_TIMER_SECONDS / 60}
                allowNull
                emptyLabel={editingStepParsed ? `${formatStepDuration(editingStepParsed.seconds)} from the text` : 'None'}
                format={n => formatStepDuration(n * 60)}
                label="step timer length"
                describeValue={n => (n === null
                  ? (editingStepParsed ? 'Read from the step text' : 'No timer')
                  : `${n} minutes`)}
              />
            </View>
            <Text style={styles.inputHint}>
              Cook mode offers a timer for the time written in the step. Set a length here to
              use it instead.
            </Text>
          </>
        )}

        {/* The whole section goes in simplified mode, unless this recipe already
            uses components — a composed recipe that couldn't show its parts
            would be missing half its ingredients with nothing to say why. */}
        {featureShown('recipeComposition', simpleMode, components.length > 0) && (
        <>
        <Text style={styles.sectionLabel}>Components</Text>

        {components.length === 0 ? (
          <Text style={styles.hint}>
            Use another recipe as part of this one — the mashed potatoes that go with both
            the steak and the salmon. Its ingredients and prep tasks come along, and editing
            it once updates every meal that uses it. Long press a component to make it an
            either/or alternative, like mashed potatoes or roast potatoes.
          </Text>
        ) : (
          <View style={styles.card}>
            {components.map(resolved => renderComponent(resolved))}
          </View>
        )}

        <View style={styles.addRow}>
          <InlineAction
            label="Add a component"
            icon="add"
            onPress={() => { haptics.tap(); setComponentPickerVisible(true); }}
          />
        </View>
        </>
        )}

        <Text style={styles.sectionLabel}>Prep tasks</Text>

        {recipe.prepTasks.length === 0 ? (
          <Text style={styles.hint}>
            Add a reminder for anything that needs doing ahead of the meal — “Marinate the
            chicken” a day before, say — and it'll turn into a Task once this recipe is
            planned for a date.
          </Text>
        ) : (
          <View style={styles.card}>
            {recipe.prepTasks.map(renderPrepTask)}
          </View>
        )}

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={prepDraft}
            onChangeText={setPrepDraft}
            onSubmitEditing={submitPrepDraft}
            placeholder="Add a prep task"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX_LENGTH}
            blurOnSubmit
            returnKeyType="done"
            accessibilityLabel="Add a prep task"
          />
          <InlineAction
            label="Add"
            icon="add"
            onPress={submitPrepDraft}
            disabled={!prepDraft.trim()}
          />
        </View>

        {/* Clears the floating bulk bar, which takes the footer's place while
            selecting — see below. */}
        {selectionMode && (
          <View style={{ height: insets.bottom + spacing.sm + bulkBarHeight + spacing.sm }} />
        )}
      </ScrollView>

      {/* Hidden while selecting: the bulk bar floats where it does, and adding
          to the list isn't something you're doing mid-selection anyway. */}
      {!selectionMode && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          {/* Planning and shopping are peers here — the two things you do
              having decided to cook something — so they share the footer rather
              than one of them going up into an already-crowded header. Plan is
              the quieter of the two: the list is what this screen has always
              been for, and shopping is the step that can't be undone by a tap.
              Cook joined them as the third verb (#1695), for the same reason
              and in the same place: it's the one that happens *now*, so it
              leads. Its label is a word where the others are two, which is what
              keeps three buttons on a 390pt line. */}
          {cookableCount > 0 && !featureHidden('cookMode', simpleMode) && (
            <TouchableOpacity
              style={styles.secondary}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setCookModeVisible(true); }}
              accessibilityRole="button"
              accessibilityLabel={`Cook ${recipe.name} one step at a time`}
            >
              <Ionicons name="flame-outline" size={iconSize.sm} color={colors.accent} />
              <Text style={styles.secondaryText}>Cook</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.secondary}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setPlanVisible(true); }}
            accessibilityRole="button"
            accessibilityLabel={`Plan ${recipe.name} onto a day`}
          >
            <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.accent} />
            <Text style={styles.secondaryText}>Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primary, shoppableCount === 0 && styles.primaryOff]}
            activeOpacity={interaction.activeOpacity}
            onPress={addToList}
            disabled={shoppableCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Add ingredients to the grocery list"
          >
            <Ionicons name="cart-outline" size={iconSize.sm} color={colors.onAccent} />
            {/* "Add to list" rather than the "Add ingredients to list" this said
                until Cook joined the row: three buttons don't fit a 390pt line
                at the longer label, and the cart glyph beside it already says
                which list. The accessibility label keeps the full sentence. */}
            <Text style={styles.primaryText}>Add to list</Text>
          </TouchableOpacity>
        </View>
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={recipe.ingredients.length}
          category={{
            title: 'Move to Aisle',
            options: aisleOrder,
            onSet: handleBulkSetAisle,
            onCreate: name => addAisle(name),
            allowNone: false,
          }}
          actions={[
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkRemoveIngredients },
          ]}
          onSelectAll={() => selectAll(recipe.ingredients.map(i => i.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={insets.bottom}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <RecipeEditor
        visible={editorVisible}
        recipe={recipe}
        onClose={() => setEditorVisible(false)}
        onDeleted={() => { setEditorVisible(false); navigation.goBack(); }}
      />

      <RecipeIngredientSheet
        visible={editingIngredient !== null}
        recipeId={recipe.id}
        ingredient={editingIngredient}
        onClose={() => setEditingIngredient(null)}
      />

      <IngredientCatalogMatchSheet
        visible={matchSheetOpen}
        recipeId={recipe.id}
        scopeIds={matchScopeIds}
        onClose={() => setMatchSheetOpen(false)}
        onEditIngredient={ingredient => {
          // Closes itself first: two Modals presented from one parent is the
          // second one asking a presenter that's already presenting, so the
          // ingredient sheet opens as this one leaves rather than on top of it.
          setMatchSheetOpen(false);
          setEditingIngredient(ingredient);
        }}
      />

      <PrepTaskSheet
        visible={editingPrepTask !== null}
        recipeId={recipe.id}
        prepTask={editingPrepTask}
        onClose={() => setEditingPrepTask(null)}
      />

      <PlanMealSheet
        visible={planVisible}
        title={recipe.name}
        onPlan={(dateKey, slot) => planRecipe(recipe, dateKey, slot)}
        // After the dismissal, never before — see PlanRecipeSheet.onPlanned.
        onPlanned={offerPrepTasks}
        onClose={() => setPlanVisible(false)}
      />

      <RecipeToListSheet
        visible={addToListVisible}
        recipe={recipe}
        recipesById={recipesById}
        initialScale={scale}
        onClose={() => setAddToListVisible(false)}
      />

      <RecipeExtractSheet
        visible={extractVisible}
        recipe={recipe}
        onClose={() => setExtractVisible(false)}
      />

      {/* The scale travels in, the way it does into the add-to-list sheet — a
          halved recipe has to read halved mid-step too. Nothing travels back:
          cook mode writes nothing but the timer the recipe already owns. */}
      <CookModeSheet
        visible={cookModeVisible}
        recipe={recipe}
        recipesById={recipesById}
        scale={scale}
        onClose={() => setCookModeVisible(false)}
      />

      <ComponentChoiceSheet
        visible={choiceComponent !== null}
        recipe={recipe}
        component={choiceComponent}
        onClose={() => setChoiceComponent(null)}
      />

      <RecipeComponentPicker
        visible={componentPickerVisible}
        recipe={recipe}
        onClose={() => setComponentPickerVisible(false)}
        onSelect={component => {
          animateLayout();
          // The picker already disabled everything addComponent would refuse,
          // so a false here means the library moved under the sheet — nothing
          // to explain, and nothing added.
          addComponent(recipe.id, component.id);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scroll: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  hero: {
    height: 180,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  // Matches InlineAction's own minHeight, so the "Add a photo" pill doesn't
  // jump in height for the moment it's swapped for a spinner mid-pick.
  heroEmptyRow: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  summary: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  // Same tag chip as TaskEditor's and the recipe editor's, minus the remove
  // affordance — these are a read of the recipe, edited from the editor sheet.
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  tagChipText: {
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  notes: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: font.md * 1.4,
  },
  totalTimeSummary: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  // The Ingredients label and its copy/share buttons on one line. The row
  // carries the label's own top margin, so the label goes flush inside it and
  // the icons sit level with the text rather than pushed down by it.
  ingredientsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  sectionLabelFlush: {
    marginTop: 0,
  },
  ingredientsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    lineHeight: font.sm * 1.4,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  // Both timers, one card. The card owns the padding and the rows own their
  // own vertical rhythm, so the two sit as a pair rather than as two facts.
  timerCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  timerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  // A component heading ("For the cake") inside the ingredients card — same
  // uppercase treatment as sectionLabel, just scoped to sit above a run of
  // rows rather than the whole list.
  ingredientSectionHeader: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  // A declared-but-empty heading (Recipe.emptySections). Dashed and inset,
  // unlike an ordinary row, so it reads as a slot rather than a line of the
  // recipe — the same signal an empty state elsewhere in the app gives with a
  // dashed outline, here doing double duty as "this is a real drop target,"
  // not just "there's nothing here yet".
  emptySectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.separator,
  },
  // The live drop-target state, set from SortableList's onHoverChange while a
  // dragged ingredient sits over this heading — the same feedback a populated
  // heading gets for free from its neighbours visibly opening a gap, made
  // explicit here since an empty heading has no neighbours of its own to move.
  emptySectionRowTarget: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent,
  },
  emptySectionBody: {
    flex: 1,
    gap: 1,
  },
  // Same treatment as ingredientSectionHeader, minus the padding that style
  // bakes in for sitting directly in the card — this one nests inside
  // emptySectionBody instead.
  emptySectionTitle: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  emptySectionTitleTarget: {
    color: colors.accent,
  },
  emptySectionHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontStyle: 'italic',
  },
  emptySectionHintTarget: {
    color: colors.accent,
    fontStyle: 'normal',
    fontWeight: fontWeight.semibold,
  },
  ingredient: {
    flexDirection: 'row',
    // flex-start, not center: the name wraps instead of truncating (see
    // ingredientName), and centering would drift the qty pill and remove
    // button downward as a wrapped name grows past two lines.
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  ingredientDragging: {
    backgroundColor: colors.bgTertiary,
  },
  ingredientSelected: {
    backgroundColor: colors.accent + '1A',
  },
  // The row currently loaded into the add/edit field below — same tint
  // `ingredientSelected` uses, so "this is the one you're changing" reads the
  // same way selection already does on this screen.
  stepEditing: {
    backgroundColor: colors.accent + '1A',
  },
  // Fixed width so a run of 1–20 doesn't shift the text beside it as the
  // digit count grows; right-aligned so the numbers themselves stay flush
  // against the text they number.
  stepTimerNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: 2,
  },
  stepTimerEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stepTimerEditLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  stepNumber: {
    width: 20,
    textAlign: 'right',
    color: colors.textTertiary,
    fontSize: font.md,
    fontVariant: ['tabular-nums'],
  },
  // Sits at the row's top edge rather than centered, matching the row's own
  // flex-start alignment — see the note on `ingredient` above.
  ingredientSelect: {
    width: 22,
    height: 22,
  },
  ingredientText: {
    flex: 1,
    gap: 1,
  },
  ingredientName: {
    color: colors.text,
    fontSize: font.md,
  },
  ingredientPrep: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontStyle: 'italic',
  },
  // Upright and a step brighter than the prep line above it, which is tertiary
  // italic: prep is a note about this line, "or manchego" is a fact about what
  // you're allowed to leave in the shop.
  alternativeNote: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  // Accent, matching the tint a scaled or converted quantity pill takes: both
  // mean "the app's words, not the recipe's". Brighter than `alternativeNote`
  // beneath it on purpose — an alternative is something the recipe offers, a
  // swap is something the app did.
  swapNote: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  choiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    // Same rule down the same edge as ingredientChoice below: the header
    // names the group the border is drawn for, so the rule belongs to it too,
    // not just to the rows underneath.
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  choiceHeaderText: {
    flex: 1,
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  // A rule down the leading edge, not a fill: a brighter card surface is what
  // this app uses for pressed and dragged (see TaskGroupHeader's note), so
  // tinting these rows would read as three rows stuck in a selected state.
  // The rule says "these go together" without claiming anything else.
  ingredientChoice: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  // Tinted pill rather than a line of accent text, because it is a control and
  // controls in this app get a shape (see the InlineAction note in CLAUDE.md).
  // alignSelf keeps it the width of its label — stretched to the row it would
  // read as a banner across the ingredient rather than a chip hanging off it.
  splitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingLeft: spacing.xs + 2,
    paddingRight: spacing.sm,
    marginTop: spacing.xs,
  },
  splitPillText: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  // Deliberately identical to splitPill: the two are the same kind of thing —
  // an offer the row makes, confirmed in the sheet it opens — and giving the
  // second one its own treatment would say they differ in some way they don't.
  // They can never appear on the same row (see catalogSuggestion), so there is
  // nothing to tell apart at a glance.
  matchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingLeft: spacing.xs + 2,
    paddingRight: spacing.sm,
    marginTop: spacing.xs,
  },
  matchPillText: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    // Capped so a long catalog name can't push the quantity pill off a narrow
    // row; the sheet it opens shows the name in full.
    maxWidth: 180,
  },
  // The count above the ingredients list. Reads as a quiet caption rather than
  // a card, because it sits between the cost line and the list itself and a
  // third card there would make the list look like it starts twice.
  matchSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  matchSummaryText: {
    flex: 1,
    fontSize: font.sm,
    color: colors.textSecondary,
  },
  pasteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  pasteBannerBody: { flex: 1, gap: 2 },
  pasteBannerTitle: { fontSize: font.sm, fontWeight: fontWeight.medium, color: colors.text },
  pasteBannerDetail: { fontSize: font.xs, color: colors.textSecondary },
  pasteBannerAction: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.accent },
  componentBrokenName: {
    color: colors.textTertiary,
  },
  // The badge that marks a component row where it's embedded in the
  // Ingredients card — same restaurant-outline glyph RecipeComponentPicker
  // uses for "this represents a recipe", shrunk to sit inline in a row this
  // dense. Sits at the row's top edge like ingredientSelect, for the same
  // flex-start reason.
  componentMarker: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ingredientPrep's twin without the italic: a component's subtitle is a
  // summary of another recipe, not a prep clause on this one.
  componentMeta: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  qtyPill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  // A tint rather than the filled accent the chips use: every quantity in the
  // list is scaled at once, and a column of solid accent pills would read as a
  // column of buttons.
  qtyPillScaled: { backgroundColor: colors.accent + '26' },
  qtyText: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  qtyTextScaled: { color: colors.accent, fontWeight: fontWeight.medium },
  scaleRow: { marginTop: spacing.xs, marginBottom: spacing.sm },
  scaleNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.xs,
  },
  // Wraps the "new ingredients file under" picker so its caption and pills
  // read as one control.
  sectionPickerWrap: {
    marginTop: spacing.md,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  inputHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.xs,
  },
  addInput: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: font.md,
    minHeight: 40,
    maxHeight: 140,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    backgroundColor: colors.bg,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  secondaryText: {
    color: colors.accent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  primary: {
    // Takes the rest of the row beside Plan.
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  primaryOff: {
    opacity: 0.4,
  },
  primaryText: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
