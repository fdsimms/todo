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
import { extractRecipe, describeAIError, type ExtractedRecipe } from '../services/aiSuggestions';
import { normalizeIngredient } from '../utils/recipeUtils';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
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
 */
export function RecipeExtractSheet({ visible, recipe, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const setServings = useRecipeStore(s => s.setServings);
  const addStructuredIngredients = useRecipeStore(s => s.addStructuredIngredients);

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedRecipe | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [applyServings, setApplyServings] = useState(true);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const reset = useCallback(() => {
    setText('');
    setLoading(false);
    setError(null);
    setExtracted(null);
    setAccepted(new Set());
    setApplyServings(true);
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const run = useCallback(async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await extractRecipe(text, [...aisleOrder]);
      setExtracted(result);
      setAccepted(new Set(result.ingredients.map((_, i) => i)));
      setApplyServings(result.servings !== null);
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [text, aisleOrder]);

  const toggle = (index: number) => {
    haptics.tap();
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleApply = () => {
    if (!recipe || !extracted) { onClose(); return; }
    const chosen = extracted.ingredients
      .filter((_, i) => accepted.has(i))
      .map(item => normalizeIngredient(item))
      .filter((i): i is NonNullable<typeof i> => i !== null);
    if (chosen.length > 0) addStructuredIngredients(recipe.id, chosen);
    if (applyServings && extracted.servings !== null) setServings(recipe.id, extracted.servings);
    haptics.success();
    onClose();
  };

  const canApply = !loading && !!extracted && (accepted.size > 0 || (applyServings && extracted.servings !== null));

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.loadingText}>Reading the recipe…</Text>
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
          <Text style={styles.intro}>
            Paste a recipe — ingredients, method and all. Its servings and shopping list get added
            to {recipe?.name ?? 'this recipe'} instead of just going on the grocery list.
          </Text>
          <TextInput
            style={styles.pasteInput}
            value={text}
            onChangeText={setText}
            placeholder="Paste your recipe here…"
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Recipe text"
          />
          <TouchableOpacity
            style={[styles.runBtn, !text.trim() && styles.runBtnOff]}
            activeOpacity={interaction.activeOpacity}
            onPress={run}
            disabled={!text.trim()}
            accessibilityRole="button"
            accessibilityLabel="Read the recipe"
          >
            <Ionicons name="sparkles" size={iconSize.sm} color={colors.onAccent} />
            <Text style={styles.runBtnText}>Read the recipe</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }

    if (extracted.ingredients.length === 0 && extracted.servings === null) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="Nothing found"
            subtitle="No servings or shopping items turned up in that text."
          />
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Untick anything you don't want added.</Text>

        {extracted.servings !== null && (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setApplyServings(v => !v); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: applyServings }}
            accessibilityLabel={`Serves ${extracted.servings}`}
          >
            <View style={[styles.checkbox, applyServings && styles.checkboxOn]}>
              {applyServings && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
            </View>
            <View style={styles.body}>
              <Text style={styles.name}>Serves {extracted.servings}</Text>
              {extracted.prepMinutes !== null && (
                <Text style={styles.meta}>About {extracted.prepMinutes} min</Text>
              )}
            </View>
          </TouchableOpacity>
        )}

        {extracted.ingredients.map((row, i) => {
          const on = accepted.has(i);
          return (
            <TouchableOpacity
              key={`${row.name}-${i}`}
              style={styles.row}
              activeOpacity={interaction.activeOpacity}
              onPress={() => toggle(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${row.name}, ${row.aisle}`}
            >
              <View style={[styles.checkbox, on && styles.checkboxOn]}>
                {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{row.aisle}</Text>
              </View>
              {!!row.quantity && (
                <View style={styles.qtyPill}>
                  <Text style={styles.qtyText} numberOfLines={1}>{row.quantity}</Text>
                </View>
              )}
            </TouchableOpacity>
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
    pasteWrap: { padding: spacing.md, gap: spacing.md },
    pasteInput: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      fontSize: font.md,
      color: colors.text,
      minHeight: 220,
    },
    runBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.purple,
      borderRadius: radius.md,
      paddingVertical: 14,
    },
    runBtnOff: { opacity: 0.4 },
    runBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
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
    qtyPill: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      maxWidth: 96,
    },
    qtyText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  });
}
