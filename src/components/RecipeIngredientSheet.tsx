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
import { groceryNameKey, splitAlternativeNames } from '../utils/groceryParse';
import { varietyOfferFor } from '../utils/itemVarieties';
import { matchIngredientToCatalog } from '../utils/ingredientCatalogMatch';
import { cleanChoiceGroup } from '../utils/recipeUtils';
import { describeCatalogItem } from '../utils/groceryProduct';
import { allSectionsOf } from '../utils/recipeSections';
import { standingSwapMap } from '../utils/standingSwaps';
import { disclosureValue } from '../theme/textStyles';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';
import { PillGroup } from './PillGroup';
import { GroceryItemSheet } from './GroceryItemSheet';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { InlineAction } from './InlineAction';

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
 * When there's nothing on the other side of the bridge, the card mints it —
 * `ensureCatalogItem`, so the row arrives off-list and asserting nothing about
 * what's in the cupboard. That an ingredient can exist with no grocery row at
 * all is the thing being fixed: every fact this app can hold about a food hangs
 * off that row, so "not in your groceries yet" was a dead end on the one screen
 * with the most reason to want one. It is deliberately not an add-to-list
 * button; putting the thing in this week's trolley is a different sentence, and
 * `RecipeToListSheet` is where the recipe says it.
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
  const mergeChoiceGroup = useRecipeStore(s => s.mergeChoiceGroup);
  const renameChoiceGroup = useRecipeStore(s => s.renameChoiceGroup);
  const recipeIngredients = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.ingredients ?? [])
  );
  const recipeEmptySections = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.emptySections ?? [])
  );
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const rememberedAisleFor = useGroceryStore(s => s.rememberedAisleFor);
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const setVarietyOfKey = useGroceryStore(s => s.setVarietyOfKey);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));

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
  // presentation while this one is up. Same call GroceryCatalogSheet makes, and it's
  // what keeps this sheet underneath while the item is edited.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  // Whether the "link to an existing item" picker is open — closed whenever a
  // different ingredient is opened, same as editingItemId below.
  const [linkOpen, setLinkOpen] = useState(false);
  // The same, for the Alternatives card's own catalog picker. Two flags rather
  // than one shared "a picker is open": they sit in different cards and either
  // can be the one you want open.
  const [altLinkOpen, setAltLinkOpen] = useState(false);

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
    setLinkOpen(false);
    setAltLinkOpen(false);
  }, [ingredient]);

  // The catalog row this line resolves to. Above the early return, like every
  // other hook here — an ingredient sheet with nothing to edit still has to run
  // the same hooks in the same order.
  //
  // Keyed on the **draft** name rather than the saved one, because two controls
  // above now rewrite that field: the link picker's `onPick` and the "did you
  // mean" correction. Read from `ingredient.nameKey`, this card went on saying
  // "not in your groceries yet" about a line the user had just pointed at an
  // existing row — and the Add button below it would then mint the *old* name,
  // which is the duplicate the link picker exists to avoid. Falls back to the
  // saved key while the field is empty mid-edit.
  const catalogItem = useMemo(() => {
    if (!ingredient) return null;
    const key = groceryNameKey(name) || ingredient.nameKey;
    return groceryItems.find(i => i.nameKey === key) ?? null;
  }, [groceryItems, ingredient, name]);

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

  // A one-tap correction when this line doesn't resolve but something close
  // does. It used to be `suggestShorterCatalogName` alone — the leading
  // prep/unit word case ("cloves garlic" → "garlic"), which is still the
  // strongest tier and still tried first. `matchIngredientToCatalog` widens it
  // to the other four (whole-word prefix, the autocomplete's own ranking, and
  // a single character's difference) without changing what a suggestion *is*:
  // a name already real to this user, offered and never applied.
  //
  // It has to be this same call the row's badge makes, or the two disagree —
  // the badge is a signpost to this sheet, so a row promising "Skyr?" that
  // opened onto a sheet with nothing to accept would be the worst of both.
  const catalogMatch = matchIngredientToCatalog(name, groceryItems, new Date());
  const catalogSuggestion = catalogMatch.kind === 'suggested' ? catalogMatch.suggestedName : null;

  // The same match read the other way round. When what turned up is a *variety*
  // of what the line says — "onion" turning up White onion — renaming the line
  // is the wrong accept: the recipe said "onion" on purpose, and narrowing it
  // to one variety is a promise about the dish nobody made. Declaring the
  // relation instead fixes every recipe naming the generic at once and leaves
  // this line as written. Offered beside the rename rather than replacing it,
  // since a near-duplicate ("Onions" for "onion") wants the rename and only a
  // person can tell the two apart.
  //
  // Only before a declaration exists: `matchIngredientToCatalog` reads a
  // covered generic as `linked`, so this whole card is already gone by then.
  const varietyOffer = catalogMatch.kind === 'suggested'
    ? varietyOfferFor(groceryNameKey(name), catalogMatch.item)
    : null;

  const acceptVariety = () => {
    if (!varietyOffer) return;
    setVarietyOfKey(varietyOffer.id, groceryNameKey(name));
    haptics.success();
    animateLayout();
  };

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

  // Mints the catalog row and nothing else — off-list, and with no claim that
  // you have any. `ensureCatalogItem` is the primitive for exactly this (see
  // its doc comment): a name gets a row so a standing fact can hang off it,
  // which is the whole reason to reach for this from here. Deliberately not
  // `addByName`/`addFromPlan` — those put it in this week's trolley, which is
  // a different statement and one this sheet has no business making.
  //
  // Mints what the field says, which is what `catalogItem` resolves against —
  // the two have to agree, or pressing this leaves the card on its empty state
  // insisting the thing you just added isn't there.
  const addIngredientToCatalog = () => {
    const created = ensureCatalogItem(name.trim() || ingredient.name);
    if (!created) { haptics.error(); return; }
    haptics.success();
    animateLayout();
    // Straight into the item, since recording something on it — a brand, a
    // store, what you'd accept instead — is the reason to have pressed this at
    // all. Same sheet the catalog row's own chevron opens once it exists.
    setEditingItemId(created.id);
  };

  // Shared by the field's own "Create" pill and by picking an existing catalog
  // item straight off the same grid — the two differ only in whether the name
  // already has a row on the other side of nameKey. Splitting this out of
  // onCreate is what lets tapping a pantry item resolve immediately instead of
  // going through a "Create" that would just relink to the row that's already
  // there.
  const createAlternative = (raw: string): string | null => {
    const typed = raw.trim().slice(0, GROCERY_NAME_MAX_LENGTH).trim();
    if (!typed) return 'Name the ingredient.';
    // Clones this line's quantity/prep/purpose/section/aisle onto the new
    // row — the same default splitIngredientAlternatives already uses for
    // "cheddar or manchego": two alternatives fill the same slot in the
    // recipe, so sharing an amount is right far more often than not. A
    // one-tap edit on the new row afterward covers the rest.
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
    return null;
  };

  // Every other line's own key, so the catalog picker below can't offer
  // something this recipe already lists — that's a sibling pill's job, and
  // offering it twice makes one of the two a no-op the user can't predict.
  const otherIngredientKeys = new Set(
    recipeIngredients.filter(other => other.id !== ingredient.id).map(other => other.nameKey)
  );
  // What the catalog picker is allowed to offer as an alternative: everything
  // except this line's own row and the recipe's other lines.
  const alternativeCandidates = groceryItems.filter(
    item => item.id !== catalogItem?.id && !otherIngredientKeys.has(item.nameKey)
  );

  // A preview of what mergeBack produces — this row's own typed name (not yet
  // saved) plus every sibling's stored one, "or"-joined the same way the
  // split offer shows its parts verbatim.
  const mergePreviewName = ingredient
    ? [name.trim() || ingredient.name, ...siblingNames].join(' or ')
    : '';

  const mergeBack = () => {
    if (!ingredient) return;
    const merged = mergeChoiceGroup(recipeId, ingredient.id);
    if (!merged) return;
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
            accessibilityLabel={`Use "${catalogSuggestion}" instead, it's already in your grocery catalog`}
          >
            <Ionicons name="sparkles-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>Did you mean “{catalogSuggestion}”?</Text>
              <Text style={styles.suggestionDetail}>Already in your grocery catalog.</Text>
            </View>
          </TouchableOpacity>
        )}
        {!!varietyOffer && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={acceptVariety}
            accessibilityRole="button"
            accessibilityLabel={
              `Record that ${varietyOffer.name} is a kind of ${name.trim().toLowerCase()}, `
              + 'keeping this line as written'
            }
          >
            <Ionicons name="git-branch-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>
                Is “{varietyOffer.name}” a kind of {name.trim().toLowerCase()}?
              </Text>
              <Text style={styles.suggestionDetail}>
                Keeps this line as written, and any {name.trim().toLowerCase()} you have counts for it.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <InlineAction
          label={catalogItem ? 'Choose a different item' : 'Link to an existing item'}
          icon="link-outline"
          variant="neutral"
          style={styles.linkAction}
          onPress={() => { haptics.tap(); animateLayout(); setLinkOpen(v => !v); }}
          accessibilityLabel={
            catalogItem
              ? `Choose a different existing item for ${catalogItem.name}`
              : 'Link this line to an existing item in your grocery catalog'
          }
        />
        {linkOpen && (
          <CatalogLinkPicker
            items={groceryItems}
            initialQuery={name}
            excludeItemId={catalogItem?.id}
            onPick={item => {
              setName(item.name);
              animateLayout();
              setLinkOpen(false);
            }}
          />
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
          What this recipe needs, not what you'd normally buy. That's set separately, on
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
          Why it's on the list, when the same ingredient does two jobs: “flour, for dusting”.
        </Text>
      </View>

      {/* The other half of this line's identity. See the component note: the
          bridge has always existed, this is the first place it's visible. */}
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>In your grocery catalog</Text>
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
          <>
            <Text style={styles.hint}>
              Not in your grocery catalog yet. Add it to give it a brand, a store, a price
              or what you'd accept instead. This doesn't put it on your shopping list.
            </Text>
            <InlineAction
              label="Add to catalog"
              icon="basket-outline"
              onPress={addIngredientToCatalog}
              style={styles.addToCatalogButton}
              accessibilityLabel={`Add ${name.trim() || ingredient.name} to your grocery catalog`}
            />
          </>
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
                    ? `You use ${standingSwap.to.name.toLowerCase()} instead of ${standingSwap.from.name.toLowerCase()}. Check this to leave this one line alone.`
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
          onCreate={createAlternative}
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
        {/* The catalog half of the same question, and deliberately the same
            component the name field above uses rather than a second search of
            its own: an alternative names something you can put in a trolley, so
            "which of my groceries" is answered by the picker that already ranks
            them (frequency × recency, plural-tolerant — see
            rankGrocerySuggestions). The pills above stay the recipe's own
            lines, which is a small closed set; dumping the whole catalog in
            beside them made a grid with no ceiling out of a grid that had one,
            and buried the siblings behind an "N more" counting hundreds. */}
        <InlineAction
          label="Find in your catalog"
          icon="basket-outline"
          variant="neutral"
          style={styles.linkAction}
          onPress={() => { haptics.tap(); animateLayout(); setAltLinkOpen(v => !v); }}
          accessibilityLabel="Find an alternative in your grocery catalog"
        />
        {altLinkOpen && (
          <CatalogLinkPicker
            items={alternativeCandidates}
            initialQuery=""
            onPick={item => {
              const rejection = createAlternative(item.name);
              if (rejection) { haptics.error(); return; }
              animateLayout();
              setAltLinkOpen(false);
            }}
          />
        )}
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
              accessibilityHint="Double tap to rename it for every ingredient in the group"
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
              {siblingNames.join(' or ')}, never both.
            </>
          ) : (
            'You haven’t listed any alternatives. Pick another ingredient to make this an either/or, decided at the store.'
          )}
        </Text>
        {siblingNames.length > 0 && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={mergeBack}
            accessibilityRole="button"
            accessibilityLabel={`Merge back into one line: ${mergePreviewName}`}
          >
            <Ionicons name="git-merge-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>Merge back into one line?</Text>
              <Text style={styles.suggestionDetail}>{mergePreviewName}</Text>
              <Text style={styles.suggestionDetail}>
                Combines these into one line. You won't choose between them anymore.
              </Text>
            </View>
          </TouchableOpacity>
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
          Puts this under a heading on the recipe, like “For the cake” or “For the frosting”. It
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
          already told the app where it goes. If it’s already in your grocery catalog with
          an aisle set, this doesn’t change it.
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
  linkAction: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
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
  addToCatalogButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
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
