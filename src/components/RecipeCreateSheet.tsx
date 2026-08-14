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
  iconSize,
  interaction,
  checkboxRadius,
  type Colors,
} from '../theme';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  extractRecipe, describeAIError, type ExtractedRecipe, type RecipeGroceryItem,
} from '../services/aiSuggestions';
import { normalizeIngredient, cleanRecipeName, formatServingsRange } from '../utils/recipeUtils';
import { groceryNameKey } from '../utils/groceryParse';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { ExtractedIngredientRow } from './ExtractedIngredientRow';
import { useRecipePhotoSource } from '../hooks/useRecipePhotoSource';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
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
 */
export function RecipeCreateSheet({ visible, onClose, onCreated }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const setServings = useRecipeStore(s => s.setServings);
  const addStructuredIngredients = useRecipeStore(s => s.addStructuredIngredients);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedRecipe | null>(null);
  // A working copy of extracted.ingredients, edited in place before Create
  // (#1608) — extracted itself is left untouched, since its .name/.servings
  // fields are still read straight off it below.
  const [ingredients, setIngredients] = useState<RecipeGroceryItem[]>([]);
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [applyServings, setApplyServings] = useState(true);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  // Reachable only via the Recipes add button's "From a photo" item, so the
  // sheet opens on the Photo tab rather than making that tap feel ignored —
  // Paste is still one tap away for a recipe that's easier to copy in as text.
  const input = useRecipePhotoSource('photo');
  const { source, reset: resetInput } = input;

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setExtracted(null);
    setIngredients([]);
    setName('');
    setAccepted(new Set());
    setApplyServings(true);
    resetInput();
  }, [resetInput]);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const run = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    try {
      const result = await extractRecipe(source, [...aisleOrder]);
      setExtracted(result);
      setIngredients(result.ingredients);
      setName(result.name);
      setAccepted(new Set(result.ingredients.map((_, i) => i)));
      setApplyServings(result.servings !== null);
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [source, aisleOrder]);

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
    setIngredients(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
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
    const chosen = ingredients
      .filter((_, i) => accepted.has(i))
      .map(item => normalizeIngredient(item))
      .filter((i): i is NonNullable<typeof i> => i !== null);
    if (chosen.length > 0) addStructuredIngredients(recipe.id, chosen);
    if (applyServings && extracted.servings !== null) {
      setServings(recipe.id, extracted.servings, extracted.servingsMax);
    }
    haptics.success();
    // Close first, then navigate: a navigate fired from under a live pageSheet
    // renders the destination behind the sheet.
    onClose();
    onCreated(recipe.id);
  };

  const canCreate = !loading && !!extracted && !!cleaned && !duplicate;

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.loadingText}>
            {input.usingPhoto ? 'Reading the photo…' : 'Reading the recipe…'}
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
            actionLabel="Try again"
            onAction={run}
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
            intro="Photograph a cookbook page or paste a recipe, and it’ll be added to your recipe box — name, servings and all."
            mode={input.mode}
            onChangeMode={input.setMode}
            text={input.text}
            onChangeText={input.setText}
            photo={input.photo}
            onPickPhoto={input.pick}
            onClearPhoto={input.clearPhoto}
            picking={input.picking}
            ctaLabel={input.usingPhoto ? 'Read the photo' : 'Read the recipe'}
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
        </Text>

        {extracted.servings !== null && (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setApplyServings(v => !v); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: applyServings }}
            accessibilityLabel={`Serves ${formatServingsRange(extracted.servings, extracted.servingsMax)}`}
          >
            <View style={[styles.checkbox, applyServings && styles.checkboxOn]}>
              {applyServings && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
            </View>
            <View style={styles.body}>
              <Text style={styles.name}>Serves {formatServingsRange(extracted.servings, extracted.servingsMax)}</Text>
              {extracted.prepMinutes !== null && (
                <Text style={styles.meta}>About {extracted.prepMinutes} min</Text>
              )}
            </View>
          </TouchableOpacity>
        )}

        {ingredients.map((row, i) => {
          // A new heading whenever this row's section differs from the one
          // right before it — same display-only grouping RecipeDetailScreen
          // does over the saved list, run here over the preview instead.
          const prevSection = i > 0 ? ingredients[i - 1].section : null;
          const sectionHeader = row.section && row.section !== prevSection ? row.section : null;
          return (
            <ExtractedIngredientRow
              key={`${row.name}-${i}`}
              row={row}
              checked={accepted.has(i)}
              onToggle={() => toggle(i)}
              onEditName={name => editIngredient(i, { name })}
              onEditQuantity={quantity => editIngredient(i, { quantity })}
              sectionHeader={sectionHeader}
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
