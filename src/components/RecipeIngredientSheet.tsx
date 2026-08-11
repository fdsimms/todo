import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeIngredient } from '../types';
import {
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
  PREP_MAX_LENGTH,
  RECIPE_CHOICE_GROUP_MAX_LENGTH,
  RECIPE_SECTION_MAX_LENGTH,
} from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { aisleForName } from '../utils/groceryAisles';
import { suggestShorterCatalogName } from '../utils/groceryParse';
import { cleanChoiceGroup } from '../utils/recipeUtils';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

interface Props {
  visible: boolean;
  recipeId: string;
  ingredient: RecipeIngredient | null;
  onClose: () => void;
}

/**
 * One ingredient: what to buy, how much, and — only if you disagree with where
 * it'd otherwise land — which aisle.
 *
 * The aisle grid opens on "Wherever it usually goes", which is the honest
 * default and the one that stays right as the user's own filings change. An
 * explicit choice here is an override that travels with the recipe, so the
 * collapsed row names what will actually happen rather than leaving it blank.
 */
export function RecipeIngredientSheet({ visible, recipeId, ingredient, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updateIngredient = useRecipeStore(s => s.updateIngredient);
  const recipeIngredients = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.ingredients ?? [])
  );
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const catalogKeys = useMemo(
    () => new Set(groceryItems.map(i => i.nameKey)),
    [groceryItems]
  );

  // The recipe's other either/or labels, so joining an existing group is a tap
  // and can't be misspelled into a lookalike group of one — the label *is* the
  // grouping key, same as an aisle name.
  const otherChoiceGroups = useMemo(() => {
    const labels: string[] = [];
    for (const other of recipeIngredients) {
      if (other.choiceGroup && other.id !== ingredient?.id && !labels.includes(other.choiceGroup)) {
        labels.push(other.choiceGroup);
      }
    }
    return labels;
  }, [recipeIngredients, ingredient?.id]);

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [prep, setPrep] = useState('');
  const [purpose, setPurpose] = useState('');
  const [section, setSection] = useState('');
  const [choiceGroup, setChoiceGroup] = useState('');
  const [aisle, setAisle] = useState<string | null>(null);

  useEffect(() => {
    if (!ingredient) return;
    setName(ingredient.name);
    setQuantity(ingredient.quantity);
    setPrep(ingredient.prep ?? '');
    setPurpose(ingredient.purpose ?? '');
    setSection(ingredient.section ?? '');
    setChoiceGroup(ingredient.choiceGroup ?? '');
    setAisle(ingredient.aisle);
  }, [ingredient]);

  const saveAndClose = () => {
    if (!ingredient) { onClose(); return; }
    const trimmed = name.trim();
    // An emptied name would strand the row — keep the old one rather than
    // storing something nothing can shop for.
    updateIngredient(recipeId, ingredient.id, {
      name: trimmed || ingredient.name,
      quantity: quantity.trim(),
      prep: prep.trim() || null,
      purpose: purpose.trim() || null,
      section: section.trim() || null,
      choiceGroup: cleanChoiceGroup(choiceGroup),
      aisle,
    });
    onClose();
  };

  if (!ingredient) return null;

  // What "wherever it usually goes" will actually resolve to, said out loud:
  // the user's own filing first, then the offline lexicon, then Other. Same
  // precedence addByName applies.
  const defaultAisle = rememberedAisleFor(name) ?? aisleForName(name) ?? 'Other';

  // A one-tap correction for the offline parser's known limit: a leading
  // prep/unit word it didn't recognise ("cloves garlic") stays in the name,
  // but if the shorter name is already something in the catalog, that's
  // confirmation rather than a guess — see suggestShorterCatalogName.
  const catalogSuggestion = suggestShorterCatalogName(name, catalogKeys);

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={40} />
          <Text style={styles.headerTitle}>Ingredient</Text>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>What to buy</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Ingredient"
          placeholderTextColor={colors.textTertiary}
          maxLength={GROCERY_NAME_MAX_LENGTH}
          autoCapitalize="none"
          accessibilityLabel="Ingredient name"
        />
        {!!catalogSuggestion && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setName(catalogSuggestion); }}
            accessibilityRole="button"
            accessibilityLabel={`Use "${catalogSuggestion}" instead — it's already in your catalog`}
          >
            <Text style={styles.suggestionText}>
              Did you mean “{catalogSuggestion}”? Already in your catalog.
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>How much</Text>
        <TextInput
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          placeholder="2 lb, 1 bunch, a pinch"
          placeholderTextColor={colors.textTertiary}
          maxLength={GROCERY_QUANTITY_MAX_LENGTH}
          accessibilityLabel="Quantity"
        />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Prep</Text>
        <TextInput
          style={styles.input}
          value={prep}
          onChangeText={setPrep}
          placeholder="peeled and sliced, room temperature…"
          placeholderTextColor={colors.textTertiary}
          maxLength={PREP_MAX_LENGTH}
          accessibilityLabel="Prep instructions"
        />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>For</Text>
        <TextInput
          style={styles.input}
          value={purpose}
          onChangeText={setPurpose}
          placeholder="margaritas, dusting…"
          placeholderTextColor={colors.textTertiary}
          maxLength={PREP_MAX_LENGTH}
          accessibilityLabel="Purpose"
        />
        <Text style={styles.groupLabel}>Section</Text>
        <TextInput
          style={styles.input}
          value={section}
          onChangeText={setSection}
          placeholder="For the cake, For the frosting…"
          placeholderTextColor={colors.textTertiary}
          maxLength={RECIPE_SECTION_MAX_LENGTH}
          accessibilityLabel="Recipe section"
        />
        <Text style={styles.hint}>
          Groups this with other ingredients under the same heading, for recipes with more
          than one component. Leave it blank to keep the ingredient ungrouped.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Alternative for</Text>
        <TextInput
          style={styles.input}
          value={choiceGroup}
          onChangeText={setChoiceGroup}
          placeholder="Pepper, Cheese…"
          placeholderTextColor={colors.textTertiary}
          maxLength={RECIPE_CHOICE_GROUP_MAX_LENGTH}
          accessibilityLabel="Alternative for"
        />
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, !cleanChoiceGroup(choiceGroup) && styles.pillActive]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setChoiceGroup(''); }}
            accessibilityRole="button"
            accessibilityState={{ selected: !cleanChoiceGroup(choiceGroup) }}
            accessibilityLabel="Always needed"
          >
            <Text style={[styles.pillText, !cleanChoiceGroup(choiceGroup) && styles.pillTextActive]}>
              Always needed
            </Text>
          </TouchableOpacity>
          {otherChoiceGroups.map(existing => (
            <TouchableOpacity
              key={existing}
              style={[styles.pill, cleanChoiceGroup(choiceGroup) === existing && styles.pillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setChoiceGroup(existing); }}
              accessibilityRole="button"
              accessibilityState={{ selected: cleanChoiceGroup(choiceGroup) === existing }}
              accessibilityLabel={existing}
            >
              <Text style={[styles.pillText, cleanChoiceGroup(choiceGroup) === existing && styles.pillTextActive]}>
                {existing}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>
          Ingredients sharing a label are alternatives — “Serrano” and “Jalapeño” both filed
          under “Pepper”, and you pick which one when you add the recipe to your list. Only the
          one you pick gets bought, and each keeps its own name in your catalog.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Aisle</Text>
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, aisle === null && styles.pillActive]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); animateLayout(); setAisle(null); }}
            accessibilityRole="button"
            accessibilityState={{ selected: aisle === null }}
            accessibilityLabel={`Wherever it usually goes, currently ${defaultAisle}`}
          >
            <Text style={[styles.pillText, aisle === null && styles.pillTextActive]}>
              Usually {defaultAisle}
            </Text>
          </TouchableOpacity>
          {aisleOrder.map(name => (
            <TouchableOpacity
              key={name}
              style={[styles.pill, aisle === name && styles.pillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setAisle(name); }}
              accessibilityRole="button"
              accessibilityState={{ selected: aisle === name }}
              accessibilityLabel={name}
            >
              <Text style={[styles.pillText, aisle === name && styles.pillTextActive]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>
          Leave it on “usually” unless this recipe needs it somewhere else — that way it
          follows wherever you file the item later.
        </Text>
      </View>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  // Balances the Done button so the title stays optically centered.
  headerSpacer: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  groupLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    color: colors.text,
    fontSize: font.md,
    // A box height, never lineHeight — see the TextInput note in CLAUDE.md.
    minHeight: 36,
  },
  suggestionRow: {
    paddingBottom: spacing.xs,
  },
  suggestionText: {
    color: colors.accent,
    fontSize: font.sm,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pill: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pillActive: {
    backgroundColor: colors.accent,
  },
  pillText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  pillTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.medium,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: font.xs * 1.4,
  },
});
