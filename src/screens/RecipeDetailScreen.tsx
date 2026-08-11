import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
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
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRowSelection } from '../hooks/useRowSelection';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { SortableList } from '../components/SortableList';
import { ListBulkBar } from '../components/ListBulkBar';
import { RecipeEditor } from '../components/RecipeEditor';
import { RecipeIngredientSheet } from '../components/RecipeIngredientSheet';
import { PrepTaskSheet } from '../components/PrepTaskSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { RecipeExtractSheet } from '../components/RecipeExtractSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { describeRecipe } from '../utils/recipeUtils';
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

  const recipe = useRecipeStore(useShallow(s => s.recipes.find(r => r.id === recipeId)));
  const addIngredient = useRecipeStore(s => s.addIngredient);
  const addIngredientsFromText = useRecipeStore(s => s.addIngredientsFromText);
  const removeIngredient = useRecipeStore(s => s.removeIngredient);
  const reorderIngredients = useRecipeStore(s => s.reorderIngredients);
  const bulkRemoveIngredients = useRecipeStore(s => s.bulkRemoveIngredients);
  const bulkSetIngredientAisle = useRecipeStore(s => s.bulkSetIngredientAisle);
  const toggleFavorite = useRecipeStore(s => s.toggleFavorite);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const removePrepTask = useRecipeStore(s => s.removePrepTask);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addAisle = useGroceryStore(s => s.addAisle);

  const [draft, setDraft] = useState('');
  const draftInputRef = useRef<TextInput>(null);
  const [prepDraft, setPrepDraft] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  const [editingPrepTask, setEditingPrepTask] = useState<RecipePrepTask | null>(null);
  const [addToListVisible, setAddToListVisible] = useState(false);
  const [extractVisible, setExtractVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
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
    if (recipe.ingredients.length === 0) return;
    haptics.tap();
    setAddToListVisible(true);
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

  const renderIngredient = (
    ingredient: RecipeIngredient,
    _index: number,
    drag: () => void,
    isDragging: boolean,
  ) => {
    const selected = selectedIds.has(ingredient.id);
    return (
      <TouchableOpacity
        style={[
          styles.ingredient,
          isDragging && styles.ingredientDragging,
          selectionMode && selected && styles.ingredientSelected,
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
          [ingredient.name, ingredient.quantity, ingredient.prep].filter(Boolean).join(', ')
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
          {!!ingredient.prep && <Text style={styles.ingredientPrep}>{ingredient.prep}</Text>}
        </View>
        {!!ingredient.quantity && (
          <View style={styles.qtyPill}>
            <Text style={styles.qtyText} numberOfLines={1}>{ingredient.quantity}</Text>
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
        <Text style={styles.summary}>{describeRecipe(recipe)}</Text>
        {!!recipe.notes && <Text style={styles.notes}>{recipe.notes}</Text>}

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
          <TouchableOpacity
            style={[styles.primary, recipe.ingredients.length === 0 && styles.primaryOff]}
            activeOpacity={interaction.activeOpacity}
            onPress={addToList}
            disabled={recipe.ingredients.length === 0}
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

      <RecipeToListSheet
        visible={addToListVisible}
        recipe={recipe}
        onClose={() => setAddToListVisible(false)}
      />

      <RecipeExtractSheet
        visible={extractVisible}
        recipe={recipe}
        onClose={() => setExtractVisible(false)}
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
  summary: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  notes: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: font.md * 1.4,
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
