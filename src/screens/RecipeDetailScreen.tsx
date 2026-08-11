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
import { GROCERY_NAME_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { SortableList } from '../components/SortableList';
import { RecipeEditor } from '../components/RecipeEditor';
import { RecipeIngredientSheet } from '../components/RecipeIngredientSheet';
import { PrepTaskSheet } from '../components/PrepTaskSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { RecipeExtractSheet } from '../components/RecipeExtractSheet';
import { ProgressBar } from '../components/ProgressBar';
import { RecipeComponentPicker } from '../components/RecipeComponentPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { pickRecipeImage, type RecipePhotoSource } from '../utils/recipePhoto';
import { describeCookTime, describeRecipe } from '../utils/recipeUtils';
import { formatDuration, formatStopwatch } from '../utils/effort';
import {
  cookTimerElapsed,
  cookTimerProgress,
  cookTimerRemaining,
  hasCookTimer,
  isCookTimerReady,
  isCookTimerRunning,
} from '../utils/recipeTimer';
import {
  flattenRecipeIngredients,
  recipeMap,
  resolveComponents,
  type ResolvedComponent,
} from '../utils/recipeComponents';
import { formatOffsetLabel } from '../utils/templateUtils';
import { splitGroceryLines } from '../utils/groceryParse';

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
  const toggleFavorite = useRecipeStore(s => s.toggleFavorite);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const removePrepTask = useRecipeStore(s => s.removePrepTask);
  const setImage = useRecipeStore(s => s.setImage);
  const startCookTimer = useRecipeStore(s => s.startCookTimer);
  const pauseCookTimer = useRecipeStore(s => s.pauseCookTimer);
  const resetCookTimer = useRecipeStore(s => s.resetCookTimer);
  const stopCookTimer = useRecipeStore(s => s.stopCookTimer);
  const addComponent = useRecipeStore(s => s.addComponent);
  const removeComponent = useRecipeStore(s => s.removeComponent);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);

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

  const [draft, setDraft] = useState('');
  const [pickingImage, setPickingImage] = useState(false);
  const draftInputRef = useRef<TextInput>(null);
  const [prepDraft, setPrepDraft] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  const [editingPrepTask, setEditingPrepTask] = useState<RecipePrepTask | null>(null);
  const [addToListVisible, setAddToListVisible] = useState(false);
  const [extractVisible, setExtractVisible] = useState(false);
  const [componentPickerVisible, setComponentPickerVisible] = useState(false);
  // Turns the list's own scroll off while a row is being dragged. Without it
  // the drag is silently dead — see the note on SortableList.onDragStateChange.
  const [dragging, setDragging] = useState(false);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  // Tick once a second only while the cook timer runs, mirroring TaskItem's
  // own timer clock — everything else is recomputed from the stored fields
  // against nowTick rather than counted down in state, so this reads right
  // even after the app was backgrounded or killed mid-cook.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const cookRunning = recipe ? isCookTimerRunning(recipe) : false;
  useEffect(() => {
    if (!cookRunning) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cookRunning, recipe?.timerStartedAt]);

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

  const submitDraft = () => {
    const text = draft;
    if (!text.trim()) return;
    animateLayout();
    // A multi-line paste is the common way a recipe arrives, so one field
    // handles both — splitGroceryLines tells them apart.
    const added = splitGroceryLines(text).length > 1
      ? addIngredientsFromText(recipe.id, text)
      : (addIngredient(recipe.id, text) ? 1 : 0);
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

  const renderIngredient = (
    ingredient: RecipeIngredient,
    _index: number,
    drag: () => void,
    isDragging: boolean,
  ) => {
    const sectionHeader = ingredientSectionHeaders.get(ingredient.id);
    return (
      <View>
        {!!sectionHeader && <Text style={styles.ingredientSectionHeader}>{sectionHeader}</Text>}
        <TouchableOpacity
          style={[styles.ingredient, isDragging && styles.ingredientDragging]}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); setEditingIngredient(ingredient); }}
          onLongPress={drag}
          delayLongPress={interaction.delayLongPress}
          accessibilityRole="button"
          accessibilityLabel={
            [ingredient.section, ingredient.name, ingredient.quantity, ingredient.prep]
              .filter(Boolean).join(', ')
          }
          accessibilityHint="Double tap to edit. Long press to reorder."
        >
          <View style={styles.ingredientText}>
            <Text style={styles.ingredientName}>{ingredient.name}</Text>
            {!!ingredient.prep && <Text style={styles.ingredientPrep}>{ingredient.prep}</Text>}
          </View>
          {!!ingredient.quantity && (
            <View style={styles.qtyPill}>
              <Text style={styles.qtyText} numberOfLines={1}>{ingredient.quantity}</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={() => confirmRemove(ingredient)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${ingredient.name}`}
          >
            <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  // A component row opens the recipe it points at, so the shared part is one
  // tap from the dish that uses it — editing it there is the whole feature.
  // A link whose recipe is gone can't be opened, only removed.
  const renderComponent = (resolved: ResolvedComponent) => {
    const target = resolved.recipe;
    const label = resolved.name || 'Deleted recipe';
    return (
      <TouchableOpacity
        key={resolved.component.id}
        style={styles.ingredient}
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
        accessibilityRole="button"
        accessibilityLabel={target ? `${label}. ${describeRecipe(target)}` : `${label}, no longer in your recipes`}
        accessibilityHint={target ? 'Double tap to open this recipe.' : undefined}
      >
        <View style={styles.ingredientText}>
          <Text style={[styles.ingredientName, !target && styles.componentBrokenName]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.componentMeta} numberOfLines={1}>
            {target ? describeRecipe(target) : 'No longer in your recipes'}
          </Text>
        </View>
        {!!target && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
        <TouchableOpacity
          onPress={() => confirmRemoveComponent(resolved)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label} from this recipe`}
        >
          <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
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
            {!!anthropicApiKey && (
              <TouchableOpacity
                onPress={() => { haptics.tap(); setExtractVisible(true); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Fill in from a pasted recipe"
              >
                <Ionicons name="sparkles" size={iconSize.md} color={colors.purple} />
              </TouchableOpacity>
            )}
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
            <TouchableOpacity
              onPress={() => { haptics.tap(); setEditorVisible(true); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Recipe settings"
            >
              <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>
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
        <TouchableOpacity
          style={styles.hero}
          activeOpacity={interaction.activeOpacity}
          onPress={openImagePicker}
          disabled={pickingImage}
          accessibilityRole="button"
          accessibilityLabel={recipe.imagePath ? 'Change recipe photo' : 'Add a recipe photo'}
        >
          {recipe.imagePath ? (
            <Image
              source={{ uri: recipe.imagePath }}
              style={styles.heroImage}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : pickingImage ? (
            <View style={styles.heroPlaceholder}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="camera-outline" size={iconSize.lg} color={colors.textTertiary} />
              <Text style={styles.heroPlaceholderText}>Add a photo</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.summary}>{describeRecipe(recipe)}</Text>
        {!!recipe.notes && <Text style={styles.notes}>{recipe.notes}</Text>}

        <View style={styles.timerCard}>
          <View style={styles.timerHeader}>
            <Ionicons
              name={cookReady ? 'checkmark-circle' : 'timer-outline'}
              size={16}
              color={cookReady ? colors.green : colors.accent}
            />
            <Text style={styles.timerHeaderText} numberOfLines={1}>
              {cookHasTarget
                ? cookReady
                  ? `Ready · ${formatDuration(recipe.estimatedMinutes!)} done`
                  : cookRunning
                    ? `${formatStopwatch(Math.max(0, cookRemainingSeconds))} left`
                    : cookPaused
                      ? `Paused · ${formatStopwatch(Math.max(0, cookRemainingSeconds))} left`
                      : `Cook for ${formatDuration(recipe.estimatedMinutes!)}`
                : cookRunning
                  ? `${formatStopwatch(cookElapsedSeconds)} elapsed`
                  : cookPaused
                    ? `Paused · ${formatStopwatch(cookElapsedSeconds)}`
                    : 'Time this cook'}
            </Text>
          </View>
          {cookHasTarget && <ProgressBar progress={cookProgress} height={4} />}
          <View style={styles.timerActions}>
            <TouchableOpacity
              style={[styles.timerBtn, cookRunning && styles.timerBtnRunning]}
              activeOpacity={interaction.activeOpacity}
              onPress={handleCookTimerToggle}
              accessibilityRole="button"
              accessibilityLabel={
                cookRunning ? 'Pause cook timer' : cookPaused ? 'Resume cook timer' : 'Start cook timer'
              }
            >
              <Ionicons name={cookRunning ? 'pause' : 'play'} size={12} color={colors.onAccent} />
              <Text style={styles.timerBtnText}>{cookRunning ? 'Pause' : cookPaused ? 'Resume' : 'Start'}</Text>
            </TouchableOpacity>
            {cookInProgress && (
              <>
                <TouchableOpacity
                  onPress={handleLogCookTime}
                  hitSlop={8}
                  style={styles.timerSecondaryBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Done cooking — log this time"
                >
                  <Ionicons name="checkmark" size={iconSize.sm} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleResetCookTimer}
                  hitSlop={8}
                  style={styles.timerSecondaryBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Reset cook timer"
                >
                  <Ionicons name="refresh" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              </>
            )}
          </View>
          {!!cookTimeSummary && <Text style={styles.timerSummary}>{cookTimeSummary}</Text>}
        </View>

        <Text style={styles.sectionLabel}>Ingredients</Text>

        {recipe.ingredients.length === 0 ? (
          <Text style={styles.hint}>
            Type one ingredient at a time, or paste a whole list — “2 lb chicken thighs”
            keeps the quantity out of the name so the list stays tidy.
          </Text>
        ) : (
          <View style={styles.card}>
            <SortableList
              data={recipe.ingredients}
              onReorder={next => reorderIngredients(recipe.id, next.map(i => i.id))}
              onDragStateChange={setDragging}
              renderItem={renderIngredient}
            />
          </View>
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
            updates every meal that uses it.
          </Text>
        ) : (
          <View style={styles.card}>
            {components.map(renderComponent)}
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
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
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

      <RecipeToListSheet
        visible={addToListVisible}
        recipe={recipe}
        recipesById={recipesById}
        onClose={() => setAddToListVisible(false)}
      />

      <RecipeExtractSheet
        visible={extractVisible}
        recipe={recipe}
        onClose={() => setExtractVisible(false)}
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
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  heroPlaceholderText: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  summary: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  notes: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: font.md * 1.4,
  },
  timerCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  timerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timerHeaderText: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ['tabular-nums'],
  },
  timerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  timerBtnRunning: {
    backgroundColor: colors.orange,
  },
  timerBtnText: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  timerSecondaryBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerSummary: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  sectionLabel: {
    color: colors.textTertiary,
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
  // A component heading ("For the cake") inside the ingredients card — same
  // uppercase treatment as sectionLabel, just scoped to sit above a run of
  // rows rather than the whole list.
  ingredientSectionHeader: {
    color: colors.textTertiary,
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
  componentBrokenName: {
    color: colors.textTertiary,
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
  qtyText: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    backgroundColor: colors.bg,
  },
  primary: {
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
