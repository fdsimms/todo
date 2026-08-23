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
import { allSectionsOf } from '../utils/recipeSections';
import { standingSwapMap } from '../utils/standingSwaps';
import { disclosureValue } from '../theme/textStyles';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';
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
  const renameChoiceGroup = useRecipeStore(s => s.renameChoiceGroup);
  const recipeIngredients = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.ingredients ?? [])
  );
  const recipeEmptySections = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.emptySections ?? [])
  );
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const catalogKeys = useMemo(
    () => new Set(groceryItems.map(i => i.nameKey)),
    [groceryItems]
  );

  // Every heading this recipe already has, in list order — including one
  // declared with nothing under it yet (Recipe.emptySections). A section is a
  // *string* shared across rows, so typing it again by hand is how one recipe
  // ends up with "For the cake" and "For the Cake" as two headings.
  const existingSections = useMemo(
    () => allSectionsOf(recipeIngredients, recipeEmptySections),
    [recipeIngredients, recipeEmptySections]
  );

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [prep, setPrep] = useState('');
  const [purpose, setPurpose] = useState('');
  const [section, setSection] = useState('');
  const [choiceGroup, setChoiceGroup] = useState('');
  // Renaming edits every member of the group (see renameChoiceGroup), so it's
  // its own inline field rather than the PillGroup's create box — creating
  // there means "start a new group", not "reword this one".
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [aisle, setAisle] = useState<string | null>(null);
  // The per-line exception to a standing swap — "this pastry needs real
  // butter" (RecipeIngredient.noSwap).
  const [noSwap, setNoSwap] = useState(false);
  // Nested rather than a sibling: a Modal presents from its React parent's view
  // controller, so a sibling would ask this sheet's own presenter for a second
  // presentation while this one is up. Same call BuyAgainSheet makes, and it's
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
    setEditingGroupName(false);
    setAisle(ingredient.aisle);
    setNoSwap(!!ingredient.noSwap);
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

  const groupLabel = cleanChoiceGroup(choiceGroup);

  // Writes this ingredient's own choiceGroup immediately, rather than
  // deferring it to Done like the rest of the sheet's fields. It has to: the
  // group is shared state with other rows (join/leave writes them the same
  // way, right below), and renaming reads every row's *current* stored label
  // — if this row's own change waited for Done, a rename mid-session would
  // see it still holding the old one and miss it.
  const applyChoiceGroup = (label: string | null) => {
    const clean = cleanChoiceGroup(label);
    setChoiceGroup(clean ?? '');
    if (ingredient) updateIngredient(recipeId, ingredient.id, { choiceGroup: clean });
  };

  // Returns the resolved label so saveAndClose can use it directly: a rename
  // made through this same call writes the store immediately but the local
  // `choiceGroup` state won't reflect that until a re-render, and Done can
  // beat both the field's own blur and that render.
  const commitGroupRename = (): string | null => {
    setEditingGroupName(false);
    const clean = cleanChoiceGroup(groupNameDraft);
    if (!clean || clean === groupLabel) return cleanChoiceGroup(choiceGroup);
    const renamed = renameChoiceGroup(recipeId, groupLabel ?? '', clean);
    if (renamed) setChoiceGroup(renamed);
    return renamed ?? cleanChoiceGroup(choiceGroup);
  };

  const saveAndClose = () => {
    if (!ingredient) { onClose(); return; }
    // Tapping Done can beat the group name field's own blur — flush it here
    // instead of trusting stale `choiceGroup` state.
    const resolvedChoiceGroup = editingGroupName ? commitGroupRename() : cleanChoiceGroup(choiceGroup);
    const trimmed = name.trim();
    // An emptied name would strand the row — keep the old one rather than
    // storing something nothing can shop for.
    updateIngredient(recipeId, ingredient.id, {
      name: trimmed || ingredient.name,
      quantity: quantity.trim(),
      prep: prep.trim() || null,
      purpose: purpose.trim() || null,
      section: section.trim() || null,
      choiceGroup: resolvedChoiceGroup,
      aisle,
      noSwap,
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
    ? describeCatalogItem(catalogItem, itemSubs, groceryItems, itemProducts, new Date())
    : null;

  // The standing swap that reaches this line, if there is one. Shown only when
  // there's a rule to opt out of — or when this line has already opted out, so
  // a "keep as written" ticked before the rule went away is still findable and
  // still untickable. A control for a rule you haven't written would be a
  // setting explaining a feature rather than changing anything.
  const standingSwap = standingSwapMap(itemSubs, groceryItems).get(ingredient.nameKey) ?? null;

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
        <Text style={styles.hint}>
          What this recipe needs, not what you'd normally buy — that's set separately, on
          the item itself.
        </Text>

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

        {(!!standingSwap || noSwap) && (
          <>
            <View style={styles.separator} />
            <Text style={styles.groupLabel}>Standing swap</Text>
            <TouchableOpacity
              style={styles.toggleRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setNoSwap(v => !v); }}
              accessibilityRole="switch"
              accessibilityState={{ checked: noSwap }}
              accessibilityLabel="Keep as written"
            >
              <Ionicons
                name={noSwap ? 'checkbox' : 'square-outline'}
                size={iconSize.md}
                color={noSwap ? colors.accent : colors.textSecondary}
              />
              <View style={styles.toggleBody}>
                <Text style={styles.toggleLabel}>Keep as written</Text>
                <Text style={styles.hint}>
                  {standingSwap
                    ? `You use ${standingSwap.to.name.toLowerCase()} instead of ${standingSwap.from.name.toLowerCase()}. Tick this to leave this one line alone.`
                    : 'This line is left alone by any standing swap for it.'}
                </Text>
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Alternatives</Text>
        {/* An optional field like Section/Aisle below it, not a gate in front
            of one. There used to be a segmented control asking "always needed
            or one of a choice" before this ever showed — but that's a
            question the field's own emptiness already answers, and "always"
            read as a claim about this ingredient rather than "nothing's
            grouped with it". A group of one — "one of a choice" selected with
            nobody picked yet — used to be a reachable, dead-end state; it no
            longer exists, because there's no toggle to leave in that
            position. Picking (or creating) a sibling is the only way this
            stops being empty. */}
        <PillGroup
          noun="ingredient"
          surface="card"
          limit={0}
          filterPlaceholder="Find or add an ingredient…"
          createMaxLength={GROCERY_NAME_MAX_LENGTH}
          onCreate={raw => {
            const typed = raw.trim().slice(0, GROCERY_NAME_MAX_LENGTH).trim();
            if (!typed) return 'Name the ingredient.';
            // Clones this line's quantity/prep/purpose/section/aisle onto the
            // new row — the same default splitIngredientAlternatives already
            // uses for "cheddar or manchego": two alternatives fill the same
            // slot in the recipe, so sharing an amount is right far more often
            // than not. A one-tap edit on the new row afterward covers the
            // rest.
            const currentName = name.trim() || ingredient.name;
            const label = cleanChoiceGroup(groupLabel || currentName);
            if (!label) return 'Name the ingredient.';
            const created = splitIngredientAlternatives(
              recipeId, ingredient.id, [currentName, typed], label
            );
            if (!created) return `“${typed}” is already on this recipe.`;
            haptics.success();
            animateLayout();
            applyChoiceGroup(label);
          }}
          options={[
            {
              key: '__none__',
              label: 'No alternatives',
              pinned: true,
              selected: !groupLabel,
              onPress: () => { haptics.tap(); animateLayout(); applyChoiceGroup(null); },
            },
            ...recipeIngredients
              .filter(other => other.id !== ingredient.id)
              .map(other => {
                const inGroup = !!groupLabel && other.choiceGroup === groupLabel;
                return {
                  key: other.id,
                  label: other.name,
                  selected: inGroup,
                  onPress: () => {
                    haptics.tap();
                    // Toggling a specific sibling only ever changes that
                    // sibling's own row — leaving one member doesn't clear
                    // the group for whoever else is still in it.
                    if (inGroup) {
                      updateIngredient(recipeId, other.id, { choiceGroup: null });
                      return;
                    }
                    const label = cleanChoiceGroup(
                      groupLabel || other.choiceGroup || name.trim() || ingredient.name
                    );
                    if (!label) return;
                    updateIngredient(recipeId, other.id, { choiceGroup: label });
                    applyChoiceGroup(label);
                  },
                };
              }),
          ]}
        />
        {!!groupLabel && (
          editingGroupName ? (
            <View style={styles.groupNameEditRow}>
              <TextInput
                style={styles.groupNameInput}
                value={groupNameDraft}
                onChangeText={setGroupNameDraft}
                maxLength={RECIPE_CHOICE_GROUP_MAX_LENGTH}
                autoFocus
                onSubmitEditing={commitGroupRename}
                onBlur={commitGroupRename}
                accessibilityLabel="Group name"
              />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.groupNameRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                setGroupNameDraft(groupLabel);
                setEditingGroupName(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Group name, ${groupLabel}`}
              accessibilityHint="Double tap to rename — renames it for every ingredient in the group"
            >
              <Text style={styles.groupNameLabel}>Group name</Text>
              <View style={styles.groupNameValueRow}>
                <Text style={styles.groupNameValue} numberOfLines={1}>{groupLabel}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          )
        )}
        <Text style={styles.hint}>
          {siblingNames.length > 0 ? (
            <>
              You'll buy this <Text style={styles.hintStrong}>or</Text>{' '}
              {siblingNames.join(' or ')} — never both.
            </>
          ) : (
            'You haven’t listed any alternatives for this ingredient.'
          )}
        </Text>
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
          Only used the next time this lands on your grocery list, and only if you haven’t
          already told the app where it goes. If it’s already in your groceries with an aisle
          set, this doesn’t change it.
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
  // Same row shape as catalogRow above it, top-aligned because its hint runs
  // to two lines and a centred checkbox would float against the middle of the
  // paragraph.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toggleBody: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    color: colors.text,
    fontSize: font.md,
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
  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  groupNameLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  groupNameValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '60%',
  },
  groupNameValue: { ...disclosureValue(colors), flexShrink: 1 },
  groupNameEditRow: {
    paddingVertical: spacing.xs,
  },
  groupNameInput: {
    color: colors.text,
    fontSize: font.md,
    minHeight: 32,
  },
});
