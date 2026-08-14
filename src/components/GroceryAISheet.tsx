import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
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
import { useGroceryStore } from '../store/useGroceryStore';
import {
  suggestGroceryAisles,
  suggestRecipeGroceries,
  describeAIError,
  type RecipeGroceryItem,
} from '../services/aiSuggestions';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { groceryNameKey } from '../utils/groceryParse';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { useRecipePhotoSource } from '../hooks/useRecipePhotoSource';
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
 * Both modes are gated on `!!anthropicApiKey` at the call site, so a user
 * without one never sees the entry points at all.
 */
export function GroceryAISheet({ visible, mode, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const setAisleMany = useGroceryStore(s => s.setAisleMany);
  const addByName = useGroceryStore(s => s.addByName);
  const setAisle = useGroceryStore(s => s.setAisle);
  const setQuantity = useGroceryStore(s => s.setQuantity);
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tidyRows, setTidyRows] = useState<TidyRow[]>([]);
  const [recipeRows, setRecipeRows] = useState<RecipeGroceryItem[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const recipeInput = useRecipePhotoSource();
  const { source: recipeSource, reset: resetRecipeInput } = recipeInput;

  // Anything currently sitting in the catch-all and on the list — the exact
  // gap the lexicon left.
  const unsorted = useMemo(
    () => items.filter(i => i.onList && i.aisle === OTHER_AISLE),
    [items]
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setTidyRows([]);
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
      setLoading(false);
    }
  }, [unsorted, aisleOrder]);

  const runRecipe = useCallback(async () => {
    if (!recipeSource) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await suggestRecipeGroceries(recipeSource, [...aisleOrder]);
      setRecipeRows(rows);
      setAccepted(new Set(rows.map((_, i) => i)));
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [recipeSource, aisleOrder]);

  // Tidy has everything it needs the moment it opens; recipe needs text first.
  useEffect(() => {
    if (visible && mode === 'tidy' && unsorted.length > 0) void runTidy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode]);

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
      const addedIds: string[] = [];
      recipeRows.forEach((row, i) => {
        if (!accepted.has(i)) return;
        // A row already on the list before this apply isn't something *this*
        // action added — same distinction addManyFromText draws — so it's
        // excluded from what undo removes.
        const key = groceryNameKey(row.name);
        const before = key ? useGroceryStore.getState().items.find(it => it.nameKey === key) : undefined;
        const wasOnList = before?.onList === true;
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
        useGroceryStore.getState().setLastAction({
          label: `${addedIds.length} item${addedIds.length === 1 ? '' : 's'} added`,
          undo: () => useGroceryStore.getState().removeFromListMany(addedIds),
        });
      }
    }
    haptics.success();
    onClose();
  };

  const rowCount = mode === 'tidy' ? tidyRows.length : recipeRows.length;
  const canApply = !loading && accepted.size > 0;

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.loadingText}>
            {mode === 'tidy'
              ? 'Working out where these live…'
              : recipeInput.usingPhoto ? 'Reading the photo…' : 'Reading the recipe…'}
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
            onAction={mode === 'tidy' ? runTidy : runRecipe}
          />
        </View>
      );
    }

    if (mode === 'recipe' && recipeRows.length === 0) {
      return (
        <ScrollView contentContainerStyle={styles.pasteWrap} keyboardShouldPersistTaps="handled">
          <RecipeSourcePicker
            intro="Paste a recipe or photograph the page. You’ll get back what to buy, named the way a store labels it rather than the way the recipe chops it."
            mode={recipeInput.mode}
            onChangeMode={recipeInput.setMode}
            text={recipeInput.text}
            onChangeText={recipeInput.setText}
            photo={recipeInput.photo}
            onPickPhoto={recipeInput.pick}
            onClearPhoto={recipeInput.clearPhoto}
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

    if (rowCount === 0) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="checkmark-circle-outline"
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
            ? 'Untick anything you’d rather leave where it is.'
            : 'Untick anything you already have.'}
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={14} color={colors.purple} />
            <Text style={styles.headerTitle}>
              {mode === 'tidy' ? 'Sort into aisles' : 'From a recipe'}
            </Text>
          </View>
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
