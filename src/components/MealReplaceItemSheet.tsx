import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SafeBlurView } from './SafeBlurView';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useRecipeStore } from '../store/useRecipeStore';
import { rankRecipes, describeRecipe, cleanRecipeName } from '../utils/recipeUtils';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

export interface MealReplacement {
  recipeId: string | null;
  title: string;
}

interface Props {
  visible: boolean;
  /** How many entries this replaces — drives the sheet's title and hint. */
  count: number;
  onReplace: (replacement: MealReplacement) => void;
  onClose: () => void;
}

/** Enough to scan without virtualizing; the search field reaches the rest. */
const MAX_ROWS = 30;

/**
 * The bulk-selection "Replace item" sheet (#1110): swaps the recipe or
 * free-text title on every selected entry at once — the escape hatch for a
 * recipe that got renamed or retired while it was still on the plan, applied
 * across every occurrence in one pass instead of opening each planned meal
 * to fix it by hand.
 *
 * Deliberately not RecipePickerSheet cut down: that sheet answers "what's for
 * dinner", so it carries a slot row and a fridge section neither question
 * this one asks — a bulk replacement doesn't touch which slot an entry sits
 * in, and pointing several different nights at the same tracked leftover
 * container is a stranger idea than the issue this shipped for (#1110) asked
 * for. Recipe-or-typed-text only, same search-and-list shape.
 */
export function MealReplaceItemSheet({ visible, count, onReplace, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const [query, setQuery] = useState('');
  const typed = cleanRecipeName(query);

  const matches = useMemo(() => {
    const ranked = query.trim()
      ? rankRecipes(query, recipes)
      : [...recipes].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder);
    return ranked.slice(0, MAX_ROWS);
  }, [query, recipes]);

  // Same rule RecipePickerSheet uses: the typed line only earns its own row
  // when it isn't just the name of a recipe already offered above it.
  const showFreeText =
    !!typed && !matches.some(r => r.name.toLowerCase() === typed.toLowerCase());

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const pick = (recipeId: string | null, title: string) => {
    haptics.success();
    dismiss(() => onReplace({ recipeId, title }));
  };

  const countLabel = `${count} meal${count === 1 ? '' : 's'}`;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>Replace {countLabel}</Text>
          <Text style={styles.sheetHint}>
            Pick a recipe, or type a new name — replaces the item on every selected meal.
          </Text>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search recipes, or type a name"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              maxLength={RECIPE_NAME_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => { if (typed) pick(null, typed); }}
              accessibilityLabel="Search recipes, or type a name"
            />
          </View>

          <ScrollView style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
            {showFreeText && (
              <TouchableOpacity
                style={styles.row}
                onPress={() => pick(null, typed)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Replace with ${typed}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>{typed}</Text>
                  <Text style={styles.rowHint}>Just this, not a recipe</Text>
                </View>
                <Ionicons name="checkmark" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}

            {matches.length === 0 && !showFreeText ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="restaurant-outline" size={28} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>
                  {query.trim() ? 'No matches' : 'No recipes yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {query.trim()
                    ? 'Nothing in your recipe box is called that.'
                    : 'Type what to replace it with. You don’t need a recipe.'}
                </Text>
              </View>
            ) : (
              matches.map((recipe, idx) => (
                <React.Fragment key={recipe.id}>
                  {(idx > 0 || showFreeText) && <View style={styles.inlineSep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => pick(recipe.id, recipe.name)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Replace with ${recipe.name}. ${describeRecipe(recipe)}`}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                      <Ionicons name="restaurant-outline" size={16} color={colors.accent} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{recipe.name}</Text>
                      <Text style={styles.rowHint} numberOfLines={1}>{describeRecipe(recipe)}</Text>
                    </View>
                    {recipe.favorite && <Ionicons name="star" size={13} color={colors.orange} />}
                  </TouchableOpacity>
                </React.Fragment>
              ))
            )}
          </ScrollView>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sheetHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 8,
  },
  list: {
    maxHeight: 320,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  emptySub: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
