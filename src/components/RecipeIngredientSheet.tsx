import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeIngredient } from '../types';
import {
  GROCERY_NAME_MAX_LENGTH,
  PREP_MAX_LENGTH,
  RECIPE_CHOICE_GROUP_MAX_LENGTH,
  RECIPE_INGREDIENT_QUANTITY_MAX_LENGTH,
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
import { catalogItemForKey } from '../utils/groceryPlural';
import { cleanChoiceGroup, defaultChoiceGroupLabel, splitIngredientAnd as andPartsOf, type AndSplitPart } from '../utils/recipeUtils';
import { describeCatalogItem } from '../utils/groceryProduct';
import { allSectionsOf } from '../utils/recipeSections';
import { standingSwapMap } from '../utils/standingSwaps';
import { isCookingFat, fatCooking, DEEP_FRY_SHARE, PAN_OIL_SHARE } from '../utils/panOil';
import { recipeNutritionLines } from '../utils/recipeNutrition';
import { panelMultiplier } from '../utils/ingredientGrams';
import { disclosureValue } from '../theme/textStyles';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { EditorSheet } from './EditorSheet';
import { PillGroup } from './PillGroup';
import { GroceryItemSheet } from './GroceryItemSheet';
import { navigateToFoodSearchSettings } from './NutritionSearchSheet';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { rankGrocerySuggestions } from '../utils/grocerySuggest';
import { InlineAction } from './InlineAction';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { Toggle } from './Toggle';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  recipeId: string;
  ingredient: RecipeIngredient | null;
  onClose: () => void;
}

/** "1 cup flour": a part of an "and" split as the new line will read. */
const andPartLabel = (part: AndSplitPart) => [part.quantity, part.name].filter(Boolean).join(' ');

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
export function RecipeIngredientSheet({ visible, recipeId, ingredient: liveIngredient, onClose }: Props) {
  // Held past the host clearing it, so the sheet can draw its subject for the
  // commit it spends closing. Both hosts clear `ingredient` in the same commit
  // that lowers `visible`, and without this the `return null` below tore the
  // presented sheet out of the tree mid-dismiss: the unmount CLAUDE.md's
  // SheetModal notes say freezes the screen underneath.
  const ingredient = useSheetSubject(liveIngredient);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();

  const updateIngredient = useRecipeStore(s => s.updateIngredient);
  const splitIngredientAlternatives = useRecipeStore(s => s.splitIngredientAlternatives);
  const splitIngredientAnd = useRecipeStore(s => s.splitIngredientAnd);
  const mergeChoiceGroup = useRecipeStore(s => s.mergeChoiceGroup);
  const renameChoiceGroup = useRecipeStore(s => s.renameChoiceGroup);
  const setComponentChoiceGroup = useRecipeStore(s => s.setComponentChoiceGroup);
  const recipeIngredients = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.ingredients ?? [])
  );
  // The recipe's own components, so "Alternatives" can offer joining one —
  // see the cross-type choice groups note in recipeComponents.ts. Resolved
  // against the live library rather than each link's captured name, same as
  // every other component row in the app.
  const recipeComponents = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.components ?? [])
  );
  const allRecipes = useRecipeStore(useShallow(s => s.recipes));
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
  // The name typed into the split offer's own field; empty means the default.
  const [splitNameDraft, setSplitNameDraft] = useState('');
  const [aisle, setAisle] = useState<string | null>(null);
  // The per-line exception to a standing swap — "this pastry needs real
  // butter" (RecipeIngredient.noSwap).
  const [noSwap, setNoSwap] = useState(false);
  // A garnish or serving suggestion rather than something the dish needs
  // (RecipeIngredient.optional).
  const [optional, setOptional] = useState(false);
  // Left out of this recipe's nutrition total on purpose — a garnish or a
  // small amount that doesn't move the figures (RecipeIngredient.excludeFromNutrition).
  const [excludeFromNutrition, setExcludeFromNutrition] = useState(false);
  // Undefined until the person touches the toggle, so a line nobody answered keeps
  // following the recipe's steps (RecipeIngredient.cookedInPan).
  const [cookedInPan, setCookedInPan] = useState<boolean | undefined>(undefined);
  // A staple you'd already have, not something to shop for — water at a
  // stated amount, most often (RecipeIngredient.excludeFromShoppingList).
  const [excludeFromShoppingList, setExcludeFromShoppingList] = useState(false);
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

  // Keyed on `visible` too: the held subject above means reopening the same
  // line is the same object, and seeding on `ingredient` alone left the last
  // visit's abandoned edits in the fields.
  useEffect(() => {
    if (!ingredient || !visible) return;
    setName(ingredient.name);
    setQuantity(ingredient.quantity);
    setPrep(ingredient.prep ?? '');
    setPurpose(ingredient.purpose ?? '');
    setSection(ingredient.section ?? '');
    setChoiceGroup(ingredient.choiceGroup ?? '');
    setEditingGroupName(false);
    setSplitNameDraft('');
    setAisle(ingredient.aisle);
    setNoSwap(!!ingredient.noSwap);
    setOptional(!!ingredient.optional);
    setExcludeFromNutrition(!!ingredient.excludeFromNutrition);
    setCookedInPan(ingredient.cookedInPan);
    setExcludeFromShoppingList(!!ingredient.excludeFromShoppingList);
    setEditingItemId(null);
    setLinkOpen(false);
  }, [ingredient, visible]);

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
    // Through the same resolution the catalog itself uses, so a line one
    // plural away from a row you have reads as the row it will actually add
    // to rather than as "not in your groceries yet".
    return catalogItemForKey(key, groceryItems);
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

  // The pan question, for a cooking oil only. The draft name decides whether it
  // applies, the same as the catalog card above reads the draft.
  const recipeSteps = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.steps ?? [])
  );
  const askPan = isCookingFat(name);
  const cooking = askPan ? fatCooking({ name, cookedInPan }, recipeSteps) : null;
  const panCooked = cooking?.cooked === true;
  const deepFried = cooking?.method === 'deep';
  const cookingShare = cooking?.share ?? 1;
  const cookingLabel = deepFried ? 'Deep fried' : 'Cooked in the pan';
  const sharePercent = Math.round((deepFried ? DEEP_FRY_SHARE : PAN_OIL_SHARE) * 100);
  // What the line counts for, in calories, with and without the pan share. The
  // saved line supplies the catalog figures; the amount is the draft's, so the
  // readout follows what is being typed.
  const panReadout = useMemo(() => {
    if (!askPan || !ingredient) return null;
    const recipe = allRecipes.find(r => r.id === recipeId);
    if (!recipe) return null;
    const line = recipeNutritionLines(
      recipe, groceryItems, itemProducts, new Map(allRecipes.map(r => [r.id, r])),
    ).find(l => l.id === ingredient.id);
    const perHundred = line?.nutrition?.amounts.calorieKcal;
    if (!line?.nutrition || perHundred === undefined) return null;
    const multiplier = panelMultiplier(quantity, prep.trim() || null, line.nutrition);
    if (multiplier === null) return null;
    const whole = perHundred * multiplier;
    return { whole: Math.round(whole), counted: Math.round(whole * cookingShare) };
  }, [askPan, ingredient, allRecipes, recipeId, groceryItems, itemProducts, quantity, prep, cookingShare]);

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
      optional,
      excludeFromNutrition,
      cookedInPan,
      excludeFromShoppingList,
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

  // "neutral oil, such as avocado oil" parses "avocado oil" out as an example
  // of the generic name (RecipeIngredient.example, see splitExample /
  // makeIngredient), and this is the same declare-a-variety offer
  // `varietyOffer` above makes from a catalog-name collision, just sourced
  // from the recipe's own wording instead. Only while the example's own item
  // — if it exists yet — hasn't already declared something; an item with an
  // opinion isn't offered a second one, same rule varietyOfferFor follows.
  const exampleKey = ingredient.example ? groceryNameKey(ingredient.example) : null;
  const exampleItem = exampleKey ? catalogItemForKey(exampleKey, groceryItems) : null;
  const exampleOffer = ingredient.example && !exampleItem?.varietyOfKey
    ? ingredient.example
    : null;

  const acceptExample = () => {
    if (!exampleOffer) return;
    const created = ensureCatalogItem(exampleOffer);
    if (!created) { haptics.error(); return; }
    setVarietyOfKey(created.id, groceryNameKey(name));
    haptics.success();
    animateLayout();
  };

  // "cheddar or manchego" wants to be two rows in a choice group, not one
  // catalog entry nothing can ever match — see splitAlternativeNames. Offered,
  // never applied on its own: the split is verbatim, so "chicken or vegetable
  // stock" needs a human to finish it.
  const alternatives = splitAlternativeNames(name);

  // "salt and pepper" wants to be two lines you buy, the other half of the
  // suggestion above. Read off the saved line rather than the name being
  // typed, because accepting splits the stored row; a name edited but not yet
  // saved has nothing to split. Withheld for a line in a choice group, or one
  // with a part the recipe already lists, which the store would refuse.
  const andParts = ingredient && !alternatives && !ingredient.choiceGroup && name.trim() === ingredient.name
    ? andPartsOf(ingredient)
    : null;
  const andPartsTaken = !!ingredient && !!andParts && andParts.some(part => (
    recipeIngredients.some(other => other.id !== ingredient.id && other.nameKey === groceryNameKey(part.name))
  ));
  const andOffer = andPartsTaken ? null : andParts;

  // What the new group is called, asked beside the offer rather than after it.
  // Untouched, it's the short default (the whole line would be clipped at the
  // label cap and head the group as half a word); typing replaces it, and an
  // emptied field falls back to it so accepting can never name a group nothing.
  const defaultSplitName = defaultChoiceGroupLabel(alternatives ?? []);
  const splitGroupName = cleanChoiceGroup(splitNameDraft) ?? defaultSplitName;

  const catalogSummary = catalogItem
    ? describeCatalogItem(catalogItem, itemSubs, groceryItems, itemProducts, new Date())
    : null;

  // The standing swap that reaches this line, if there is one. Shown only when
  // there's a rule to opt out of — or when this line has already opted out, so
  // a "keep as written" ticked before the rule went away is still findable and
  // still untickable. A control for a rule you haven't written would be a
  // setting explaining a feature rather than changing anything.
  const standingSwap = standingSwapMap(itemSubs, groceryItems).get(ingredient.nameKey) ?? null;

  const acceptAndSplit = () => {
    if (!ingredient || !andOffer) return;
    if (!splitIngredientAnd(recipeId, ingredient.id)) { haptics.error(); return; }
    haptics.success();
    animateLayout();
    onClose();
  };

  const acceptSplit = () => {
    if (!ingredient || !alternatives) return;
    const created = splitIngredientAlternatives(
      recipeId, ingredient.id, alternatives, splitGroupName
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
        <SheetHeader
          bare
          title="Ingredient"
          left={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={saveAndClose} minWidth={40} />}
          right={<View style={styles.headerSpacer} />}
        />
      }
    >
      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>What to buy</Text>
        <TextField
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. chicken thighs"
          placeholderTextColor={colors.textTertiary}
          maxLength={GROCERY_NAME_MAX_LENGTH}
          autoCapitalize="none"
          // An ingredient is a shelf word and bridges to the catalog by name
          // key, so a correction here strands the match — see GroceryRow.
          autoCorrect={false}
          spellCheck={false}
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
        {!!andOffer && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={acceptAndSplit}
            accessibilityRole="button"
            accessibilityLabel={`Split into ${andOffer.length} lines: ${andOffer.map(andPartLabel).join(', ')}`}
          >
            <Ionicons name="copy-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>Split into {andOffer.length} lines?</Text>
              {/* Verbatim and up front, like the either/or offer: the amounts
                  are the half to check, since only an amount a part wrote
                  itself goes with it. */}
              <Text style={styles.suggestionDetail}>{andOffer.map(andPartLabel).join('  ·  ')}</Text>
              <Text style={styles.suggestionDetail}>Each becomes its own line, and you buy both.</Text>
            </View>
          </TouchableOpacity>
        )}
        {!!alternatives && (
          <View style={styles.splitNameRow}>
            <Text style={styles.groupNameLabel}>Group name</Text>
            <TextField
              style={styles.splitNameInput}
              value={splitNameDraft}
              onChangeText={setSplitNameDraft}
              maxLength={RECIPE_CHOICE_GROUP_MAX_LENGTH}
              placeholder={defaultSplitName}
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              accessibilityLabel="Name for the new group"
              accessibilityHint="Shown above the choices on the recipe. Leave empty to use the suggested name."
            />
          </View>
        )}
        {!!catalogSuggestion && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setName(catalogSuggestion); }}
            accessibilityRole="button"
            accessibilityLabel={`Use “${catalogSuggestion}” instead. It’s already in your grocery catalog`}
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
        {!!exampleOffer && (
          <TouchableOpacity
            style={styles.suggestionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={acceptExample}
            accessibilityRole="button"
            accessibilityLabel={
              `Record that ${exampleOffer} is a kind of ${name.trim().toLowerCase()}, `
              + 'adding it to your groceries if it isn’t there yet'
            }
          >
            <Ionicons name="git-branch-outline" size={iconSize.sm} color={colors.accent} />
            <View style={styles.suggestionBody}>
              <Text style={styles.suggestionTitle}>
                Is “{exampleOffer}” a kind of {name.trim().toLowerCase()}?
              </Text>
              <Text style={styles.suggestionDetail}>
                From “such as {exampleOffer}” on this line. Adds it to your groceries if it isn’t
                there yet, and any {exampleOffer.toLowerCase()} you have counts for it.
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
        <TextField
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          placeholder="e.g. 2 lb"
          placeholderTextColor={colors.textTertiary}
          maxLength={RECIPE_INGREDIENT_QUANTITY_MAX_LENGTH}
          accessibilityLabel="Quantity"
        />
        <HelpText style={styles.hint}>
          The amount this recipe needs. What you normally buy is set on
          the item itself.
        </HelpText>

        {askPan && (
          <>
            <View style={styles.separator} />

            <TouchableOpacity
              style={styles.toggleRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setCookedInPan(!panCooked); }}
              accessibilityRole="switch"
              accessibilityState={{ checked: panCooked }}
              accessibilityLabel={cookingLabel}
            >
              <View style={styles.toggleBody}>
                <Text style={styles.toggleLabel}>{cookingLabel}</Text>
                <HelpText style={styles.hint}>
                  {panCooked
                    ? `${deepFried ? 'The food only takes up some of it' : 'Some of it stays in the pan'}, so about ${sharePercent}% counts. Turn off if all of it goes into the dish.`
                    : `The whole amount counts. Turn on if it was used to ${deepFried ? 'deep fry' : 'cook in a pan'}.`}
                </HelpText>
              </View>
              <Toggle value={panCooked} />
            </TouchableOpacity>
            {panReadout && (
              <Text style={styles.panReadout}>
                Counts {panReadout.counted} of {panReadout.whole} cal
              </Text>
            )}
          </>
        )}

        <View style={styles.separator} />

        <Text style={styles.groupLabel}>Prep</Text>
        <TextField
          style={styles.input}
          value={prep}
          onChangeText={setPrep}
          placeholder="e.g. peeled and sliced"
          placeholderTextColor={colors.textTertiary}
          maxLength={PREP_MAX_LENGTH}
          accessibilityLabel="Prep instructions"
        />
        <HelpText style={styles.hint}>What to do to it. Shown on the recipe only.</HelpText>

        <View style={styles.separator} />

        <Text style={styles.groupLabel}>For</Text>
        <TextField
          style={styles.input}
          value={purpose}
          onChangeText={setPurpose}
          placeholder="e.g. margaritas"
          placeholderTextColor={colors.textTertiary}
          maxLength={PREP_MAX_LENGTH}
          accessibilityLabel="Purpose"
        />
        <HelpText style={styles.hint}>
          Why it’s on the list, when the same ingredient does two jobs: “flour, for gideong”.
        </HelpText>

        <View style={styles.separator} />

        <TouchableOpacity
          style={styles.toggleRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); setOptional(v => !v); }}
          accessibilityRole="switch"
          accessibilityState={{ checked: optional }}
          accessibilityLabel="Optional"
        >
          <Ionicons
            name={optional ? 'checkbox' : 'square-outline'}
            size={iconSize.md}
            color={optional ? colors.accent : colors.textSecondary}
          />
          <View style={styles.toggleBody}>
            <Text style={styles.toggleLabel}>Optional</Text>
            <HelpText style={styles.hint}>
              For a garnish or serving suggestion. Starts unchecked when this
              recipe’s ingredients go on your list, and you can still check it
              off by hand.
            </HelpText>
          </View>
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity
          style={styles.toggleRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); setExcludeFromNutrition(v => !v); }}
          accessibilityRole="switch"
          accessibilityState={{ checked: excludeFromNutrition }}
          accessibilityLabel="Don’t count toward nutrition"
        >
          <Ionicons
            name={excludeFromNutrition ? 'checkbox' : 'square-outline'}
            size={iconSize.md}
            color={excludeFromNutrition ? colors.accent : colors.textSecondary}
          />
          <View style={styles.toggleBody}>
            <Text style={styles.toggleLabel}>Don’t count toward nutrition</Text>
            <HelpText style={styles.hint}>
              Leaves this line out of the recipe’s nutrition total. For flavoring you take
              out before eating, like kombu or a bay leaf, or an amount too small to matter.
            </HelpText>
          </View>
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity
          style={styles.toggleRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); setExcludeFromShoppingList(v => !v); }}
          accessibilityRole="switch"
          accessibilityState={{ checked: excludeFromShoppingList }}
          accessibilityLabel="Don’t add to shopping list"
        >
          <Ionicons
            name={excludeFromShoppingList ? 'checkbox' : 'square-outline'}
            size={iconSize.md}
            color={excludeFromShoppingList ? colors.accent : colors.textSecondary}
          />
          <View style={styles.toggleBody}>
            <Text style={styles.toggleLabel}>Don’t add to shopping list</Text>
            <HelpText style={styles.hint}>
              A staple you already have, like water. Stays on the
              recipe, but isn’t added to your shopping list.
            </HelpText>
          </View>
        </TouchableOpacity>
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
            accessibilityHint="Edits the grocery item: its brand, stores, pantry and substitutes"
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
            <HelpText style={styles.hint}>
              Not in your grocery catalog yet. Add it to give it a brand, a store, a price
              or substitutes. This doesn’t put it on your shopping list.
            </HelpText>
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
                    ? `You use ${standingSwap.to.name.toLowerCase()} instead of ${standingSwap.from.name.toLowerCase()}. Check this to skip the swap for this line.`
                    : 'Check this to skip any standing swap for this line.'}
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
          // The catalog half of the same question, answered by the same field
          // rather than a second search: an alternative names something you can
          // put in a cart, so what is typed also ranks the catalog (the ranking
          // the grocery add field uses). The pills stay the recipe's own lines,
          // a small closed set, rather than the whole catalog beside them.
          belowField={query =>
            rankGrocerySuggestions(query, alternativeCandidates, new Date(), 5).map(({ item }) => (
              <TouchableOpacity
                key={item.id}
                style={styles.altRow}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  if (createAlternative(item.name)) haptics.error();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.name} as an alternative, ${item.aisle}`}
              >
                <Text style={styles.altRowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.altRowAisle} numberOfLines={1}>{item.aisle}</Text>
              </TouchableOpacity>
            ))
          }
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
            // A recipe used as a component is a real alternative too — "corn
            // tortillas, or make Tortillas de Maíz instead" — not just another
            // ingredient. Joining one here writes the shared choiceGroup on
            // both sides the same way joining a sibling ingredient does; see
            // the cross-type groups note in recipeComponents.ts.
            ...recipeComponents.map(component => {
              const inGroup = !!groupLabel && component.choiceGroup === groupLabel;
              const componentName =
                allRecipes.find(r => r.id === component.recipeId)?.name || component.name || 'Deleted recipe';
              return {
                key: component.id,
                label: componentName,
                selected: inGroup,
                onPress: () => {
                  haptics.tap();
                  if (inGroup) {
                    setComponentChoiceGroup(recipeId, component.id, null);
                    return;
                  }
                  const label = cleanChoiceGroup(
                    groupLabel || component.choiceGroup || name.trim() || ingredient.name
                  );
                  if (!label) return;
                  setComponentChoiceGroup(recipeId, component.id, label);
                  applyChoiceGroup(label);
                },
              };
            }),
          ]}
        />
        {!!groupLabel && (
          editingGroupName ? (
            <View style={styles.groupNameEditRow}>
              <TextField
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
              accessibilityHint="Renames it for every ingredient in the group"
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
          {siblingNames.length > 0
            ? 'Either/or: you’ll buy only one of these.'
            : 'No alternatives yet. Pick another ingredient to make this an either/or, decided at the store.'}
        </Text>
        {siblingNames.length > 0 && (
          <View style={styles.siblingChipRow}>
            {siblingNames.map(sibling => (
              <View key={sibling} style={styles.siblingChip}>
                <Text style={styles.siblingChipText}>{sibling}</Text>
              </View>
            ))}
          </View>
        )}
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
                Combines these into one line. You won’t choose between them anymore.
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
        <HelpText style={styles.hint}>
          Puts this under a heading on the recipe, like “For the cake”. It
          doesn’t affect your shopping list.
        </HelpText>
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
        <HelpText style={styles.hint}>
          Used when this goes on your grocery list,
          unless the item already has an aisle in
          your grocery catalog.
        </HelpText>
      </View>

      <GroceryItemSheet
        visible={editingItemId !== null}
        itemId={editingItemId}
        onClose={() => setEditingItemId(null)}
        onOpenRecipe={openRecipeId => {
          setEditingItemId(null);
          onClose();
          navigation.navigate('RecipeDetail', { recipeId: openRecipeId });
        }}
        onOpenSettings={entryId => {
          setEditingItemId(null);
          onClose();
          navigateToFoodSearchSettings(navigation, entryId);
        }}
        recipeExists={openRecipeId => allRecipes.some(r => r.id === openRecipeId)}
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
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  altRowName: { flex: 1, color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  altRowAisle: { color: colors.textTertiary, fontSize: font.xs },
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
    gap: spacing.xxs,
  },
  toggleLabel: {
    color: colors.text,
    fontSize: font.md,
  },
  panReadout: {
    color: colors.text,
    fontSize: font.md,
    marginTop: spacing.smd,
  },
  catalogBody: {
    flex: 1,
    gap: spacing.xxs,
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
  siblingChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  siblingChip: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  siblingChipText: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  splitNameRow: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  splitNameInput: {
    color: colors.text,
    fontSize: font.md,
    minHeight: 32,
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
