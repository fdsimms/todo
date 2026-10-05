import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyNote } from './EmptyNote';
import { SegmentedControl } from './SegmentedControl';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { groceryNameKey } from '../utils/groceryParse';
import {
  cleanIndexIngredients, describeIndexLocation, findWithIngredients, findWithPantry, mentionsIngredient,
  pantryIngredients, splitIngredientText, type FinderEntryHit,
} from '../utils/cookbookIndex';
import { TextField } from './TextField';

/** Which question the sheet is asking: about words you type, or about the pantry. */
export type CookWithMode = 'pick' | 'have';

const MODE_OPTIONS: { value: CookWithMode; label: string }[] = [
  { value: 'pick', label: 'Pick ingredients' },
  { value: 'have', label: 'What I have' },
];

/**
 * Rows drawn per section. "What I have" asks about the whole pantry, which can
 * match most of a large index; past this the list is a slice, and says so.
 */
const MAX_ROWS = 50;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Opens a recipe. The host closes this sheet and navigates. */
  onOpenRecipe: (recipeId: string) => void;
  /** Opens a cookbook's page, for an index entry. The host closes this sheet and navigates. */
  onOpenCookbook: (cookbookId: string) => void;
  /**
   * The mode to open in, applied on every open. Omitted, the sheet opens in
   * whichever mode it was last left in.
   */
  initialMode?: CookWithMode;
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
 * Two modes. "Pick ingredients" asks about words you type (`findWithIngredients`);
 * "What I have" asks about everything the pantry says you have
 * (`pantryIngredients` + `findWithPantry`), which is the Pantry screen's own
 * way in.
 *
 * What you've asked for is kept between opens, since it's a question you're
 * still asking; only the half-typed word goes. None of it is data, so there
 * is nothing for a discard guard to protect.
 */
export function CookWithSheet({ visible, onClose, onOpenRecipe, onOpenCookbook, initialMode }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const entries = useRecipeStore(useShallow(s => s.indexEntries));
  const cookbooks = useRecipeStore(useShallow(s => s.cookbooks));
  const recipeFromIndexEntry = useRecipeStore(s => s.recipeFromIndexEntry);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));

  const [wanted, setWanted] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState<CookWithMode>(initialMode ?? 'pick');
  // "Now" for the pantry read, taken when the sheet opens rather than per
  // render, so the results don't reshuffle while you're reading them.
  const [openedAt, setOpenedAt] = useState(() => new Date());
  useEffect(() => {
    if (!visible) return;
    setOpenedAt(new Date());
    if (initialMode) setMode(initialMode);
    // Only on the open edge: the host's `initialMode` is fixed per host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const have = useMemo(
    () => (mode === 'have' ? pantryIngredients(items, openedAt, itemProducts) : []),
    [mode, items, openedAt, itemProducts],
  );
  const results = useMemo(
    () => mode === 'have'
      ? findWithPantry(have, recipes, entries, cookbooks)
      : findWithIngredients(wanted, recipes, entries, cookbooks),
    [mode, have, wanted, recipes, entries, cookbooks],
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

  // The entry's own words, marked where they answer what was asked. Either
  // direction, so "onion" is marked for a white onion in the pantry; this only
  // decides what's drawn in green, the match itself was already made.
  const entryWords = (hit: FinderEntryHit) => {
    const asked = hit.matched.map(groceryNameKey);
    return hit.entry.ingredients.map(word => {
      const key = groceryNameKey(word);
      return { word, hit: asked.some(a => mentionsIngredient(key, a) || mentionsIngredient(a, key)) };
    });
  };

  const nothingAsked = mode === 'pick' ? wanted.length === 0 : have.length === 0;
  const nothingFound = !nothingAsked && results.recipes.length === 0 && results.entries.length === 0;
  const shownRecipes = results.recipes.slice(0, MAX_ROWS);
  const shownEntries = results.entries.slice(0, MAX_ROWS);
  const moreNote = (total: number) => total > MAX_ROWS
    ? <Text style={styles.moreNote}>{`Showing ${MAX_ROWS} of ${total}, the ones using the most first.`}</Text>
    : null;

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
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={m => { haptics.tap(); setMode(m); }} />
          {mode === 'have' ? (
            have.length > 0 && (
              <Text style={styles.haveNote}>
                {`Using the ${have.length === 1 ? 'one thing' : `${have.length} things`} the pantry says you have. Staples like salt aren't counted.`}
              </Text>
            )
          ) : (
          <>
          <TextField
            style={[styles.input, styles.inputSpaced]}
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
          </>
          )}

          {nothingAsked && (
            <View style={styles.note}>
              <EmptyNote icon={mode === 'have' ? 'basket-outline' : 'search-outline'}>
                {mode === 'have'
                  ? "The pantry doesn't list anything you have yet. Mark things as Got it on the Pantry screen, or finish a shopping trip, and they count here."
                  : `Add an ingredient to see the recipes you've typed up and the dishes in your cookbooks' indexes that use it.${
                      entries.length === 0 ? " A cookbook's index is added from its page under Cookbooks." : ''
                    }`}
              </EmptyNote>
            </View>
          )}
          {nothingFound && (
            <View style={styles.note}>
              <EmptyNote icon="search-outline">
                {mode === 'have'
                  ? 'Nothing in your recipes or cookbook indexes uses what the pantry says you have.'
                  : `Nothing in your recipes or cookbook indexes uses ${wanted.join(' or ')} yet.`}
              </EmptyNote>
            </View>
          )}

          {results.recipes.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>YOUR RECIPES · {results.recipes.length}</Text>
              <View style={styles.card}>
                {shownRecipes.map((hit, i) => (
                  <TouchableOpacity
                    key={hit.recipe.id}
                    style={[styles.row, i > 0 && styles.rowDivided]}
                    onPress={() => { setTyped(''); onOpenRecipe(hit.recipe.id); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${hit.recipe.name}. Uses ${hit.matched.join(', ')}`}
                  >
                    <Text style={styles.rowTitle} numberOfLines={2}>{hit.recipe.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      Uses <Text style={styles.matched}>{hit.matched.join(', ')}</Text>
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {moreNote(results.recipes.length)}
            </>
          )}

          {results.entries.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>IN YOUR COOKBOOKS · {results.entries.length}</Text>
              <View style={styles.card}>
                {shownEntries.map((hit, i) => {
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
              {moreNote(results.entries.length)}
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
  inputSpaced: { marginTop: spacing.md },
  haveNote: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.md,
  },
  moreNote: {
    color: colors.textSecondary,
    fontSize: font.xs,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
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
  matched: { color: colors.greenText, fontWeight: fontWeight.semibold },
});
