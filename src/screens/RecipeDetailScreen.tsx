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
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeIngredient, RecipePrepTask } from '../types';
import { GROCERY_NAME_MAX_LENGTH, RECIPE_SECTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRowSelection } from '../hooks/useRowSelection';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PressableScale } from '../components/PressableScale';
import { SortableList } from '../components/SortableList';
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
import { RecipeTimerRow } from '../components/RecipeTimerRow';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { pickRecipeImage, type RecipePhotoSource } from '../utils/recipePhoto';
import { describeCookTime, describePrepTime, describeRecipe, totalMinutes } from '../utils/recipeUtils';
import { describeUnscaled, scaleQuantity } from '../utils/recipeScale';
import { convertQuantity } from '../utils/unitConvert';
import { RecipeScaleChips } from '../components/RecipeScaleChips';
import { tagColor } from '../utils/tagColor';
import { formatDuration } from '../utils/effort';
import {
  cookTimerElapsed,
  cookTimerProgress,
  cookTimerRemaining,
  hasCookTimer,
  isCookTimerReady,
  isCookTimerRunning,
  prepTimerElapsed,
  prepTimerProgress,
  prepTimerRemaining,
  hasPrepTimer,
  isPrepTimerReady,
  isPrepTimerRunning,
} from '../utils/recipeTimer';
import {
  alternativeCaptions,
  flattenRecipeIngredients,
  recipeMap,
  resolveComponents,
  type ResolvedComponent,
} from '../utils/recipeComponents';
import { formatOffsetLabel } from '../utils/templateUtils';
import { splitAlternativeNames, splitGroceryLines } from '../utils/groceryParse';

type RootStackParamList = {
  RecipeDetail: { recipeId: string };
};

export function RecipeDetailScreen() {
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
  const toggleFavorite = useRecipeStore(s => s.toggleFavorite);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const removePrepTask = useRecipeStore(s => s.removePrepTask);
  const setImage = useRecipeStore(s => s.setImage);
  const startCookTimer = useRecipeStore(s => s.startCookTimer);
  const pauseCookTimer = useRecipeStore(s => s.pauseCookTimer);
  const resetCookTimer = useRecipeStore(s => s.resetCookTimer);
  const stopCookTimer = useRecipeStore(s => s.stopCookTimer);
  const logManualCookTime = useRecipeStore(s => s.logManualCookTime);
  const startPrepTimer = useRecipeStore(s => s.startPrepTimer);
  const pausePrepTimer = useRecipeStore(s => s.pausePrepTimer);
  const resetPrepTimer = useRecipeStore(s => s.resetPrepTimer);
  const stopPrepTimer = useRecipeStore(s => s.stopPrepTimer);
  const logManualPrepTime = useRecipeStore(s => s.logManualPrepTime);
  const addComponent = useRecipeStore(s => s.addComponent);
  const removeComponent = useRecipeStore(s => s.removeComponent);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addAisle = useGroceryStore(s => s.addAisle);

  const recipesById = useMemo(() => recipeMap(recipes), [recipes]);
  const components = useMemo(
    () => (recipe ? resolveComponents(recipe, recipesById) : []),
    [recipe, recipesById]
  );
  // What the grocery add is actually going to offer — the recipe's own lines
  // plus every component's, which is the number the footer button gates on.
  const shoppableCount = useMemo(
    () => (recipe ? flattenRecipeIngredients(recipe, recipesById).length : 0),
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

  const [draft, setDraft] = useState('');
  // What new ingredients are filed under, until changed or cleared — the add
  // field's own equivalent of RecipeIngredientSheet's Section field, so a
  // section can be started here instead of only discoverable by editing a
  // row after the fact. Free text, not a picker: nothing enumerates the
  // sections a recipe has, the same way nothing enumerates aisle names.
  const [sectionDraft, setSectionDraft] = useState('');
  const [pickingImage, setPickingImage] = useState(false);
  const draftInputRef = useRef<TextInput>(null);
  const [prepDraft, setPrepDraft] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  const [editingPrepTask, setEditingPrepTask] = useState<RecipePrepTask | null>(null);
  const [addToListVisible, setAddToListVisible] = useState(false);
  const [planVisible, setPlanVisible] = useState(false);
  const { planRecipe, offerPrepTasks } = usePlanMeal();
  const [extractVisible, setExtractVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [componentPickerVisible, setComponentPickerVisible] = useState(false);
  const [choiceComponent, setChoiceComponent] = useState<ResolvedComponent | null>(null);
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

  // Tick once a second while either timer runs, mirroring TaskItem's own
  // timer clock — everything else is recomputed from the stored fields
  // against nowTick rather than counted down in state, so this reads right
  // even after the app was backgrounded or killed mid-cook (or mid-prep).
  const [nowTick, setNowTick] = useState(() => Date.now());
  const cookRunning = recipe ? isCookTimerRunning(recipe) : false;
  const prepRunning = recipe ? isPrepTimerRunning(recipe) : false;
  useEffect(() => {
    if (!cookRunning && !prepRunning) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cookRunning, prepRunning, recipe?.timerStartedAt, recipe?.prepTimerStartedAt]);

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

  const cookHasTarget = hasCookTimer(recipe);
  const cookElapsedSeconds = cookTimerElapsed(recipe, nowTick);
  const cookRemainingSeconds = cookHasTarget ? cookTimerRemaining(recipe, nowTick) : 0;
  const cookProgress = cookHasTarget ? cookTimerProgress(recipe, nowTick) : 0;
  const cookReady = cookHasTarget && isCookTimerReady(recipe, nowTick);
  const cookPaused = !cookRunning && recipe.timerElapsedSeconds > 0;
  const cookInProgress = cookRunning || recipe.timerElapsedSeconds > 0;
  const cookTimeSummary = describeCookTime(recipe);

  const handleCookTimerToggle = async () => {
    if (cookRunning) {
      await haptics.success();
      pauseCookTimer(recipe.id);
    } else {
      await haptics.impactMedium();
      startCookTimer(recipe.id);
    }
  };

  const handleLogCookTime = async () => {
    await haptics.success();
    stopCookTimer(recipe.id);
  };

  const handleResetCookTimer = async () => {
    await haptics.warning();
    resetCookTimer(recipe.id);
  };

  const handleLogManualCookTime = async (minutes: number) => {
    await haptics.success();
    logManualCookTime(recipe.id, minutes);
  };

  const prepHasTarget = hasPrepTimer(recipe);
  const prepElapsedSeconds = prepTimerElapsed(recipe, nowTick);
  const prepRemainingSeconds = prepHasTarget ? prepTimerRemaining(recipe, nowTick) : 0;
  const prepProgress = prepHasTarget ? prepTimerProgress(recipe, nowTick) : 0;
  const prepReady = prepHasTarget && isPrepTimerReady(recipe, nowTick);
  const prepPaused = !prepRunning && recipe.prepTimerElapsedSeconds > 0;
  const prepInProgress = prepRunning || recipe.prepTimerElapsedSeconds > 0;
  const prepTimeSummary = describePrepTime(recipe);
  const totalTimeMinutes = totalMinutes(recipe);

  const handlePrepTimerToggle = async () => {
    if (prepRunning) {
      await haptics.success();
      pausePrepTimer(recipe.id);
    } else {
      await haptics.impactMedium();
      startPrepTimer(recipe.id);
    }
  };

  const handleLogPrepTime = async () => {
    await haptics.success();
    stopPrepTimer(recipe.id);
  };

  const handleResetPrepTimer = async () => {
    await haptics.warning();
    resetPrepTimer(recipe.id);
  };

  const handleLogManualPrepTime = async (minutes: number) => {
    await haptics.success();
    logManualPrepTime(recipe.id, minutes);
  };

  const submitDraft = () => {
    const text = draft;
    if (!text.trim()) return;
    animateLayout();
    const section = sectionDraft.trim() || null;
    // A multi-line paste is the common way a recipe arrives, so one field
    // handles both — splitGroceryLines tells them apart.
    const added = splitGroceryLines(text).length > 1
      ? addIngredientsFromText(recipe.id, text, section)
      : (addIngredient(recipe.id, text, section) ? 1 : 0);
    setDraft('');
    if (added > 0) haptics.tap();
    else haptics.warning();
    // Keep the keyboard up so adding several ingredients in a row doesn't
    // need a re-tap of the field each time — see the chain-step add input
    // in TaskEditor for the same pattern. The short delay lets the field's
    // own submit-triggered blur settle before we pull focus back.
    setTimeout(() => {
      draftInputRef.current?.focus();
    }, 50);
  };

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
  // Which ingredients open a new section heading — the first row (in stored
  // order) whose section differs from the row right before it. A label on a
  // flat list rather than a nested groups type, so this is display-only: the
  // underlying array (and every non-UI reader of it) stays exactly what it
  // was. Keyed off recipe.ingredients rather than SortableList's mid-drag
  // order, so a header doesn't flicker as a row is dragged past it — it only
  // moves once the drop actually commits.
  const ingredientSectionHeaders = useMemo(() => {
    const headers = new Map<string, string>();
    let prevSection: string | null = null;
    for (const ing of recipe.ingredients) {
      if (ing.section && ing.section !== prevSection) headers.set(ing.id, ing.section);
      prevSection = ing.section;
    }
    return headers;
  }, [recipe.ingredients]);

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
    const scaledResult = scaleQuantity(ingredient.quantity, scale);
    const convertedResult = convertQuantity(scaledResult.text, unitSystem);
    const scaledQuantity = convertedResult.text;
    const scaledHere = scaledResult.scaled || convertedResult.converted;
    const sectionHeader = ingredientSectionHeaders.get(ingredient.id);
    // A line can open both: the section it belongs to, then the either/or slot
    // it fills within that section.
    const choiceHeader = ingredientGroups.headers.get(ingredient.id);
    const choiceGroup = ingredient.choiceGroup;
    const isChoiceDefault = ingredientGroups.defaults.has(ingredient.id);
    const alternativeNote = ingredientAlternatives.get(ingredient.id);
    const splitInto = splittableCounts.get(ingredient.id);
    return (
      <View>
        {!!sectionHeader && <Text style={styles.ingredientSectionHeader}>{sectionHeader}</Text>}
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
            [ingredient.section, ingredient.name, scaledQuantity, ingredient.prep,
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
            <Text style={styles.ingredientName}>{ingredient.name}</Text>
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
                onPress={() => { haptics.tap(); setEditorVisible(true); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Recipe settings"
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
              source={{ uri: recipe.imagePath }}
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
        {!!recipe.notes && <Text style={styles.notes}>{recipe.notes}</Text>}

        {totalTimeMinutes != null && (
          <Text style={styles.totalTimeSummary}>Total time {formatDuration(totalTimeMinutes)}</Text>
        )}
        {/* One card holding both, where each used to be a card of its own —
            see RecipeTimerRow. Two stopwatches are one subject, and stacked as
            two separate cards they read as two of the recipe's facts. */}
        <View style={styles.timerCard}>
        <RecipeTimerRow
          verb="Prep"
          targetMinutes={recipe.prepMinutes}
          running={prepRunning}
          paused={prepPaused}
          inProgress={prepInProgress}
          ready={prepReady}
          elapsedSeconds={prepElapsedSeconds}
          remainingSeconds={prepRemainingSeconds}
          progress={prepProgress}
          summary={prepTimeSummary}
          onToggle={handlePrepTimerToggle}
          onLog={handleLogPrepTime}
          onReset={handleResetPrepTimer}
          onLogManual={handleLogManualPrepTime}
        />
        <View style={styles.timerDivider} />
        <RecipeTimerRow
          verb="Cook"
          targetMinutes={recipe.estimatedMinutes}
          running={cookRunning}
          paused={cookPaused}
          inProgress={cookInProgress}
          ready={cookReady}
          elapsedSeconds={cookElapsedSeconds}
          remainingSeconds={cookRemainingSeconds}
          progress={cookProgress}
          summary={cookTimeSummary}
          onToggle={handleCookTimerToggle}
          onLog={handleLogCookTime}
          onReset={handleResetCookTimer}
          onLogManual={handleLogManualCookTime}
        />
        </View>

        <Text style={styles.sectionLabel}>Ingredients</Text>

        {/* Above the list rather than up by the summary: it's the quantities
            below that visibly change, and a control that far from what it
            changes reads as another fact about the recipe. Gated the same as
            the empty hint below — a purely composed recipe (no lines of its
            own, all components) still has quantities to scale once its parts
            are flattened out at shopping time. */}
        {(recipe.ingredients.length > 0 || components.length > 0) && (
          <RecipeScaleChips
            value={scale}
            onChange={setScale}
            baseServings={recipe.servings}
            baseServingsMax={recipe.servingsMax}
            style={styles.scaleRow}
          />
        )}

        {recipe.ingredients.length === 0 && components.length === 0 ? (
          <Text style={styles.hint}>
            Type one ingredient at a time, or paste a whole list — “2 lb chicken thighs”
            keeps the quantity out of the name so the list stays tidy.
          </Text>
        ) : (
          <View style={styles.card}>
            {recipe.ingredients.length > 0 && (
              <SortableList
                data={recipe.ingredients}
                onReorder={next => reorderIngredients(recipe.id, next.map(i => i.id))}
                onDragStateChange={setDragging}
                renderItem={renderIngredient}
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

        {/* Sets a heading for ingredients added below, the same "section" field
            RecipeIngredientSheet has always had — just reachable from the add
            flow itself instead of only by opening an existing row afterward.
            Free text and sticky rather than a one-shot prompt: typing "For the
            cake" once, adding those lines, then changing it to "For the
            frosting" is how a recipe with several sections actually gets
            typed in, and it needs no cleanup — leave it blank to file plain.
            Rows already on the list are moved between headings by dragging
            them, which is what the hint below says. */}
        <View style={styles.sectionDraftRow}>
          <Ionicons name="albums-outline" size={iconSize.sm} color={colors.textTertiary} />
          <TextInput
            style={styles.sectionDraftInput}
            value={sectionDraft}
            onChangeText={setSectionDraft}
            placeholder="Heading for what you add below"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_SECTION_MAX_LENGTH}
            returnKeyType="done"
            autoCapitalize="words"
            accessibilityLabel="Section for new ingredients"
          />
          {!!sectionDraft && (
            <TouchableOpacity
              onPress={() => setSectionDraft('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear section"
            >
              <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
        {/* Only once there's a heading to drag under. Sections are a label on a
            flat list, so the order *is* the grouping — this is the one place
            that's worth saying out loud, since nothing about a row suggests
            dragging it changes which heading it sits below. */}
        {ingredientSectionHeaders.size > 0 && (
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

        <Text style={styles.sectionLabel}>Components</Text>

        {components.length === 0 ? (
          <Text style={styles.hint}>
            Use another recipe as part of this one — the mash that goes with both the steak
            and the salmon. Its ingredients and prep tasks come along, and editing it once
            updates every meal that uses it. Long press a component to make it an either/or
            alternative, like mash or roast potatoes.
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
              been for, and shopping is the step that can't be undone by a tap. */}
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
            <Text style={styles.primaryText}>Add ingredients to list</Text>
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
  choiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
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
  // Quieter than addInput below it — this sets where an ingredient files,
  // not the ingredient itself, so it reads as a modifier on the row beneath
  // rather than a second thing to fill in.
  sectionDraftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  sectionDraftInput: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    paddingVertical: 6,
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
