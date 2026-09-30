import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyNote } from './EmptyNote';
import { useRecipeStore } from '../store/useRecipeStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { groceryNameKey } from '../utils/groceryParse';
import {
  cleanIndexIngredients, describeIndexLocation, findWithIngredients, mentionsIngredient,
  splitIngredientText, type FinderEntryHit,
} from '../utils/cookbookIndex';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Opens a recipe. The host closes this sheet and navigates. */
  onOpenRecipe: (recipeId: string) => void;
  /** Opens a cookbook's page, for an index entry. The host closes this sheet and navigates. */
  onOpenCookbook: (cookbookId: string) => void;
}

/**
 * "Cook with…": everything that uses the ingredients you name, from the
 * recipes you have typed up and from your cookbooks' indexes.
 *
 * The one place outside a book's own page that shows an index entry at all
 * (see `CookbookIndexEntry`), which is what keeps an index of 150 dishes out
 * of every recipe list and picker. The matching and the order are
 * `findWithIngredients`; this only draws them.
 *
 * What you've asked for is kept between opens, since it's a question you're
 * still asking; only the half-typed word goes. None of it is data, so there
 * is nothing for a discard guard to protect.
 */
export function CookWithSheet({ visible, onClose, onOpenRecipe, onOpenCookbook }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const entries = useRecipeStore(useShallow(s => s.indexEntries));
  const cookbooks = useRecipeStore(useShallow(s => s.cookbooks));
  const recipeFromIndexEntry = useRecipeStore(s => s.recipeFromIndexEntry);

  const [wanted, setWanted] = useState<string[]>([]);
  const [typed, setTyped] = useState('');

  const results = useMemo(
    () => findWithIngredients(wanted, recipes, entries, cookbooks),
    [wanted, recipes, entries, cookbooks],
  );

  const addWords = (text: string) => {
    const next = cleanIndexIngredients([...wanted, ...splitIngredientText(text)]);
    if (next.length !== wanted.length) haptics.tap();
    setWanted(next);
  };

  // A comma finishes a word, the way it does in the index entry form.
  const handleChange = (text: string) => {
    const parts = splitIngredientText(text);
    if (parts.length === 1) { setTyped(text); return; }
    addWords(parts.slice(0, -1).join(','));
    setTyped(parts[parts.length - 1].trimStart());
  };

  const handleSubmit = () => {
    addWords(typed);
    setTyped('');
  };

  const removeWord = (word: string) => {
    haptics.tap();
    setWanted(prev => prev.filter(w => w !== word));
  };

  const close = () => {
    setTyped('');
    onClose();
  };

  const openEntry = (hit: FinderEntryHit) => {
    const { entry, cookbook, recipe } = hit;
    const where = describeIndexLocation(entry, cookbook);
    const toRecipe = () => {
      const target = recipeFromIndexEntry(entry.id);
      if (!target) return;
      haptics.success();
      setTyped('');
      onOpenRecipe(target.id);
    };
    Alert.alert(
      entry.title,
      recipe
        ? where
        : `${where}\n\nAdding it to your recipes makes a recipe with this name, book and page, ready for you to type up.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open the book', onPress: () => { setTyped(''); onOpenCookbook(entry.cookbookId); } },
        { text: recipe ? 'Open the recipe' : 'Add to my recipes', onPress: toRecipe },
      ],
    );
  };

  // The entry's own words, marked where they answer what was asked.
  const entryWords = (hit: FinderEntryHit) => {
    const asked = hit.matched.map(groceryNameKey);
    return hit.entry.ingredients.map(word => ({
      word,
      hit: asked.some(key => mentionsIngredient(groceryNameKey(word), key)),
    }));
  };

  const nothingAsked = wanted.length === 0;
  const nothingFound = !nothingAsked && results.recipes.length === 0 && results.entries.length === 0;

  return (
    <SheetModal
      name="CookWithSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View style={[styles.root, { paddingTop: spacing.md }]}>
        <SheetHeader
          title="Cook with…"
          left={<SheetHeaderButton label="Close" role="cancel" onPress={close} />}
          right={<View style={styles.headerSpacer} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={handleChange}
            onSubmitEditing={handleSubmit}
            blurOnSubmit={false}
            placeholder="e.g. lentils, feta"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Add an ingredient"
          />
          {wanted.length > 0 && (
            <View style={styles.chips}>
              {wanted.map(word => (
                <TouchableOpacity
                  key={word}
                  style={styles.chip}
                  onPress={() => removeWord(word)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${word}`}
                >
                  <Text style={styles.chipText}>{word}</Text>
                  <Ionicons name="close" size={iconSize.sm} color={colors.accent} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {nothingAsked && (
            <View style={styles.note}>
              <EmptyNote icon="search-outline">
                {`Add an ingredient to see the recipes you've typed up and the dishes in your cookbooks' indexes that use it.${
                  entries.length === 0 ? " A cookbook's index is added from its page under Cookbooks." : ''
                }`}
              </EmptyNote>
            </View>
          )}
          {nothingFound && (
            <View style={styles.note}>
              <EmptyNote icon="search-outline">
                {`Nothing in your recipes or cookbook indexes uses ${wanted.join(' or ')} yet.`}
              </EmptyNote>
            </View>
          )}

          {results.recipes.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>YOUR RECIPES · {results.recipes.length}</Text>
              <View style={styles.card}>
                {results.recipes.map((hit, i) => (
                  <TouchableOpacity
                    key={hit.recipe.id}
                    style={[styles.row, i > 0 && styles.rowDivided]}
                    onPress={() => { setTyped(''); onOpenRecipe(hit.recipe.id); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${hit.recipe.name}. Uses ${hit.matched.join(', ')}`}
                  >
                    <Text style={styles.rowTitle} numberOfLines={2}>{hit.recipe.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      Uses <Text style={styles.matched}>{hit.matched.join(', ')}</Text>
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {results.entries.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>IN YOUR COOKBOOKS · {results.entries.length}</Text>
              <View style={styles.card}>
                {results.entries.map((hit, i) => {
                  const words = entryWords(hit);
                  const where = describeIndexLocation(hit.entry, hit.cookbook);
                  return (
                    <TouchableOpacity
                      key={hit.entry.id}
                      style={[styles.row, i > 0 && styles.rowDivided]}
                      onPress={() => openEntry(hit)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${hit.entry.title}. ${where}. Uses ${hit.matched.join(', ')}`}
                    >
                      <Text style={styles.rowTitle} numberOfLines={2}>{hit.entry.title}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {where}
                        {words.length > 0 && ' · '}
                        {words.map((w, j) => (
                          <Text key={w.word} style={w.hit ? styles.matched : undefined}>
                            {j > 0 ? ', ' : ''}{w.word}
                          </Text>
                        ))}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { width: 48 },
  scroll: { flex: 1 },
  body: { padding: spacing.md },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xsm,
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
  },
  chipText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  note: { marginTop: spacing.md },
  sectionLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, paddingHorizontal: spacing.xs,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: 3,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowTitle: { color: colors.text, fontSize: font.md },
  rowMeta: { color: colors.textSecondary, fontSize: font.sm },
  matched: { color: colors.green, fontWeight: fontWeight.semibold },
});
