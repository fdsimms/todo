import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Alert,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
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
import { entryFor, itemsOnList } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  suggestGroceryAisles,
  suggestRecipeGroceries,
  describeAIError,
  type RecipeGroceryItem,
} from '../services/aiSuggestions';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { groceryNameKey } from '../utils/groceryParse';
import { catalogItemForKey } from '../utils/groceryPlural';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { describeImportError, isRetryableImportError } from '../services/recipePage';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { MAX_RECIPE_PHOTOS } from '../utils/recipePhoto';
import { haptics } from '../utils/haptics';
import { GROCERY_NAME_MAX_LENGTH } from '../types';

const CHECKBOX_SIZE = 22;

/** `tidy` files the Other pile into real aisles; `recipe` turns pasted text into items. */
export type GroceryAIMode = 'tidy' | 'recipe';

interface Props {
  visible: boolean;
  mode: GroceryAIMode;
  onClose: () => void;
}

interface TidyRow {
  id: string;
  name: string;
  aisle: string;
}

/**
 * The AI half of the grocery list, review-then-apply.
 *
 * Nothing here is load-bearing: the offline lexicon files the common shop
 * without a key or a network, and unrecognised items already land in "Other".
 * Both modes are gated at the call site, so a user who can't run them never
 * sees the entry points at all — `recipe` on `!!anthropicApiKey`, and `tidy`
 * on `useAiRoute('groceryAisles')`, since aisle sorting can also be answered by
 * the on-device model with no key at all (see `src/utils/aiRouting.ts`).
 *
 * Which engine answered is deliberately not shown here. The rows are the same
 * shape either way and they are reviewed before anything moves, so naming the
 * engine would be asking the user to hold a distinction that changes nothing
 * about what they're being asked to check.
 */
export function GroceryAISheet({ visible, mode, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const listEntries = useGroceryStore(useShallow(s => s.listEntries));
  const activeListId = useGroceryStore(s => s.activeListId);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const setAisleMany = useGroceryStore(s => s.setAisleMany);
  const addByName = useGroceryStore(s => s.addByName);
  const setAisle = useGroceryStore(s => s.setAisle);
  const setQuantity = useGroceryStore(s => s.setQuantity);
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the error state offers a retry or a way back to the input —
  // a mistyped address fails identically however many times you ask.
  const [canRetry, setCanRetry] = useState(true);
  const [tidyRows, setTidyRows] = useState<TidyRow[]>([]);
  // Whether a tidy has come back since the sheet opened. Until one has, an
  // empty `tidyRows` means "not asked yet" rather than "nothing to move", and
  // the body shows the spinner for the frame before the request starts.
  const [tidyAnswered, setTidyAnswered] = useState(false);
  const [recipeRows, setRecipeRows] = useState<RecipeGroceryItem[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const recipeInput = useRecipeImportSource('paste', undefined, MAX_RECIPE_PHOTOS);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const { resolveSource: resolveRecipeSource, reset: resetRecipeInput } = recipeInput;

  // Anything currently sitting in the catch-all and on the list — the exact
  // gap the lexicon left.
  const unsorted = useMemo(
    () => itemsOnList(items, listEntries, activeListId).filter(i => i.aisle === OTHER_AISLE),
    [items, listEntries, activeListId]
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setTidyRows([]);
    setTidyAnswered(false);
    setRecipeRows([]);
    setAccepted(new Set());
    resetRecipeInput();
  }, [resetRecipeInput]);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const runTidy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const map = await suggestGroceryAisles(unsorted.map(i => i.name), [...aisleOrder]);
      const rows: TidyRow[] = [];
      for (const item of unsorted) {
        const aisle = map[item.name];
        // Only ever offer a *move*: an item the model left in Other is not a
        // suggestion, it's a no-op.
        if (aisle && aisle !== item.aisle) rows.push({ id: item.id, name: item.name, aisle });
      }
      setTidyRows(rows);
      setAccepted(new Set(rows.map((_, i) => i)));
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setTidyAnswered(true);
      setLoading(false);
    }
  }, [unsorted, aisleOrder]);

  const runRecipe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // A link is fetched first; a paste and a photo resolve to themselves.
      const resolved = await resolveRecipeSource();
      if (!resolved) return;
      // A staple like water at a stated amount (RecipeGroceryItem.
      // excludeFromShoppingList) has nowhere to be kept visible in this
      // shopping-only sheet, unlike a saved recipe's own ingredient list — so
      // it's dropped here rather than offered as something to buy.
      const rows = (await suggestRecipeGroceries(resolved.source, [...aisleOrder]))
        .filter(r => !r.excludeFromShoppingList);
      setRecipeRows(rows);
      setAccepted(new Set(rows.map((_, i) => i)));
    } catch (e) {
      setError(describeImportError(e));
      setCanRetry(isRetryableImportError(e));
    } finally {
      setLoading(false);
    }
  }, [resolveRecipeSource, aisleOrder]);

  // Tidy has everything it needs the moment it opens; recipe needs text first.
  // Also keyed on there being anything to sort, so the spinner the body shows
  // before a first answer (`tidyAnswered`) always has a request behind it.
  const hasUnsorted = unsorted.length > 0;
  useEffect(() => {
    if (visible && mode === 'tidy' && hasUnsorted && !tidyAnswered) void runTidy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, hasUnsorted]);

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
    if (mode === 'tidy') {
      const assignments: Record<string, string> = {};
      tidyRows.forEach((row, i) => {
        if (accepted.has(i)) assignments[row.id] = row.aisle;
      });
      setAisleMany(assignments);
    } else {
      // registerUndo: false on each call, then one combined undo below — same
      // reasoning as useGroceryStore's addManyFromText/addFromPlan, otherwise
      // only the last accepted row of the recipe would be undoable.
      const preexisting = new Set(useGroceryStore.getState().items.map(i => i.id));
      const addedIds: string[] = [];
      recipeRows.forEach((row, i) => {
        if (!accepted.has(i)) return;
        // A row already on the list before this apply isn't something *this*
        // action added — same distinction addManyFromText draws — so it's
        // excluded from what undo removes.
        const key = groceryNameKey(row.name);
        // Resolved the way addByName itself resolves it, plural included, or a
        // row already on the list reads as one this apply added — and undo
        // would then take it off. Same lookup addManyFromText makes.
        const before = catalogItemForKey(key, useGroceryStore.getState().items) ?? undefined;
        // On the list being added to, not on any list — same as addManyFromText.
        // Read fresh: earlier rows in this loop have already been added.
        const { listEntries: entriesNow, activeListId: listNow } = useGroceryStore.getState();
        const wasOnList = !!before && entryFor(entriesNow, before.id, listNow) !== null;
        // addByName so an item already in the catalog is re-listed rather than
        // duplicated; the aisle and quantity are then applied on top of
        // whatever the lexicon guessed. An aisle the user has filed this item
        // under themselves is not a guess, though — addByName has already
        // honoured it, and applying the model's on top would overwrite the
        // memory as well as the row.
        const item = addByName(row.name, undefined, undefined, { registerUndo: false });
        if (row.aisle && !rememberedAisleFor(row.name)) setAisle(item.id, row.aisle);
        if (row.quantity) setQuantity(item.id, row.quantity);
        if (!wasOnList) addedIds.push(item.id);
      });
      if (addedIds.length > 0) {
        // undoForAdds, not removeFromListMany: the latter only parks, so
        // undoing an apply would leave every row this minted behind. Built
        // here rather than at undo time, which matters most on this path —
        // setQuantity above stamps a user-owned quantity on every row, so a
        // check made later would read the apply's own writes as reasons to
        // keep them.
        useGroceryStore.getState().setLastAction({
          label: `${addedIds.length} item${addedIds.length === 1 ? '' : 's'} added`,
          undo: useGroceryStore.getState().undoForAdds(addedIds, preexisting),
        });
      }
    }
    haptics.success();
    onClose();
  };

  const rowCount = mode === 'tidy' ? tidyRows.length : recipeRows.length;
  const canApply = !loading && accepted.size > 0;

  // A reviewed batch (tidy moves or recipe rows) is expensive to get back,
  // and typed/pasted/photographed recipe input hasn't been run yet — either
  // way a swipe-down would otherwise drop it with no dialog.
  const handleCancel = () => {
    const dirty = rowCount > 0
      || !!recipeInput.text.trim()
      || !!recipeInput.url.trim()
      || recipeInput.photos.length > 0;
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };


  // A deterministic failure — a mistyped address, a site that refuses us, a page
  // that builds its recipe in the browser — fails identically however many times
  // you ask. What it needs is the input back, not another attempt at it.
  const backLabel = recipeInput.usingLink ? 'Change the link' : 'Go back';
  const goBack = () => { setError(null); setRecipeRows([]); };

  const renderBody = () => {
    if (loading || (mode === 'tidy' && unsorted.length > 0 && !tidyAnswered && !error)) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.loadingText}>
            {mode === 'tidy' ? 'Working out where these live…'
              : recipeInput.fetching ? 'Opening the page…'
              : recipeInput.usingPhoto ? `Reading the photo${recipeInput.photos.length > 1 ? 's' : ''}…`
              : 'Reading the recipe…'}
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
            actionLabel={canRetry || mode === 'tidy' ? 'Try again' : backLabel}
            onAction={canRetry || mode === 'tidy' ? (mode === 'tidy' ? runTidy : runRecipe) : goBack}
          />
        </View>
      );
    }

    if (mode === 'recipe' && recipeRows.length === 0) {
      return (
        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.pasteWrap}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <RecipeSourcePicker
            intro="Open a recipe link, paste a recipe, or photograph the page. You’ll get back what to buy, named the way a store labels it rather than the way the recipe chops it."
            mode={recipeInput.mode}
            onChangeMode={recipeInput.setMode}
            text={recipeInput.text}
            onChangeText={recipeInput.setText}
            url={recipeInput.url}
            onChangeUrl={recipeInput.setUrl}
            photos={recipeInput.photos}
            onPickPhoto={recipeInput.pick}
            onClearPhoto={recipeInput.clearPhoto}
            maxPhotos={recipeInput.maxPhotos}
            picking={recipeInput.picking}
            ctaLabel="Find the items"
            onRun={runRecipe}
          />
          {!!recipeInput.photoError && (
            <Text style={styles.photoError}>{recipeInput.photoError}</Text>
          )}
        </ScrollView>
      );
    }

    // Items were waiting in Other and the model moved none of them, which is
    // every on-device failure as well as a genuine shrug. Saying "everything is
    // already in an aisle" over a list that plainly isn't sorted read as the
    // feature being broken; saying so, with a retry, reads as what happened.
    if (rowCount === 0 && mode === 'tidy' && unsorted.length > 0) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="help-circle-outline"
            title="Couldn't place these"
            subtitle={unsorted.length === 1
              ? 'No aisle came back for this item, so it stays in Other.'
              : `No aisle came back for these ${unsorted.length} items, so they stay in Other.`}
            actionLabel="Try again"
            onAction={() => { void runTidy(); }}
          />
        </View>
      );
    }

    if (rowCount === 0) {
      return (
        <View style={styles.centered}>
          <EmptyState
            // A tick is right for a list with nothing left to sort, and wrong
            // for a paste that found nothing: that one didn't succeed.
            icon={mode === 'tidy' ? 'checkmark-circle-outline' : 'search-outline'}
            title={mode === 'tidy' ? 'Nothing to sort' : 'Nothing found'}
            subtitle={
              mode === 'tidy'
                ? 'Everything on your list is already in an aisle.'
                : 'No shopping items turned up in that text.'
            }
          />
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          {mode === 'tidy'
            ? 'Uncheck anything you’d rather leave where it is.'
            : 'Uncheck anything you already have.'}
        </Text>
        {(mode === 'tidy' ? tidyRows : recipeRows).map((row, i) => {
          const on = accepted.has(i);
          const quantity = mode === 'recipe' ? (row as RecipeGroceryItem).quantity : '';
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
                <Text style={styles.meta} numberOfLines={1}>
                  {mode === 'tidy' ? `Other → ${row.aisle}` : row.aisle}
                </Text>
              </View>
              {!!quantity && (
                <View style={styles.qtyPill}>
                  <Text style={styles.qtyText} numberOfLines={1}>{quantity}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title={mode === 'tidy' ? 'Sort into aisles' : 'From a recipe'}
          icon="sparkles"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={72} />}
          right={
            <SheetHeaderButton
              label={
                rowCount > 0
                  ? `${mode === 'tidy' ? 'Move' : 'Add'} ${accepted.size}`
                  : mode === 'tidy' ? 'Move' : 'Add'
              }
              onPress={handleApply}
              disabled={!canApply}
              minWidth={72}
            />
          }
        />
        {renderBody()}
      </View>
    </SheetModal>
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: spacing.xxs,
      borderRadius: radius.md,
      paddingVertical: spacing.smd,
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
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.xxs },
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
