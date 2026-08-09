import React, { useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeIngredient } from '../types';
import { GROCERY_NAME_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { SortableList } from '../components/SortableList';
import { RecipeEditor } from '../components/RecipeEditor';
import { RecipeIngredientSheet } from '../components/RecipeIngredientSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { describeRecipe } from '../utils/recipeUtils';
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
  const toggleFavorite = useRecipeStore(s => s.toggleFavorite);
  const addFromPlan = useGroceryStore(s => s.addFromPlan);

  const [draft, setDraft] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  // Turns the list's own scroll off while a row is being dragged. Without it
  // the drag is silently dead — see the note on SortableList.onDragStateChange.
  const [dragging, setDragging] = useState(false);

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
  };

  const addToList = () => {
    if (recipe.ingredients.length === 0) return;
    const result = addFromPlan(recipe.ingredients.map(i => ({
      name: i.name,
      quantity: i.quantity || null,
      aisle: i.aisle,
    })));
    haptics.success();

    // Each count is reported on its own terms and never added together — the
    // same discipline describeShops keeps. "Added 6 · 2 already on your list"
    // is true; "8 of 8" would imply an arithmetic these numbers don't support.
    const parts = [`Added ${result.added.length}`];
    if (result.alreadyOnList.length > 0) parts.push(`${result.alreadyOnList.length} already on your list`);
    if (result.skippedInCart.length > 0) parts.push(`${result.skippedInCart.length} already in your trolley`);
    Alert.alert(
      result.added.length > 0 ? 'On the list' : 'Nothing to add',
      parts.join(' · '),
    );
  };

  const confirmRemove = (ingredient: RecipeIngredient) => {
    animateLayout();
    removeIngredient(recipe.id, ingredient.id);
    haptics.tap();
  };

  const renderIngredient = (
    ingredient: RecipeIngredient,
    _index: number,
    drag: () => void,
    isDragging: boolean,
  ) => (
    <TouchableOpacity
      style={[styles.ingredient, isDragging && styles.ingredientDragging]}
      activeOpacity={interaction.activeOpacity}
      onPress={() => { haptics.tap(); setEditingIngredient(ingredient); }}
      onLongPress={drag}
      delayLongPress={interaction.delayLongPress}
      accessibilityRole="button"
      accessibilityLabel={
        ingredient.quantity
          ? `${ingredient.name}, ${ingredient.quantity}`
          : ingredient.name
      }
      accessibilityHint="Double tap to edit. Long press to reorder."
    >
      <Text style={styles.ingredientName}>{ingredient.name}</Text>
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
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader
        title={recipe.name}
        onBack={() => navigation.goBack()}
        actions={
          <View style={styles.headerActions}>
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
        scrollEnabled={!dragging}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
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
            style={styles.addInput}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            placeholder="Add an ingredient"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_NAME_MAX_LENGTH * 4}
            multiline
            blurOnSubmit
            returnKeyType="done"
            accessibilityLabel="Add an ingredient"
          />
          <InlineAction
            label="Add"
            icon="add"
            onPress={submitDraft}
            disabled={!draft.trim()}
          />
        </View>
      </ScrollView>

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
  ingredientName: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
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
