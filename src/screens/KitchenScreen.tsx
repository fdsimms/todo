import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  buildKitchenSections,
  describeKitchen,
  kitchenInventory,
  parseKitchenEntryId,
  useUpEntries,
  FREEZER_SECTION,
  type KitchenEntry,
} from '../utils/kitchenInventory';
import {
  buildKitchenRows,
  kitchenDragRange,
  kitchenRowKey,
  resolveKitchenDrop,
  type KitchenMove,
  type KitchenRow,
} from '../utils/kitchenReorder';
import { describeUseUpRecipe, useUpRecipes } from '../utils/useUpRecipes';
import { groceryNameKey } from '../utils/groceryParse';
import { ScreenHeader } from '../components/ScreenHeader';
import { ReorderableList } from '../components/ReorderableList';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { TipHost } from '../components/TipHost';
import { ActiveTripBanner } from '../components/ActiveTripBanner';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PressableScale } from '../components/PressableScale';
import { GroceryItemSheet, type CollapsibleFieldKey } from '../components/GroceryItemSheet';
import { ItemDisposalOffer } from '../components/ItemDisposalOffer';
import { LeftoverSheet } from '../components/LeftoverSheet';
import { BarcodeScanSheet, type ScanProductDraft } from '../components/BarcodeScanSheet';
import { featureHidden } from '../utils/simpleMode';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { ReceiptImportSheet, type ReceiptAddDraft } from '../components/ReceiptImportSheet';
import { freshnessColor } from '../components/LeftoversCard';
import { useNowTick } from '../hooks/useNowTick';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { resolveActiveTrip } from '../utils/activeTrip';
import { resetToGroceries } from '../navigation/navigationRef';

/**
 * Everything the app currently thinks is in your kitchen, in one place — the
 * pantry it works out from what you buy, and the fridge you've logged
 * containers into.
 *
 * It used to be the pantry alone, and the fridge answered the same question
 * two screens away on the meal plan with its own vocabulary. A bag of spinach
 * going off Thursday and a container of chilli going off Thursday are the same
 * fact to the cook (#1670), so the rows come from one derivation
 * (`utils/kitchenInventory.ts`) with one freshness ladder, and what's about to
 * be wasted sorts to the top of whatever heading it's under.
 *
 * The fourth of the Groceries/Recipes/Meal plan hub (`GroceriesHubPills`),
 * rather than a sheet popped over Groceries — see that component's doc
 * comment for why it moved. Displayed as "Pantry" (`GroceriesHubPills`'
 * label, and this screen's own `ScreenHeader` title) while the route, this
 * file and everything in `kitchenInventory.ts` keep the `Kitchen`/`kitchen*`
 * name — see `GroceriesHubPills`' doc comment for why the two differ.
 *
 * **The corrections stay where the thing lives.** A catalog row's trailing ✕
 * is the one this screen exists for most — it writes exactly what
 * `GroceryItemSheet`'s "Out of it" pill writes (`markOutOfMany`, same call
 * `CookedUseUpSheet` batches), in one tap, with the same undo everything else
 * in that store gets — and the row itself opens `GroceryItemSheet` with the
 * Pantry pills already showing (`initialField`) for anything past that one
 * bit. **A container carries no ✕**, deliberately: closing one out is a
 * two-way question ("Eaten" / "Thrown out") that a single glyph can't ask, and
 * guessing "eaten" would quietly write a fridge-history row the user never
 * chose. Its row opens `LeftoverSheet`, which asks properly.
 *
 * **A row is dragged to say where the thing is.** Long-pressing one and
 * dropping it under another heading is the same gesture the shopping list uses
 * to move an item between aisles, and it means what the heading says: the
 * freezer for either kind, the fridge for a container, an aisle for a catalog
 * row. The resolution is `utils/kitchenReorder.ts` and the writes are the same
 * store actions the two sheets call, so nothing here is a second way of saying
 * it — see `docs/arch/groceries.md` for why an empty place still gets a
 * heading, and why a drop inside one section writes nothing.
 *
 * The two things this screen writes by itself are `addToPantry`, off the
 * field at the top, and `addManyToPantry`, off the two scan actions in the
 * header — the same one-bit assertion the item sheet's "Got it" pill writes,
 * one name or a whole session at a time. They exist because that correction
 * was unreachable for anything with no row yet: you can only open an item's
 * sheet from the list or from the catalog, so "I have flour" was unsayable until
 * flour had been bought through the app at least once. All of them add to the
 * pantry and never to the fridge; a container is something you cooked, which
 * is what `LeftoverSheet`'s log flow is for. Both scan sheets are shared with
 * `GroceryScreen` (`BarcodeScanSheet` and `ReceiptImportSheet`, each with a
 * `context` prop) — same camera, lookup and reading, only the row wording and
 * the write path differ. The barcode's own box (brand, variant) still lands on
 * the item the same way it does from `GroceryScreen` — see
 * `addManyToPantry`'s `products` param.
 *
 * **A receipt is the one of the two that scales.** A shop you never made a
 * list for used to be unrecordable except a barcode at a time, which is why
 * reading one is offered here and not only at the foot of the shopping list:
 * the paper names thirty things at once, and this screen is where someone
 * standing over the bags actually is. What it records is smaller than a
 * finished trip's — names, and what each cost — because it isn't a trip: no
 * purchase count, no store stocking claim, no purchase date (see
 * `handleReceiptApply`).
 *
 * That keeps the model the one #1040 settled on — computed from what you buy,
 * corrected when it's wrong, never an inventory anybody has to keep up.
 * Quantities, per-row expiry editing and checking things back in are the
 * inventory, and stay out.
 */
export function KitchenScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addToPantry = useGroceryStore(s => s.addToPantry);
  const addManyToPantry = useGroceryStore(s => s.addManyToPantry);
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);
  const setFrozen = useGroceryStore(s => s.setFrozen);
  const setAisle = useGroceryStore(s => s.setAisle);
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const markProductsOutOf = useGroceryStore(s => s.markProductsOutOf);
  const setProductFrozen = useGroceryStore(s => s.setProductFrozen);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const endTrip = useGroceryStore(s => s.endTrip);
  const activeTripShop = useMemo(
    () => resolveActiveTrip(tripShopId, tripStartedAt, shops, new Date()),
    [tripShopId, tripStartedAt, shops]
  );
  const handleClearTrip = useCallback(() => {
    animateLayout();
    endTrip();
  }, [endTrip]);

  const recipes = useRecipeStore(useShallow(s => s.recipes));

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const setLeftoverFrozen = useLeftoverStore(s => s.setFrozen);
  const splitLeftover = useLeftoverStore(s => s.splitLeftover);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);

  const [query, setQuery] = useState('');
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // Which field the sheet opens on. Pantry for every row tap (see the sheet
  // below); the repeat-waste offer is the one thing that asks for another.
  const [openItemField, setOpenItemField] = useState<CollapsibleFieldKey>('pantry');
  const [openLeftoverId, setOpenLeftoverId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // This screen never unmounts once visited (the drawer's tabs stay mounted
  // under `enableScreens(false)`), so a use-by day computed once at mount
  // would go stale the same way an unmemoized LeftoversCard row would — see
  // useNowTick's own doc comment (#1732).
  const nowMs = useNowTick();
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const entries = useMemo(
    () => kitchenInventory(items, leftovers, now, itemProducts),
    [items, leftovers, now, itemProducts]
  );
  const sections = useMemo(
    () => buildKitchenSections(entries, aisleOrder, query),
    [entries, aisleOrder, query]
  );

  // A drop that resolves to nothing — a row put back in the section it came
  // from, or one the model has no write for — leaves the store untouched, and
  // `ReorderableList` holds the order it committed locally until the `data`
  // prop it was given changes identity. These rows are derived, so nothing
  // else would ever change it: this is what hands the list a fresh array so it
  // drops that copy and re-renders the real order. Bumped on every drop rather
  // than only the empty ones, because a move that *is* written re-derives from
  // the store in the same commit anyway.
  const [dropNonce, setDropNonce] = useState(0);

  // One flat stream of headings and rows, which is what makes "put this in the
  // freezer" a drag rather than a trip into the item sheet — see
  // `utils/kitchenReorder.ts`. Both places carry an empty target when they
  // have no section this render, since a heading that only exists once
  // something is already under it can't be the way things get there, and the
  // list can't grow one mid-drag (a key change cancels the drag).
  const rows = useMemo<KitchenRow[]>(
    () =>
      sections.length === 0
        ? []
        : buildKitchenRows(sections, {
            // Something to take back out of the freezer: with no fridge
            // section rendered, any container that's still live is in it.
            // Both suppressed while a search is narrowing the list — an empty
            // target for a place the query just filtered out isn't a place to
            // drag anything, it's a leftover from the unfiltered kitchen.
            fridge: !query && entries.some(e => e.kind === 'leftover'),
            freezer: !query && entries.length > 0,
          }),
    [sections, entries, dropNonce, query]
  );

  // What to cook with what's dying. Off `useUpEntries` rather than the whole
  // kitchen, so this answers "what saves the spinach" and not "what could I
  // make for dinner" — the recipe list is already the second question.
  //
  // Hidden while the field has text: the field filters the list below to what
  // you're looking for, and a suggestion block that ignored the query would be
  // the one part of the screen not answering it.
  const suggestions = useMemo(
    () => (query ? [] : useUpRecipes(useUpEntries(entries), recipes)),
    [entries, recipes, query]
  );
  const shownSuggestions = useMemo(
    // Two, which is what fits above the fold without pushing the pantry itself
    // off screen. The block is an offer, not the content of the screen.
    () => suggestions.slice(0, 2),
    [suggestions]
  );

  // Inside the list's header rather than fixed above it, so it scrolls away
  // with the content it's about. The screen already spends its fixed height on
  // the hub pills and the find-or-add field; two more permanent rows would push
  // the pantry itself off the first screen, which is the thing the user came
  // for.
  const suggestionHeader = shownSuggestions.length === 0 ? null : (
    <View style={styles.suggestWrap}>
      <Text style={styles.sectionTitle}>Cook this before it goes</Text>
      {shownSuggestions.map(suggestion => (
        <TouchableOpacity
          key={suggestion.recipe.id}
          style={styles.suggestRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => {
            haptics.tap();
            navigation.navigate('RecipeDetail', { recipeId: suggestion.recipe.id });
          }}
          accessibilityRole="button"
          accessibilityLabel={`${suggestion.recipe.name}. ${describeUseUpRecipe(suggestion)}`}
          accessibilityHint="Opens the recipe"
        >
          <Ionicons name="restaurant-outline" size={iconSize.md} color={colors.accent} />
          <View style={styles.suggestBody}>
            <Text style={styles.suggestName} numberOfLines={1}>{suggestion.recipe.name}</Text>
            <Text style={styles.suggestMeta} numberOfLines={1}>
              {describeUseUpRecipe(suggestion)}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  // The grocery/leftover "Use up X" tasks' own link (resetToKitchen in
  // navigationRef.ts) and Today's kitchen context row both name one entry to
  // open straight to, rather than leaving the plain list for the user to find
  // it in. Same stamped-param handoff MealPlanScreen's focusDay/focusStamp
  // uses, so tapping the same link twice in a row still reopens the entry.
  const focusEntryId: string | undefined = route.params?.focusKitchenEntry;
  const focusStamp: number | undefined = route.params?.focusStamp;
  const [handledFocusStamp, setHandledFocusStamp] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (focusStamp === undefined || focusStamp === handledFocusStamp || !focusEntryId) return;
    setHandledFocusStamp(focusStamp);
    const focused = entries.find(e => e.id === focusEntryId);
    if (focused) {
      if (focused.kind === 'leftover') setOpenLeftoverId(focused.sourceId);
      else if (focused.kind === 'product' && focused.itemId) {
        setOpenItemField('products');
        setOpenItemId(focused.itemId);
      } else setOpenItemId(focused.sourceId);
      return;
    }
    // Not in the list, which is the normal case for one link rather than an
    // edge case for the rest: a pantry check (utils/pantryCheckTasks.ts) is
    // *about* an item the pantry has stopped vouching for, so it can never
    // match an entry here. The id still names a real catalog row and the sheet
    // is what we'd have opened anyway, so open it by id — which is also what
    // the Pantry pills in it are for.
    //
    // Anything left over resolves to nothing at all — the item was deleted, or
    // a container finished, before the link was tapped — and falls back to the
    // plain list, which is what this did for every miss before.
    const parsed = parseKitchenEntryId(focusEntryId);
    if (parsed?.kind === 'grocery' && items.some(i => i.id === parsed.sourceId)) {
      setOpenItemId(parsed.sourceId);
    } else if (parsed?.kind === 'product') {
      // A box whose row has gone quiet — the same "link outlives the entry"
      // case above. Its item is still the right place to land, so resolve
      // through the box rather than giving up.
      const product = itemProducts.find(p => p.id === parsed.sourceId);
      if (product && items.some(i => i.id === product.itemId)) {
        setOpenItemField('products');
        setOpenItemId(product.itemId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntryId, focusStamp, handledFocusStamp]);

  // Read live from the store by id so the sheet's caption follows an edit it
  // just made.
  const openLeftover = useMemo(
    () => leftovers.find(l => l.id === openLeftoverId) ?? null,
    [leftovers, openLeftoverId]
  );

  // The field does both jobs, the way PillGroup's filter does: it narrows the
  // list, and what it can't find is what you're offered the chance to add. One
  // field rather than two because the question is the same one either way —
  // "do I have flour" is exactly the moment you find out you never told it.
  const typed = query.trim();
  const typedKey = groceryNameKey(typed);
  // Hidden once the typed name *is* one of these rows, so the add can't be
  // pressed to re-assert something the list is already showing. Matched
  // against every kind: a container called "Chilli" is an answer to "have I
  // got chilli" even though the add would file a catalog row.
  const canAdd =
    !!typed &&
    !entries.some(e => e.matchKey === (typedKey || typed.toLowerCase()));

  const handleAdd = () => {
    if (!addToPantry(typed)) {
      haptics.error();
      return;
    }
    haptics.success();
    // Cleared like every other add field in the app, so the next name can be
    // typed straight in; the row it just made is in the list behind it.
    setQuery('');
  };

  const handleMarkOut = (entry: KitchenEntry) => {
    haptics.tap();
    // A box's ✕ writes the box and says nothing about its siblings — being out
    // of the Beyond one is not being out of vegan ground beef. The item-level
    // ✕ still means all of them, which is why an item's own "Out of it"
    // outranks every box in `probablyHaveReason`.
    const changed = entry.kind === 'product'
      ? markProductsOutOf([entry.sourceId])
      : markOutOfMany([entry.sourceId]);
    if (changed > 0) haptics.success();
  };

  // The other half of a drop (`resolveKitchenDrop` is the first): each move is
  // written through the same store action the row's own sheet writes, so a
  // drag says exactly what the freezer toggle and the aisle picker already
  // said, and none of the reconciling either one does is bypassed.
  //
  // Leaving the freezer for an aisle is two writes because it's two facts —
  // the thaw, and where the item is filed — and both are idempotent, so a row
  // dragged between aisles without ever having been frozen still writes only
  // the one that changed.
  const applyMoves = (moves: readonly KitchenMove[]) => {
    setDropNonce(n => n + 1);
    if (moves.length === 0) return;
    for (const move of moves) {
      if (move.kind === 'grocery') {
        if (move.to.place === 'freezer') setFrozen(move.sourceId, true);
        else if (move.to.place === 'aisle') {
          setFrozen(move.sourceId, false);
          setAisle(move.sourceId, move.to.aisle);
        }
      } else if (move.kind === 'product') {
        // A box freezes and thaws on its own — that's the whole reason it has
        // its own row — but the aisle it lands in is written to its *item*,
        // because an aisle is where the food sits in a shop and two brands of
        // one thing don't sit in two. So dragging one box to Frozen leaves its
        // sibling in Produce, while dragging it to Dairy moves both.
        if (move.to.place === 'freezer') setProductFrozen(move.sourceId, true);
        else if (move.to.place === 'aisle') {
          setProductFrozen(move.sourceId, false);
          if (move.itemId) setAisle(move.itemId, move.to.aisle);
        }
      } else if (move.to.place === 'freezer') {
        setLeftoverFrozen(move.sourceId, true);
      } else if (move.to.place === 'fridge') {
        setLeftoverFrozen(move.sourceId, false);
      }
    }
    haptics.success();
  };

  // The scan sheet only ever hands back which rows to check off a list
  // (itemIds) and which to mint or promote (toAdd) — shopping-list concepts
  // that don't apply here. What this screen wants out of a session is just
  // the names: an already-matched row's current name, or a new row's shopper
  // name, fed through addManyToPantry exactly like the typed field above.
  // `frozenItemIds`/`draft.frozen` carry the sheet's per-row freezer toggle;
  // both are reduced to the same name strings so addManyToPantry can match
  // them back up (see its own doc comment on why that's safe). The barcode's
  // box — brand and variant — is reduced the same way: `products` (matched
  // rows) and `draft.brand` (minted rows) both key by itemId or draft, so
  // they're re-keyed onto the same name strings before the call. The source's
  // category rides the same map as an `aisle`, minted rows only — same
  // restraint GroceryScreen.handleScanApply's own `addByName` call takes.
  //
  // The barcode itself rides along on the same map, for the same reason the
  // freezer flag does: a row this batch mints has no id until addManyToPantry
  // creates it, so the link can only be made from inside that loop. Unlike the
  // box, a barcode is worth carrying for a row that has no brand or variant at
  // all — an unfound code the user just named is the one most worth
  // remembering, so `noteScanned` writes an entry either way.
  const handleScanApply = (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[]
  ) => {
    const names = [
      ...itemIds
        .map(id => items.find(i => i.id === id)?.name)
        .filter((name): name is string => !!name),
      ...toAdd.map(draft => draft.name),
    ];
    const frozenNames = new Set([
      ...itemIds
        .filter(id => frozenItemIds.has(id))
        .map(id => items.find(i => i.id === id)?.name)
        .filter((name): name is string => !!name),
      ...toAdd.filter(draft => draft.frozen).map(draft => draft.name),
    ]);
    const productByItemId = new Map(products.map(p => [p.itemId, p]));
    const gtinByItemId = new Map(gtinLinks.map(link => [link.itemId, link.gtin]));
    const productNames = new Map<
      string,
      { brand: string | null; variant: string | null; gtin?: string | null; aisle?: string | null }
    >();
    const noteScanned = (
      name: string,
      box: { brand: string | null; variant: string | null } | undefined,
      gtin: string | null,
      aisle?: string | null
    ) => {
      if (!box && !gtin && !aisle) return;
      productNames.set(name, { brand: box?.brand ?? null, variant: box?.variant ?? null, gtin, aisle });
    };
    for (const id of itemIds) {
      const item = items.find(i => i.id === id);
      if (!item) continue;
      noteScanned(item.name, productByItemId.get(id), gtinByItemId.get(id) ?? null);
    }
    for (const draft of toAdd) {
      const matched = draft.existingItemId ? productByItemId.get(draft.existingItemId) : undefined;
      // A promoted row was linked by the sheet, which knew its id; a minted one
      // carries its code on the draft because nothing knew its id yet.
      const gtin = draft.existingItemId
        ? gtinByItemId.get(draft.existingItemId) ?? null
        : draft.gtin ?? null;
      // A minted row's brand only, same as GroceryScreen's own scan handler —
      // there's no existing item name yet for `variantFor` to subtract from.
      const box = matched ?? (draft.brand ? { brand: draft.brand, variant: null } : undefined);
      // Same restraint as the box: the source's category only applies to a row
      // this batch mints, matching GroceryScreen.handleScanApply's own
      // addByName(..., { aisle: draft.aisle }) call, which never touches an
      // already-matched item's filing either.
      noteScanned(draft.name, box, gtin, draft.existingItemId ? undefined : draft.aisle);
    }
    setScanOpen(false);
    if (names.length === 0) return;
    if (addManyToPantry(names, frozenNames, productNames) > 0) haptics.success();
  };

  /**
   * A receipt, read into the kitchen rather than onto a list.
   *
   * The same sheet `GroceryScreen` uses (`ReceiptImportSheet`, `context`
   * prop), reduced the same way the barcode session above is: it hands back
   * shopping-list concepts, and what this screen wants out of it is names and
   * prices. Matched rows here came from the catalog rather than the list — see
   * `ReceiptScope` — so `itemIds` are ordinary items whose current name is
   * what `addManyToPantry` files them under, exactly as the typed field does.
   *
   * `purchasedAt` is dropped, and the sheet doesn't ask for it here: nothing
   * in the pantry writes a purchase date. `addToPantry` stamps on-hand from
   * now, and a use-by day comes from `finishShopping`, which this isn't one of.
   *
   * The prices ride the same name-keyed map the freezer flag and the box do,
   * for the reason `addManyToPantry` gives — a row this batch mints has no id
   * until the loop creates it. What they record is deliberately smaller than a
   * trip's: see that action's own doc comment.
   */
  const handleReceiptApply = (
    shopId: string | null,
    itemIds: string[],
    priceById: Record<string, number>,
    _purchasedAt: string,
    toAdd: ReceiptAddDraft[]
  ) => {
    const nameOf = (id: string) => items.find(i => i.id === id)?.name;
    const names = [
      ...itemIds.map(nameOf).filter((name): name is string => !!name),
      ...toAdd.map(draft => draft.name),
    ];
    const priceByName = new Map<string, number>();
    for (const id of itemIds) {
      const name = nameOf(id);
      const minor = priceById[id];
      if (name && minor !== undefined) priceByName.set(name, minor);
    }
    for (const draft of toAdd) {
      if (draft.priceMinor !== null) priceByName.set(draft.name, draft.priceMinor);
    }
    setReceiptOpen(false);
    if (names.length === 0) return;
    if (
      addManyToPantry(names, undefined, undefined, { byName: priceByName, shopId }) > 0
    ) haptics.success();
  };

  const renderEntry = (entry: KitchenEntry, drag: () => void, isActive: boolean) => {
    // Three levels for four states, the fridge card's own rule: `fresh` reads
    // as ordinary tertiary text, so most of a kitchen stays quiet and the one
    // thing going off is the one thing coloured.
    const tint = entry.freshness ? freshnessColor(entry.freshness, colors) : colors.textTertiary;
    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => {
          haptics.tap();
          if (entry.kind === 'leftover') setOpenLeftoverId(entry.sourceId);
          // A box's corrections live on the box, so its row opens the item
          // sheet with the Products field already unfolded — the same
          // pre-opening a catalog row gets for its Pantry field, and for the
          // same reason: a collapsed field halfway down a dense sheet is in
          // practice no way to correct anything.
          else if (entry.kind === 'product' && entry.itemId) {
            setOpenItemField('products');
            setOpenItemId(entry.itemId);
          } else setOpenItemId(entry.sourceId);
        }}
        // The lift haptic is ReorderableList's own, so there's none here.
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}, ${entry.caption}`}
        accessibilityHint={
          entry.kind === 'leftover'
            ? 'Opens the container, where you can close it out. Long press to move it between the fridge and the freezer'
            : entry.kind === 'product'
              ? 'Opens the item, where you can correct this one. Long press to move it to another aisle or the freezer'
              : 'Opens the item, where you can correct it further. Long press to move it to another aisle or the freezer'
        }
      >
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{entry.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {/* Which packet, in its own weight and the brighter grey, because
                on an item that has split into two rows this is the only thing
                telling them apart — at caption weight the two read as one row
                drawn twice. Leading, so it survives the truncation that eats
                the end of a long line at 390pt. */}
            {!!entry.productName && (
              <Text style={styles.metaBox}>{`${entry.productName} · `}</Text>
            )}
            {entry.reason}
            {entry.onList && ' · on the list'}
            {!!entry.useByCaption && (
              <Text style={{ color: tint }}>{` · ${entry.useByCaption}`}</Text>
            )}
          </Text>
        </View>
        {/* The single most common action on a catalog row, one tap away rather
            than two — see the doc comment above. A container has none: "gone"
            is a two-way question there, and its row's tap asks it properly. */}
        {entry.kind !== 'leftover' && (
          <PressableScale
            style={styles.outButton}
            onPress={() => handleMarkOut(entry)}
            hitSlop={8}
            accessibilityLabel={
              entry.productName
                ? `Mark ${entry.productName} ${entry.title} out`
                : `Mark ${entry.title} out`
            }
            accessibilityHint={
              entry.kind === 'product'
                ? 'Marks this one not on hand, leaving the others alone'
                : 'Marks it not on hand, without opening the item'
            }
          >
            <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
          </PressableScale>
        )}
      </TouchableOpacity>
    );
  };

  const renderRow = ({
    item: row,
    drag,
    isActive,
  }: {
    item: KitchenRow;
    drag: () => void;
    isActive: boolean;
  }) => {
    if (row.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{row.section}</Text>
        </View>
      );
    }
    if (row.type === 'dropHint') {
      return (
        <View style={styles.dropHint}>
          <Text style={styles.dropHintText}>
            {row.section === FREEZER_SECTION
              ? 'Drag something here to put it in the freezer'
              : 'Drag a container here to take it out of the freezer'}
          </Text>
        </View>
      );
    }
    return renderEntry(row.entry, drag, isActive);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Pantry"
        subtitle={entries.length > 0 ? describeKitchen(entries) : undefined}
        actions={[
          // Gated on a key for the reason the shopping list's own receipt
          // button is: the reading is the whole feature, and without one this
          // opens a sheet that can only apologise.
          // Both also go with simplified mode, which drops this screen from the
          // hub pills — a deep link (a use-up task's own link) can still land
          // here, so the actions have to answer for the mode themselves.
          ...(anthropicApiKey && !featureHidden('receiptImport', simpleMode)
            ? [
                {
                  icon: 'receipt-outline' as const,
                  onPress: () => setReceiptOpen(true),
                  accessibilityLabel: 'Scan a receipt into the pantry',
                },
              ]
            : []),
          ...(featureHidden('barcodeScanning', simpleMode)
            ? []
            : [{
                icon: 'barcode-outline' as const,
                onPress: () => setScanOpen(true),
                accessibilityLabel: 'Scan a barcode into the pantry',
              }]),
        ]}
      />
      <GroceriesHubPills active="Kitchen" />
      <TipHost screen="kitchen" />
      {!!activeTripShop && (
        <ActiveTripBanner
          shopName={activeTripShop.name}
          onChange={() => resetToGroceries()}
          onFinish={() => resetToGroceries(true)}
          onClear={handleClearTrip}
        />
      )}

      {/* Outside the list rather than in its header, so it doesn't scroll away
          from a question the user has just been asked. */}
      <ItemDisposalOffer
        onOpenShelfLife={id => {
          setOpenItemField('useBy');
          setOpenItemId(id);
        }}
      />

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Find or add an item…"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType={canAdd ? 'done' : 'search'}
          onSubmitEditing={canAdd ? handleAdd : undefined}
          accessibilityLabel="Find something in the pantry, or type a name to add it"
        />
      </View>

      {canAdd && (
        <View style={styles.addWrap}>
          <InlineAction
            label={`Add “${typed}”`}
            icon="add"
            onPress={handleAdd}
            accessibilityLabel={`Add ${typed} to the pantry`}
          />
        </View>
      )}

      {/* The only in-app explanation of where this list comes from, so it
          says the mechanism rather than describing the feature. */}
      {entries.length > 0 && !typed && (
        <Text style={styles.caption}>
          Worked out from what you buy, what you&apos;ve marked, and what
          you&apos;ve put in the fridge. Tap ✕ to say you&apos;re out of something.
        </Text>
      )}

      <ReorderableList
        data={rows}
        keyExtractor={kitchenRowKey}
        renderItem={renderRow}
        // dragTick, not tap: a fast drag crosses several rows between frames
        // and unthrottled ticks run together into one long buzz. The lift
        // itself is fired by ReorderableList.
        onHoverChange={haptics.dragTick}
        dragRange={kitchenDragRange}
        placeholderStyle={styles.dropSlot}
        onReorder={reordered => applyMoves(resolveKitchenDrop(reordered))}
        ListHeaderComponent={suggestionHeader}
        // Full height when empty so the empty state's `flex: 1` has something
        // to centre in, and without the list's padding shifting that centre.
        contentContainerStyle={
          rows.length === 0
            ? styles.emptyContainer
            : [styles.list, { paddingBottom: tabBarHeight + spacing.xl }]
        }
        ListEmptyComponent={
          <EmptyState
            icon="file-tray-stacked-outline"
            title={typed ? 'Nothing matches' : 'Nothing in the pantry yet'}
            subtitle={
              typed
                ? 'Nothing you probably have goes by that name. Add it above to say you do.'
                : 'Finish a shopping trip and what you bought turns up here, along with anything you put in the fridge. Type a name above, or scan a barcode or a receipt, to add something you already have.'
            }
            bottomOffset={tabBarHeight}
          />
        }
      />

      <GroceryItemSheet
        visible={openItemId !== null}
        itemId={openItemId}
        onClose={() => {
          setOpenItemId(null);
          setOpenItemField('pantry');
        }}
        // Opened on the Pantry pills, since that's what a catalog row here is:
        // the sheet is dense enough that a collapsed "Pantry" field halfway
        // down it was, in practice, no way to say you're out of something. The
        // repeat-waste offer is the one thing that opens it anywhere else, and
        // it lands on the field it's actually asking about.
        initialField={openItemField}
      />

      <BarcodeScanSheet
        visible={scanOpen}
        context="pantry"
        onClose={() => setScanOpen(false)}
        onApply={handleScanApply}
      />

      <ReceiptImportSheet
        visible={receiptOpen}
        context="pantry"
        onClose={() => setReceiptOpen(false)}
        onApply={handleReceiptApply}
      />

      <LeftoverSheet
        visible={openLeftover !== null}
        leftover={openLeftover}
        // Never called: this sheet only ever opens an existing container, and
        // the log flow that would need it belongs to the meal plan, where a
        // cooking is what leaves something behind.
        onLog={() => {}}
        onRename={title => openLeftover && renameLeftover(openLeftover.id, title)}
        onSetStoredAt={storedAt => openLeftover && setLeftoverStoredAt(openLeftover.id, storedAt)}
        onSetKeepDays={days => openLeftover && setLeftoverKeepDays(openLeftover.id, days)}
        onFinish={outcome => openLeftover && finishLeftover(openLeftover.id, outcome)}
        onSetFrozen={frozen => openLeftover && setLeftoverFrozen(openLeftover.id, frozen)}
        onSplit={() => openLeftover && splitLeftover(openLeftover.id)}
        onReopen={() => openLeftover && reopenLeftover(openLeftover.id)}
        onDelete={() => openLeftover && deleteLeftover(openLeftover.id)}
        onClose={() => setOpenLeftoverId(null)}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    search: {
      flex: 1,
      fontSize: font.md,
      color: colors.text,
      // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
      // with no baseline compensation, so the glyphs sit low in the box.
      height: 40,
      padding: 0,
    },
    // Left-aligned under the field it belongs to, and only as wide as its
    // label — the pill is one option, not a submit button spanning the sheet.
    addWrap: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    caption: {
      fontSize: font.sm,
      color: colors.textTertiary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
    emptyContainer: { flexGrow: 1 },
    suggestWrap: {
      paddingHorizontal: spacing.md,
      // Both sides, not just the one that happened to matter: the caption
      // below has no top margin of its own.
      marginTop: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.xs,
    },
    suggestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    suggestBody: { flex: 1, minWidth: 0 },
    suggestName: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    suggestMeta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    sectionHeader: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    sectionTitle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
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
    rowActive: {
      // The lifted card, one surface brighter — the same "picked up" treatment
      // a dragged grocery row and a dragged aisle get.
      backgroundColor: colors.bgTertiary,
    },
    dropSlot: {
      // Matches the row geometry above, so the gap that opens is exactly the
      // shape of the row about to land in it.
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      backgroundColor: colors.bgSecondary,
      opacity: 0.55,
    },
    // The empty target under a place with nothing in it. Dashed and unfilled
    // so it reads as a space waiting for something rather than as a row that
    // is already there — the only row on this screen that isn't a thing you
    // have.
    dropHint: {
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderStyle: 'dashed',
      borderColor: colors.separator,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    dropHintText: { fontSize: font.sm, color: colors.textTertiary },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    metaBox: { color: colors.textSecondary, fontWeight: fontWeight.medium },
    outButton: { padding: 2 },
  });
}
