import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { InlineAction } from './InlineAction';
import { InlineEditableText } from './InlineEditableText';
import { ExtractedIngredientRow } from './ExtractedIngredientRow';
import { RecipeComponentPicker } from './RecipeComponentPicker';
import { HelpText } from './HelpText';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, checkboxRadius, type Colors,
} from '../theme';
import { RECIPE_NAME_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types';
import type { Recipe } from '../types';
import type { ExtractedRecipe, RecipeGroceryItem } from '../services/aiSuggestions';
import { useGroceryStore } from '../store/useGroceryStore';
import { usePendingEdits } from '../hooks/usePendingEdits';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { aisleForName } from '../utils/groceryAisles';
import { sectionsOf } from '../utils/recipeSections';
import {
  applyComponentDraft, componentDraftChanged, draftOfComponent, type ComponentDraft,
} from '../utils/recipeImportComponents';
import { confirmDiscard } from '../utils/confirmDiscard';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  /** What the referencing page called it: the name shown when the read gave none. */
  fallbackName: string;
  extracted: ExtractedRecipe;
  /** The recipe being imported into, or null before it exists. Passed to the picker. */
  parent: Recipe | null;
  onSave: (extracted: ExtractedRecipe) => void;
  /** "Use a recipe from my box instead": the read is thrown away and this one is linked. */
  onLink: (recipe: Recipe) => void;
  onClose: () => void;
}

/**
 * Corrects a component recipe that a photo was read into, before the main
 * import is confirmed. Without it the only way to fix a misread ingredient in a
 * component was to finish the import, open the component and edit it there.
 *
 * It is `RecipeCreateSheet`'s review list in miniature, built from the same
 * rows: a name, ingredients that can be reworded or left out
 * (`ExtractedIngredientRow`), and method steps that can be reworded or left
 * out. Servings, prep time, prep tasks and the source ride through untouched.
 *
 * **Nothing is written to the recipe box from here.** Done hands the corrected
 * read back to the import's own state and the main sheet's Create/Add writes it
 * with everything else, so backing out of the import still leaves nothing behind.
 *
 * "Use a recipe from my box instead" is the way out of a read that came back
 * wrong: it drops the read and links the recipe picked, the same as "Find in
 * recipe box" on a row that was never read.
 */
export function ImportedComponentEditSheet({
  visible, fallbackName, extracted, parent, onSave, onLink, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const addToPantry = useGroceryStore(s => s.addToPantry);
  const edits = usePendingEdits();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [draft, setDraft] = useState<ComponentDraft>(() => draftOfComponent(extracted, fallbackName));
  const [pickerVisible, setPickerVisible] = useState(false);

  // Reseeded on every open rather than kept: a sheet closed with Cancel must
  // not hand its abandoned edits to the next open.
  useEffect(() => {
    if (visible) setDraft(draftOfComponent(extracted, fallbackName));
    // `extracted` is deliberately not a dependency: it changes when Done writes
    // it back, and that must not reseed a sheet that is on its way out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const existingSections = useMemo(
    () => sectionsOf(draft.ingredients.map((row, i) => ({ id: String(i), section: row.section }))),
    [draft.ingredients],
  );

  const toggleIn = (key: 'acceptedIngredients' | 'acceptedSteps', index: number) => {
    setDraft(prev => {
      const next = new Set(prev[key]);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...prev, [key]: next };
    });
  };

  // A renamed line is filed afresh ("chicken breast" under Meat is wrong once
  // the row says "tofu"), with the same precedence the main import uses.
  const patchIngredient = (
    row: RecipeGroceryItem,
    patch: Partial<Pick<RecipeGroceryItem, 'name' | 'quantity' | 'section'>>,
  ): RecipeGroceryItem => {
    const next = { ...row, ...patch };
    if (patch.name !== undefined) {
      next.aisle = rememberedAisleFor(patch.name) ?? aisleForName(patch.name) ?? 'Other';
    }
    return next;
  };

  const editIngredient = (
    index: number, patch: Partial<Pick<RecipeGroceryItem, 'name' | 'quantity' | 'section'>>,
  ) => {
    haptics.success();
    setDraft(prev => ({
      ...prev,
      ingredients: prev.ingredients.map((row, i) => (i === index ? patchIngredient(row, patch) : row)),
    }));
  };

  const editStep = (index: number, text: string) => {
    haptics.success();
    setDraft(prev => ({ ...prev, steps: prev.steps.map((step, i) => (i === index ? text : step)) }));
  };

  // Tapping Done can beat a field's own blur, so what is still being typed is
  // merged over the state before it is read (see `usePendingEdits`).
  const settledDraft = (): ComponentDraft => {
    const pending = edits.resolveAll();
    return {
      ...draft,
      ingredients: draft.ingredients.map((row, i) => {
        const name = pending.get(`ingredient:${i}:name`);
        const quantity = pending.get(`ingredient:${i}:quantity`);
        return patchIngredient(row, {
          ...(name !== undefined ? { name } : {}),
          ...(quantity !== undefined ? { quantity } : {}),
        });
      }),
      steps: draft.steps.map((step, i) => pending.get(`step:${i}`) ?? step),
    };
  };

  const handleDone = () => {
    haptics.tap();
    onSave(applyComponentDraft(extracted, settledDraft()));
    onClose();
  };

  const handleCancel = () => {
    if (!componentDraftChanged(extracted, settledDraft(), fallbackName)) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const keptIngredients = draft.acceptedIngredients.size;
  const ingredientMeta = `${keptIngredients} of ${draft.ingredients.length} kept`;

  return (
    <SheetModal
      visible={visible}
      name="ImportedComponentEditSheet"
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title={draft.name.trim() || fallbackName}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={72} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={handleDone} minWidth={72} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <View style={styles.nameCard}>
            <Text style={styles.label}>NAME</Text>
            <TextField
              style={styles.nameInput}
              value={draft.name}
              onChangeText={name => setDraft(prev => ({ ...prev, name }))}
              placeholder="Recipe name"
              placeholderTextColor={colors.textTertiary}
              maxLength={RECIPE_NAME_MAX_LENGTH}
              accessibilityLabel="Recipe name"
            />
          </View>

          {draft.ingredients.length > 0 && (
            <>
              <Text style={styles.groupLabel}>INGREDIENTS</Text>
              <Text style={styles.meta}>{ingredientMeta}</Text>
              {draft.ingredients.map((row, i) => (
                <ExtractedIngredientRow
                  key={`${row.name}-${i}`}
                  row={row}
                  edits={edits}
                  index={i}
                  checked={draft.acceptedIngredients.has(i)}
                  onToggle={() => toggleIn('acceptedIngredients', i)}
                  onEditName={name => editIngredient(i, { name })}
                  onEditQuantity={quantity => editIngredient(i, { quantity })}
                  onEditSection={section => editIngredient(i, { section })}
                  onMarkAlreadyHave={() => {
                    const item = addToPantry(row.name);
                    if (!item) { haptics.error(); return; }
                    haptics.success();
                  }}
                  existingSections={existingSections}
                  catalogItems={groceryItems}
                  sectionHeader={
                    row.section && row.section !== (i > 0 ? draft.ingredients[i - 1].section : null)
                      ? row.section
                      : null
                  }
                />
              ))}
            </>
          )}

          {draft.steps.length > 0 && (
            <>
              <Text style={styles.groupLabel}>METHOD</Text>
              <Text style={styles.meta}>{`${draft.acceptedSteps.size} of ${draft.steps.length} kept`}</Text>
              {draft.steps.map((step, i) => {
                const kept = draft.acceptedSteps.has(i);
                return (
                  <View key={`step-${i}`} style={styles.stepRow}>
                    <TouchableOpacity
                      onPress={() => { haptics.tap(); toggleIn('acceptedSteps', i); }}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: kept }}
                      accessibilityLabel={`Step ${i + 1}`}
                    >
                      <View style={[styles.checkbox, kept && styles.checkboxOn]}>
                        {kept && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onFill} />}
                      </View>
                    </TouchableOpacity>
                    <Text style={styles.stepIndex}>{i + 1}.</Text>
                    <View style={styles.stepBody}>
                      <InlineEditableText
                        edits={edits}
                        editKey={`step:${i}`}
                        value={step}
                        onCommit={text => editStep(i, text)}
                        textStyle={[styles.stepText, !kept && styles.dropped]}
                        accessibilityLabel={`step ${i + 1}`}
                        maxLength={TITLE_MAX_LENGTH}
                        multiline
                      />
                    </View>
                  </View>
                );
              })}
            </>
          )}

          <View style={styles.swap}>
            <InlineAction
              label="Use a recipe from my box instead"
              icon="search-outline"
              variant="neutral"
              surface="page"
              onPress={() => setPickerVisible(true)}
              haptic
              accessibilityLabel="Use a recipe from your recipe box instead of this one"
            />
            <HelpText style={styles.swapHint}>
              Drops this read and links the recipe you pick.
            </HelpText>
          </View>
        </ScrollView>

        {/* Inside the sheet's own children, so it presents from this sheet
            rather than from the root (see "Two sibling Modals" in CLAUDE.md). */}
        <RecipeComponentPicker
          visible={pickerVisible}
          recipe={parent}
          onClose={() => setPickerVisible(false)}
          onSelect={picked => {
            setPickerVisible(false);
            onLink(picked);
            onClose();
          }}
        />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
    nameCard: {
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    label: {
      color: colors.textSecondary,
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
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    meta: {
      color: colors.textTertiary,
      fontSize: font.xs,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xxs,
      paddingBottom: spacing.xs,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.smd,
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
    checkboxOn: { backgroundColor: colors.purpleFill, borderColor: colors.purpleFill },
    stepIndex: { color: colors.textTertiary, fontSize: font.md, minWidth: 18 },
    stepBody: { flex: 1 },
    stepText: { color: colors.text, fontSize: font.md },
    dropped: { color: colors.textTertiary, textDecorationLine: 'line-through' },
    swap: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, alignItems: 'flex-start' },
    swapHint: { color: colors.textTertiary, fontSize: font.xs, paddingTop: spacing.xs },
  });
}
