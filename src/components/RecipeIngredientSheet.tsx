import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { aisleForName } from '../utils/groceryAisles';
import { splitAlternativeNames, suggestShorterCatalogName } from '../utils/groceryParse';
import { cleanChoiceGroup } from '../utils/recipeUtils';
import { describeCatalogItem } from '../utils/groceryProduct';
import { sectionsOf } from '../utils/recipeSections';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';
import { SegmentedControl } from './SegmentedControl';
import { PillGroup } from './PillGroup';
import { GroceryItemSheet } from './GroceryItemSheet';

interface Props {
  visible: boolean;
  recipeId: string;
  ingredient: RecipeIngredient | null;
  onClose: () => void;
}

/**
 * One ingredient line: what to buy, how much, which part of the recipe it
 * belongs to, and whether it's one of a choice.
 *
 * **An ingredient is a grocery item that isn't on a list yet**, and this sheet
 * is where that stops being a claim in a doc comment. `nameKey` has always been
 * the bridge, but nothing here ever showed what was on the other side of it —
 * so the same cottage cheese had a brand, a store and a substitute in one place
 * and was a bare string in the other. The catalog card below names the row this
 * line resolves to and opens it, so the brand to reach for and the substitute
 * you'd accept are set once, from either end.
 *
 * Everything else is progressive disclosure in the shape the editors use: the
 * fields that are always worth seeing, then the two labels — section and
 * alternatives — that most lines never carry.
 */
export function RecipeIngredientSheet({ visible, recipeId, ingredient, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updateIngredient = useRecipeStore(s => s.updateIngredient);
  const splitIngredientAlternatives = useRecipeStore(s => s.splitIngredientAlternatives);
  const recipeIngredients = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.ingredients ?? [])
  );
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
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

  // Every section this recipe already uses, in list order. Same idea as the
  // choice labels above and for the same reason: a section is a *string* shared
  // across rows, so typing it again by hand is how one recipe ends up with "For
  // the cake" and "For the Cake" as two headings.
  const existingSections = useMemo(() => sectionsOf(recipeIngredients), [recipeIngredients]);

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [prep, setPrep] = useState('');
  const [purpose, setPurpose] = useState('');
  const [section, setSection] = useState('');
  const [choiceGroup, setChoiceGroup] = useState('');
  // Held apart from the label rather than derived from it, because the two
  // genuinely differ for one state: "one of a choice, group not named yet".
  // Derived, tapping "One of a choice" on the first ingredient in a recipe with
  // no groups would set an empty label, read back as ungrouped, and snap the
  // control straight back — the picker below is where the group gets named.
  const [choiceOn, setChoiceOn] = useState(false);
  const [aisle, setAisle] = useState<string | null>(null);
  // Nested rather than a sibling: a Modal presents from its React parent's view
  // controller, so a sibling would ask this sheet's own presenter for a second
  // presentation while this one is up. Same call PantrySheet makes, and it's
  // what keeps this sheet underneath while the item is edited.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!ingredient) return;
    setName(ingredient.name);
    setQuantity(ingredient.quantity);
    setPrep(ingredient.prep ?? '');
    setPurpose(ingredient.purpose ?? '');
    setSection(ingredient.section ?? '');
    setChoiceGroup(ingredient.choiceGroup ?? '');
    setChoiceOn(!!ingredient.choiceGroup);
    setAisle(ingredient.aisle);
    setEditingItemId(null);
  }, [ingredient]);

  // The catalog row this line resolves to. Above the early return, like every
  // other hook here — an ingredient sheet with nothing to edit still has to run
  // the same hooks in the same order.
  const catalogItem = useMemo(
    () => (ingredient ? groceryItems.find(i => i.nameKey === ingredient.nameKey) ?? null : null),
    [groceryItems, ingredient]
  );

  // Who this line is currently an alternative to, by name. The label alone is
  // an abstraction ("Pepper"); the siblings are the thing it actually means.
  const siblingNames = useMemo(() => {
    const label = cleanChoiceGroup(choiceGroup);
    if (!label || !ingredient) return [];
    return recipeIngredients
      .filter(other => other.id !== ingredient.id && other.choiceGroup === label)
      .map(other => other.name);
  }, [recipeIngredients, ingredient, choiceGroup]);

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

  // "cheddar or manchego" wants to be two rows in a choice group, not one
  // catalog entry nothing can ever match — see splitAlternativeNames. Offered,
  // never applied on its own: the split is verbatim, so "chicken or vegetable
  // stock" needs a human to finish it.
  const alternatives = splitAlternativeNames(name);

  const catalogSummary = catalogItem
    ? describeCatalogItem(catalogItem, itemSubs, groceryItems, new Date())
    : null;

  const groupLabel = cleanChoiceGroup(choiceGroup);

  const acceptSplit = () => {
    if (!ingredient || !alternatives) return;
    // The label defaults to the line as written — the one name guaranteed to
    // exist, to be unique among this recipe's groups, and to mean something to
    // whoever typed it. It's editable from the group picker below if not.
    const created = splitIngredientAlternatives(
      recipeId, ingredient.id, alternatives, name.trim()
    );
    if (!created) return;
    haptics.success();
    animateLayout();
    onClose();
  };

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
          placeholder="e.g. chicken thighs"
          placeholderTextColor={colors.textTertiary}
          maxLength={GROCERY_NAME_MAX_LENGTH}
          autoCapitalize="none"
          accessibilityLabel="Ingredient name"
        />
        {!!alternatives && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={acceptSplit}
            accessibilityRole="button"
            accessibilityLabel={`Split into ${alternatives.length} alternatives: ${alternatives.join(', ')}`}
          >
            <Ionicons name="git-branch-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>
                Split into {alternatives.length} alternatives?
              </Text>
              {/* The parts, verbatim and up front: this is the half a person
                  has to check, since the split can't distribute a trailing
                  noun ("chicken or vegetable stock") — see
                  splitAlternativeNames. */}
              <Text style={styles.suggestionDetail}>{alternatives.join('  ·  ')}</Text>
              <Text style={styles.suggestionDetail}>
                Each becomes its own line. You pick one when you add this to your list.
              </Text>
            </View>
          </TouchableOpacity>
        )}
        {!!catalogSuggestion && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setName(catalogSuggestion); }}
            accessibilityRole="button"
            accessibilityLabel={`Use "${catalogSuggestion}" instead, it's already in your catalog`}
          >
            <Ionicons name="sparkles-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>Did you mean “{catalogSuggestion}”?</Text>
              <Text style={styles.suggestionDetail}>Already in your catalog.</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.separator} />

        <Text style={styles.groupLabel}>How much</Text>
        <TextInput
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          placeholder="e.g. 2 lb"
          placeholderTextColor={colors.textTertiary}
          maxLength={GROCERY_QUANTITY_MAX_LENGTH}
          accessibilityLabel="Quantity"
        />

        <View style={styles.separator} />

        <Text style={styles.groupLabel}>Prep</Text>
        <TextInput
          style={styles.input}
          value={prep}
          onChangeText={setPrep}
          placeholder="e.g. peeled and sliced"
          placeholderTextColor={colors.textTertiary}
          maxLength={PREP_MAX_LENGTH}
          accessibilityLabel="Prep instructions"
        />
        <Text style={styles.hint}>What to do to it. Shown on the recipe, never on your list.</Text>

        <View style={styles.separator} />

        <Text style={styles.groupLabel}>For</Text>
        <TextInput
          style={styles.input}
          value={purpose}
          onChangeText={setPurpose}
          placeholder="e.g. margaritas"
          placeholderTextColor={colors.textTertiary}
          maxLength={PREP_MAX_LENGTH}
          accessibilityLabel="Purpose"
        />
        <Text style={styles.hint}>
          Why it's on the list, when the same ingredient does two jobs — “flour, for dusting”.
        </Text>
      </View>

      {/* The other half of this line's identity. See the component note: the
          bridge has always existed, this is the first place it's visible. */}
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>In your groceries</Text>
        {catalogItem ? (
          <TouchableOpacity
            style={styles.catalogRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setEditingItemId(catalogItem.id); }}
            accessibilityRole="button"
            accessibilityLabel={`${catalogItem.name}${catalogSummary ? `, ${catalogSummary}` : ''}`}
            accessibilityHint="Double tap to edit the grocery item: its brand, stores, pantry and substitutes"
          >
            <Ionicons name="cart-outline" size={iconSize.md} color={colors.accent} />
            <View style={styles.catalogBody}>
              <Text style={styles.catalogName} numberOfLines={1}>{catalogItem.name}</Text>
              {!!catalogSummary && (
                <Text style={styles.catalogMeta} numberOfLines={2}>{catalogSummary}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.hint}>
            Not in your groceries yet. It's added the first time you put this on a list, and
            then it can carry a brand, a store, a price and what you'd accept instead.
          </Text>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Alternatives</Text>
        {/* A closed two-way question about this line, so a track rather than
            the free-text box this used to be. That box was labelled
            "Alternative for" and held a *grouping key*, which meant the first
            option of a pair had to be filed as an alternative for itself —
            a question nobody could answer without knowing the data model. */}
        <SegmentedControl
          label="Alternatives"
          value={choiceOn ? 'choice' : 'always'}
          onChange={next => {
            haptics.tap();
            animateLayout();
            setChoiceOn(next === 'choice');
            if (next === 'always') setChoiceGroup('');
            // Joining the recipe's only existing group is the overwhelmingly
            // common intent, and it saves a tap. With none it stays unnamed and
            // the picker below opens on its "New group" button.
            else if (!groupLabel) setChoiceGroup(otherChoiceGroups[0] ?? '');
          }}
          options={[
            { value: 'always', label: 'Always needed' },
            { value: 'choice', label: 'One of a choice' },
          ]}
        />
        {choiceOn ? (
          <>
            <PillGroup
              noun="group"
              surface="card"
              filterPlaceholder="Find or name a group…"
              createMaxLength={RECIPE_CHOICE_GROUP_MAX_LENGTH}
              onCreate={label => {
                const cleaned = cleanChoiceGroup(label);
                if (!cleaned) return 'Give the group a name.';
                setChoiceGroup(cleaned);
              }}
              options={[
                // A group named on this line and nowhere else yet has no pill of
                // its own in the list below, so it gets a pinned one — otherwise
                // the label the user just typed is stored and invisible.
                ...(!groupLabel || otherChoiceGroups.includes(groupLabel)
                  ? []
                  : [{
                      key: '__current__',
                      label: groupLabel,
                      pinned: true,
                      selected: true,
                      onPress: () => {},
                    }]),
                ...otherChoiceGroups.map(label => ({
                  key: label,
                  label,
                  selected: groupLabel === label,
                  onPress: () => { haptics.tap(); setChoiceGroup(label); },
                })),
              ]}
            />
            {!groupLabel ? (
              <Text style={styles.hint}>
                Name the group these alternatives share — “Pepper”, “Cheese”. Every ingredient
                under it is one way of filling the same slot.
              </Text>
            ) : siblingNames.length > 0 ? (
              <Text style={styles.hint}>
                You'll buy this <Text style={styles.hintStrong}>or</Text>{' '}
                {siblingNames.join(' or ')} — never both.
              </Text>
            ) : (
              <Text style={styles.hint}>
                Nothing else is in “{groupLabel}” yet. Put another ingredient in it and the two
                become alternatives.
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.hint}>
            Every line is needed unless it's one of a choice. Two lines in the same group —
            “Serrano” and “Jalapeño” both under “Pepper” — mean you buy one of them, picked
            when you add the recipe to your list or left open until you're at the store.
          </Text>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Section</Text>
        {/* A picker over the sections this recipe already has, not a text field
            that had to be spelled identically each time — that's how one recipe
            ends up with "For the cake" and "For the Cake" as two headings. */}
        <PillGroup
          noun="section"
          surface="card"
          filterPlaceholder="Find or name a section…"
          createMaxLength={RECIPE_SECTION_MAX_LENGTH}
          onCreate={label => {
            const cleaned = label.trim().slice(0, RECIPE_SECTION_MAX_LENGTH);
            if (!cleaned) return 'Give the section a name.';
            setSection(cleaned);
          }}
          options={[
            {
              key: '__none__',
              label: 'No section',
              pinned: true,
              selected: !section.trim(),
              onPress: () => { haptics.tap(); animateLayout(); setSection(''); },
            },
            ...(existingSections.includes(section.trim()) || !section.trim()
              ? []
              : [{
                  key: '__current__',
                  label: section.trim(),
                  pinned: true,
                  selected: true,
                  onPress: () => {},
                }]),
            ...existingSections.map(label => ({
              key: label,
              label,
              selected: section.trim() === label,
              onPress: () => { haptics.tap(); setSection(label); },
            })),
          ]}
        />
        <Text style={styles.hint}>
          Puts this under a heading on the recipe — “For the cake”, “For the frosting”. It
          changes nothing about your shopping list.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Aisle</Text>
        {/* Sixteen aisles ship by default and the user can add more, so the
            grid caps itself and grows a filter — see PillGroup. "Usually X" is
            pinned: it's the option that means *no* choice, and burying the
            default behind a disclosure makes it look unavailable. */}
        <PillGroup
          noun="aisle"
          surface="card"
          filterPlaceholder="Find an aisle…"
          options={[
            {
              key: '__default__',
              label: `Usually ${defaultAisle}`,
              pinned: true,
              selected: aisle === null,
              accessibilityLabel: `Wherever it usually goes, currently ${defaultAisle}`,
              onPress: () => { haptics.tap(); animateLayout(); setAisle(null); },
            },
            ...aisleOrder.map(name => ({
              key: name,
              label: name,
              selected: aisle === name,
              onPress: () => { haptics.tap(); setAisle(name); },
            })),
          ]}
        />
        <Text style={styles.hint}>
          Leave it on “usually” unless this recipe needs it somewhere else — that way it
          follows wherever you file the item later.
        </Text>
      </View>

      <GroceryItemSheet
        visible={editingItemId !== null}
        itemId={editingItemId}
        onClose={() => setEditingItemId(null)}
      />
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
  // The four fields of "what the line says" are one card now rather than four,
  // so the sheet opens on the whole line instead of on a stack of boxes; these
  // keep them from running together inside it.
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginVertical: spacing.xs,
  },
  groupLabel: {
    color: colors.textSecondary,
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
  // A card rather than the line of bare accent text these used to be: both are
  // buttons, and an action in this app gets a shape — as a link-coloured
  // paragraph under a text field, the offer read as a caption about the field
  // and went unpressed. See CLAUDE.md's note on bare accent text.
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  suggestionBody: {
    flex: 1,
    gap: 1,
  },
  suggestionTitle: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  suggestionDetail: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  catalogBody: {
    flex: 1,
    gap: 2,
  },
  catalogName: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  catalogMeta: {
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: font.xs * 1.4,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: font.xs * 1.4,
  },
  hintStrong: {
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
  },
});
