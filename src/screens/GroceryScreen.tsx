// The shopping list itself, grouped by aisle. One component of ~840 lines, so
// grep a landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   AddGroceryFabWithDropLabel, makeStyles   the FAB and styles
//
// Aisles, shops, the active trip and the kitchen are all in
// docs/arch/groceries.md; this file is the screen over them.
import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { TipHost } from '../components/TipHost';
import { EmptyState } from '../components/EmptyState';
import { GroceryAddSheet } from '../components/GroceryAddSheet';
import { FabMenu, FAB_SIZE, type FabDragHandlers, type FabMenuItem } from '../components/Fab';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import {
  categoriesByIndex,
  type DragScroller,
  type DropZone,
  type FabDropIntent,
} from '../utils/fabDrop';
import { GroceryRow } from '../components/GroceryRow';
import { GroceryCatalogSheet } from '../components/GroceryCatalogSheet';
import { SubstituteSheet } from '../components/SubstituteSheet';
import { GroceryItemSheet } from '../components/GroceryItemSheet';
import { GroceryAislesSheet } from '../components/GroceryAislesSheet';
import { FinishShoppingSheet } from '../components/FinishShoppingSheet';
import { GroceryListSheet } from '../components/GroceryListSheet';
import { ReceiptImportSheet, type ReceiptAddDraft } from '../components/ReceiptImportSheet';
import { BarcodeScanSheet, type ScanProductDraft } from '../components/BarcodeScanSheet';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { ShoppingTripSheet } from '../components/ShoppingTripSheet';
import { StartTripPrompt } from '../components/StartTripPrompt';
import { featureHidden } from '../utils/simpleMode';
import { ActiveTripBanner } from '../components/ActiveTripBanner';
import {
  describeGroupedUnavailable,
  describeTripMarker,
  resolveActiveTrip,
  tripMarkerFor,
} from '../utils/activeTrip';
import { InlineAction } from '../components/InlineAction';
import { ListBulkBar } from '../components/ListBulkBar';
import { ReorderableList, type RowScroller } from '../components/ReorderableList';
import { useScrollToTopOnTabPress } from '../hooks/useScrollToTopOnTabPress';
import { useRowSelection } from '../hooks/useRowSelection';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { GroceryAISheet, type GroceryAIMode } from '../components/GroceryAISheet';
import { RecipeSourceSheet } from '../components/RecipeSourceSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { describeListEstimate, estimateListTotal, lastPriceFor, pricedSince, priceToInput } from '../utils/groceryPrice';
import { buildGroceryListShareText, buildGroceryListText } from '../utils/shareText';
import { useGroceryStore } from '../store/useGroceryStore';
import { useTaskStore } from '../store/useTaskStore';
import { describeSupplyStockCaption, suppliesStockedFrom } from '../utils/supply';
import { useRecipeStore } from '../store/useRecipeStore';
import { alternativeCaptions } from '../utils/recipeComponents';
import { buildGrocerySections, buildGroceryRecipeSections } from '../utils/grocerySuggest';
import { resolveGroceryDrop, groceryDragRange, placeNewGroceryItems } from '../utils/groceryReorder';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { generateId } from '../utils/id';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import { KNOWN_LINK_APPS } from '../constants/linkApps';
import type { GroceryItem, ItemProduct, Recipe, Shop } from '../types';
import { preferredProductOf } from '../utils/groceryProduct';
import { itemsOnList, listNameFor, isAwayList, HOME_LIST_NAME } from '../utils/groceryLists';

// The same scheme a recurring "Grocery run" task already carries in its
// linkUrl — looked up by name rather than duplicated as a literal, so the two
// stay in sync if the app's own entry ever moves.
const GROCERIES_LINK_URL = KNOWN_LINK_APPS.find(app => app.name === 'Groceries')!.scheme;

/**
 * A flat stream of tagged rows rather than a SectionList — the same shape
 * TodayScreen uses for its headers and stacks. It keeps one scroll view, it
 * makes the in-cart collapse a matter of which rows are in the array rather
 * than a second animation system, and it is what lets one drag both reorder an
 * item and move it to another aisle: the row lands where it's dropped and takes
 * the aisle of the nearest header above (see resolveGroceryDrop).
 *
 * `unavailableHeader` is the same idea one level down: a label *inside* an
 * aisle's own run of rows, not a new aisle. It only ever appears while a trip
 * is running and only when that aisle actually has a row to put under it —
 * see the `rows` memo below.
 *
 * `recipeHeader` is the other lens on the same rows (#1717) — aisle and
 * recipe are mutually exclusive groupings of one list, never both at once, so
 * it's a sibling of `aisle` rather than something layered on top of it. It
 * carries no `category` a dropped add button could seed (see `zoneByKey`):
 * unlike an aisle, "which recipe" isn't something placement can assign, so
 * every FAB drop zone stands down to `rest` while grouped this way, and row
 * drag is disabled for the same reason (see the `drag` prop below).
 */
type ListRow =
  | { type: 'aisle'; key: string; aisle: string }
  | { type: 'recipeHeader'; key: string; label: string }
  | { type: 'unavailableHeader'; key: string; groupKey: string; count: number }
  | { type: 'cartHeader'; key: string; count: number }
  | { type: 'item'; key: string; item: GroceryItem; inCart: boolean; unavailableHere: boolean };

// The add button, naming what a release right now would do.
function AddGroceryFabWithDropLabel({
  channel,
  ...props
}: {
  channel: FabIntentChannel;
} & Omit<React.ComponentProps<typeof FabMenu>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent => {
    if (intent?.kind === 'cancel') return 'Cancel';
    if (intent?.kind !== 'insert') return null;
    return intent.category ? `New item in ${intent.category}` : 'New item here';
  });
  return <FabMenu {...props} dragLabel={label} />;
}

export function GroceryScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const items = useGroceryStore(useShallow(s => s.items));
  const lists = useGroceryStore(useShallow(s => s.lists));
  const listEntries = useGroceryStore(useShallow(s => s.listEntries));
  const activeListId = useGroceryStore(s => s.activeListId);
  /**
   * The trolley this screen is showing — the rows of the active list, and only
   * those. `items` beside it stays the whole catalog, which is what the sheets
   * this screen opens want (an item sheet, the catalog browser, the add field's
   * autocomplete all reason about every row you have ever bought, whatever list
   * it is or isn't on today).
   *
   * Everything below that means "the list" reads this instead. That split is
   * the one thing to keep right when adding to this screen: a count, a section,
   * a share, an estimate and a bulk action are all about the trolley in front
   * of you, and reading `items` for one of them is how the milk you need at
   * home turns up on the Airbnb list.
   */
  const listRows = useMemo(
    () => itemsOnList(items, listEntries, activeListId),
    [items, listEntries, activeListId]
  );
  const activeListName = useMemo(() => listNameFor(activeListId, lists), [activeListId, lists]);
  /**
   * Whether this is a list you're away from home for. Everything it changes on
   * this screen is about *not recording* the shop — see `GroceryList`. The
   * store enforces that in `finishShopping`; what the screen owes is saying so,
   * and not asking questions whose answers would be thrown away.
   */
  const away = isAwayList(activeListId);
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const groupBy = useGroceryStore(s => s.groceryGroupBy);
  const cartHoldIds = useGroceryStore(useShallow(s => s.cartHoldIds));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const toggleChecked = useGroceryStore(s => s.toggleChecked);
  const setCheckedMany = useGroceryStore(s => s.setCheckedMany);
  const setAisleMany = useGroceryStore(s => s.setAisleMany);
  const addAisle = useGroceryStore(s => s.addAisle);
  const removeFromListMany = useGroceryStore(s => s.removeFromListMany);
  const finishShopping = useGroceryStore(s => s.finishShopping);
  const addExisting = useGroceryStore(s => s.addExisting);
  const addByName = useGroceryStore(s => s.addByName);
  const addProduct = useGroceryStore(s => s.addProduct);
  const linkScannedGtins = useGroceryStore(s => s.linkScannedGtins);
  const markItemsUnavailable = useGroceryStore(s => s.markItemsUnavailable);
  const linkItemSub = useGroceryStore(s => s.linkItemSub);
  const swapForSubstitute = useGroceryStore(s => s.swapForSubstitute);
  const setItemPrice = useGroceryStore(s => s.setItemPrice);
  const clearItemShopPrice = useGroceryStore(s => s.clearItemShopPrice);
  const clearList = useGroceryStore(s => s.clearList);
  const applyDrop = useGroceryStore(s => s.applyDrop);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const startTrip = useGroceryStore(s => s.startTrip);
  const endTrip = useGroceryStore(s => s.endTrip);
  const checkTripExpiry = useGroceryStore(s => s.checkTripExpiry);
  const addTask = useTaskStore(s => s.addTask);

  // ==== local state (the sheets this screen opens, selection, editing) ====
  const [cartOpen, setCartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [aislesOpen, setAislesOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // The scan sheet's per-row freezer toggle, held here rather than written
  // immediately: a scan only checks an item onto the list, and the item isn't
  // bought yet — see finishShopping's own doc comment on frozenIds. Applied
  // (and cleared) when the trip actually finishes; cleared without applying
  // if the trip is abandoned instead.
  const [scanFrozenIds, setScanFrozenIds] = useState<ReadonlySet<string>>(new Set());
  // What a scanned receipt read, held between the two sheets. Undefined rather
  // than null when there's no receipt in play: the finish sheet tells the two
  // apart, since a receipt naming no store is a real answer and not an absent
  // one.
  const [receiptSeed, setReceiptSeed] = useState<
    {
      shopId: string | null;
      priceText: Record<string, string>;
      purchasedAt: string;
      /**
       * Distinguishes one reading from the next, for the finish sheet's sake —
       * see its `seedStamp` prop. A receipt read while that sheet is open has
       * no opening to arrive on, and two receipts can name the same store and
       * the same prices.
       */
      stamp: string;
    } | null
  >(null);
  const [tripOpen, setTripOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The item whose substitutes are being looked at, from the row's swap glyph.
  const [substitutesForId, setSubstitutesForId] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<GroceryAIMode | null>(null);
  const [recipeSourceOpen, setRecipeSourceOpen] = useState(false);
  const [recipeToAdd, setRecipeToAdd] = useState<Recipe | null>(null);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  // sourceRecipeId is a snapshot pointer and doesn't cascade, so a row can
  // outlive the recipe that put it there. The set is what decides whether the
  // item sheet's recipe link is tappable — see GroceryItemSheet.recipeExists.
  const recipeIds = useMemo(() => new Set(recipes.map(r => r.id)), [recipes]);
  // "or pears", per row. Only what's still on the list counts as a live option
  // — an off-list catalog row that once shared the group is history — and
  // alternativeCaptions drops a group that's down to one, so a resolved pair
  // stops captioning itself with no extra bookkeeping. Shared with the recipe
  // screen's either/or ingredients: it's the same rule, and writing it twice is
  // how the two would drift.
  const alternativeCaptionById = useMemo(
    () => alternativeCaptions(listRows.filter(i => i.choiceGroup)),
    [listRows]
  );
  // "For “Change the water filter”", per row — which task's supply keeps this
  // one stocked. Only the screen can reach the task list, the same reason the
  // either/or captions and the store markers are computed here rather than in
  // the row.
  //
  // Built for the rows *on the list*, since that's where the question ("why is
  // this here?") is asked; an off-list catalog row is being browsed, not
  // explained. Selecting only the supply-carrying tasks keeps this off Today's
  // write path — the list of tasks changes constantly and almost none of them
  // have a supply.
  const supplyTasks = useTaskStore(
    useShallow(s => s.tasks.filter(t => t.supplyGroceryItemId !== null))
  );
  const stockedForById = useMemo(() => {
    const out = new Map<string, string>();
    for (const item of listRows) {
      const caption = describeSupplyStockCaption(suppliesStockedFrom(item.id, supplyTasks));
      if (caption) out.set(item.id, caption);
    }
    return out;
  }, [listRows, supplyTasks]);
  const openRecipe = useCallback(
    (recipeId: string) => {
      haptics.tap();
      navigation.navigate('RecipeDetail', { recipeId });
    },
    [navigation]
  );

  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
  } = useRowSelection();

  // Every AI affordance is gated on this, so a user without a key never sees
  // an entry point — the offline lexicon carries the feature on its own.
  //
  // Two exceptions now, and both go through `useAiRoute` rather than reading
  // this: aisle sorting can be answered by the on-device language model, and
  // receipt scanning can be *read* by Vision even though naming what was read
  // still wants a key. What is left gated on a key outright is what needs world
  // knowledge, or a photograph the device can't make sense of on its own.
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const aisleSortRoute = useAiRoute('groceryAisles');
  const receiptRoute = useAiRoute('receiptImport');
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);

  // Two mutually exclusive lenses over the same rows — see the ListRow doc
  // comment above for why grouping is a `kind` rather than two independent
  // toggles. `sections`' shape follows `kind`, so every reader below narrows
  // on it rather than assuming aisle's.
  // ==== the list: items grouped into aisle sections ====
  const grouped = useMemo(() => {
    if (groupBy === 'recipe') {
      const r = buildGroceryRecipeSections(listRows, cartHoldIds);
      return { kind: 'recipe' as const, sections: r.sections, inCart: r.inCart, remaining: r.remaining };
    }
    const r = buildGrocerySections(listRows, aisleOrder, cartHoldIds);
    return { kind: 'aisle' as const, sections: r.sections, inCart: r.inCart, remaining: r.remaining };
  }, [listRows, aisleOrder, cartHoldIds, groupBy]);
  const { inCart, remaining } = grouped;

  // The store you're standing in, if you've said. Everything the trip changes
  // on this screen hangs off this one value being non-null.
  const activeTripShop = useMemo(
    () => resolveActiveTrip(tripShopId, tripStartedAt, shops, new Date()),
    [tripShopId, tripStartedAt, shops]
  );

  // A store flagged "don't suggest" (Amazon: "it has everything") stays out of
  // every trip-starting surface — the header action and StartTripPrompt below.
  // It's still fully linkable by hand elsewhere, just never the thing either
  // of these offer.
  const suggestableShops = useMemo(
    () => shops.filter(shop => !shop.excludeFromSuggestions),
    [shops]
  );
  // A trip can outlive the moment it was last rendered, and the memo above
  // can't notice on its own — its inputs haven't changed. Clearing the store
  // fields is what makes an expired trip disappear rather than merely stop
  // resolving. Focus rather than mount: this screen stays mounted behind a tab.
  // ==== effects ====
  useFocusEffect(
    useCallback(() => {
      checkTripExpiry();
    }, [checkTripExpiry])
  );

  // Computed here rather than in the row for the reason `alternatives` is:
  // only the screen has the links, and a row that subscribed to them would
  // re-render every one of them on any purchase. Empty whenever no trip is
  // running, so the rows go back to exactly what they rendered before.
  //
  // `substituteId` rides alongside the caption only on an `unavailable`
  // marker with a substitute on record — that's the tap-to-swap target
  // (#1567), and its absence is what keeps every other marker's caption
  // inert. `unavailable` is what the `rows` memo below reads to route a row
  // into its aisle's own "Not here" group instead of leaving it in place —
  // and once it's there, the caption switches to `describeGroupedUnavailable`
  // rather than `describeTripMarker`: the group's header already says "not
  // here" once for every row beneath it, so restating it per row would be
  // exactly the over-stuffed caption #1567 was shortened to avoid.
  // The preferred product per row, resolved once for the whole list rather
  // than in each row. Same call `storeMarkers` above makes: `GroceryRow` is
  // memoised, so handing every row the products array would re-render all of
  // them whenever any one item's products changed.
  const preferredProductById = useMemo(() => {
    const out = new Map<string, ItemProduct>();
    for (const item of items) {
      const product = preferredProductOf(item, itemProducts);
      if (product) out.set(item.id, product);
    }
    return out;
  }, [items, itemProducts]);

  const storeMarkers = useMemo(() => {
    const out = new Map<string, { text: string; substituteId?: string; unavailable: boolean }>();
    if (!activeTripShop) return out;
    for (const item of listRows) {
      // The whole catalog is still what a substitute is looked up in — only the
      // rows being marked up are the list's.
      const marker = tripMarkerFor(item, itemShops, shops, activeTripShop, itemSubs, items, itemProducts);
      if (!marker) continue;
      const unavailable = marker.kind === 'unavailable';
      out.set(item.id, {
        text: unavailable ? describeGroupedUnavailable(marker) : describeTripMarker(marker),
        substituteId: marker.substitute?.id,
        unavailable,
      });
    }
    return out;
  }, [activeTripShop, listRows, items, itemShops, shops, itemSubs, itemProducts]);

  // What each checked row costs at the trip's own store, and whether that
  // number was actually typed during *this* trip — see GroceryRow's
  // tripPriceMinor/tripPriceRecorded doc comments for why the row needs both
  // rather than just the price. Scoped to checked rows only: an unchecked one
  // gets no chip, so it costs nothing to compute for it.
  const tripPriceById = useMemo(() => {
    const out = new Map<string, { minor: number | null; recorded: boolean }>();
    if (!activeTripShop || !tripStartedAt) return out;
    for (const item of listRows) {
      if (!item.checked) continue;
      out.set(item.id, {
        minor: lastPriceFor(item, activeTripShop.id, itemShops),
        recorded: pricedSince(item, activeTripShop.id, itemShops, tripStartedAt),
      });
    }
    return out;
  }, [activeTripShop, tripStartedAt, listRows, itemShops]);

  // Resolves to setItemPrice/clearItemShopPrice against the trip's own store
  // — the row itself only knows the item id and a number, not which of the
  // two writes that implies or which shop it's for.
  const handleSetTripPrice = useCallback(
    (id: string, minor: number | null) => {
      if (!activeTripShop) return;
      if (minor === null) clearItemShopPrice(id, activeTripShop.id);
      else setItemPrice(id, minor, activeTripShop.id);
    },
    [activeTripShop, setItemPrice, clearItemShopPrice]
  );

  const checkedCount = useMemo(() => listRows.filter(i => i.checked).length, [listRows]);

  /**
   * "Finish the shop" asked for from somewhere that hasn't got the sheet — the
   * trip Live Activity's Finish button (`dundundun://groceries?finish=1`) and
   * the trip banner on Recipes/Meal plan/Pantry, both of which route through
   * `resetToGroceries(true)`.
   *
   * Stamped-param handoff, the same one MealPlanScreen's `focusStamp` uses:
   * compared against the last value handled, so asking twice in a row still
   * fires twice. Gated on the cart having something in it, which is the same
   * thing both cards above the list say by only growing a Finish button once
   * there's a tick — a request that arrives with an empty cart lands on the
   * list and stops there, because there is nothing for the sheet to finish.
   * The stamp is marked handled either way: a request that found nothing to do
   * is answered, not left pending against the next tick.
   */
  const openFinishStamp: number | undefined = route.params?.openFinish;
  const [handledFinishStamp, setHandledFinishStamp] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (openFinishStamp === undefined || openFinishStamp === handledFinishStamp) return;
    setHandledFinishStamp(openFinishStamp);
    if (checkedCount > 0) setFinishOpen(true);
  }, [openFinishStamp, handledFinishStamp, checkedCount]);
  // Empty for nothing left to buy, which is what the header action's disabled
  // state gates on — see buildGroceryListShareText.
  const shareText = useMemo(() => buildGroceryListShareText(listRows), [listRows]);
  // The same rows without the title line or the bullets, for pasting into
  // another shopping app rather than sending to a person — see shareText.ts.
  const copyText = useMemo(() => buildGroceryListText(listRows), [listRows]);
  const { copied, copy } = useCopyToClipboard();
  // ==== actions: share, estimate, bulk selection, adding ====
  const handleShare = useCallback(() => {
    if (!shareText) return;
    haptics.tap();
    Share.share({ message: shareText }).catch(() => {});
  }, [shareText]);
  // What the trip is about to leave behind, in the walk order the list is in —
  // the finish sheet asks about these, and only these. Ids and names only: the
  // sheet has no business holding rows it can't edit.
  const leftover = useMemo(
    () =>
      grouped.sections.flatMap(section =>
        section.data.filter(i => !i.checked).map(i => ({ id: i.id, name: i.name }))
      ),
    [grouped]
  );
  // The other half of the same read: what the trip is taking home, in the same
  // walk order, for the finish sheet's price fields. Carries quantity because a
  // price is only meaningful next to what it bought.
  const purchased = useMemo(
    () =>
      grouped.sections.flatMap(section =>
        section.data
          .filter(i => i.checked)
          .map(i => ({ id: i.id, name: i.name, quantity: i.quantity }))
      ),
    [grouped]
  );
  // "≈ $47.30 · 9 of 14 priced", or null while nothing on the list has a price.
  // describeListEstimate owns the wording, including the rule that a partial
  // total may never be rendered without saying how partial it is.
  const estimate = useMemo(
    () => describeListEstimate(estimateListTotal(listRows), currencySymbol),
    [listRows, currencySymbol]
  );
  const listCount = remaining + checkedCount;
  const catalogCount = items.length;
  // Only worth offering when the lexicon actually left a gap.
  const unsortedCount = useMemo(
    () => listRows.filter(i => i.aisle === OTHER_AISLE).length,
    [listRows]
  );

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    // Held back rather than pushed in place, so the section's own roster
    // stays first and the "Not here" group — if this trip's store leaves
    // anything out of it — reads as a footnote to that roster, not a
    // second section. Order within each bucket is still the section's own
    // sortOrder walk, just split rather than reordered. Shared between both
    // groupings, which differ only in the header row they push.
    const pushSection = (header: ListRow, groupKey: string, data: GroceryItem[]) => {
      out.push(header);
      const notHere: GroceryItem[] = [];
      for (const item of data) {
        if (storeMarkers.get(item.id)?.unavailable) {
          notHere.push(item);
          continue;
        }
        out.push({ type: 'item', key: item.id, item, inCart: false, unavailableHere: false });
      }
      if (notHere.length > 0) {
        out.push({
          type: 'unavailableHeader',
          key: `unavailable:${groupKey}`,
          groupKey,
          count: notHere.length,
        });
        for (const item of notHere) {
          out.push({ type: 'item', key: item.id, item, inCart: false, unavailableHere: true });
        }
      }
    };
    if (grouped.kind === 'recipe') {
      for (const section of grouped.sections) {
        const key = `recipe:${section.recipeId ?? 'none'}`;
        pushSection({ type: 'recipeHeader', key, label: section.recipeTitle }, key, section.data);
      }
    } else {
      for (const section of grouped.sections) {
        const key = `aisle:${section.aisle}`;
        pushSection({ type: 'aisle', key, aisle: section.aisle }, key, section.data);
      }
    }
    if (inCart.length > 0) {
      out.push({ type: 'cartHeader', key: 'cartHeader', count: inCart.length });
      if (cartOpen) {
        for (const item of inCart) {
          out.push({ type: 'item', key: item.id, item, inCart: true, unavailableHere: false });
        }
      }
    }
    return out;
  }, [grouped, inCart, cartOpen, storeMarkers]);

  // What's actually selectable right now — the cart's rows only join this
  // when the cart is expanded, same as what's tappable on screen.
  const selectableItemIds = useMemo(
    () => rows.filter((r): r is Extract<ListRow, { type: 'item' }> => r.type === 'item').map(r => r.item.id),
    [rows]
  );
  const selectedItems = useMemo(
    () => items.filter(i => selectedIds.has(i.id)),
    [items, selectedIds]
  );
  const allSelectedChecked = selectedItems.length > 0 && selectedItems.every(i => i.checked);

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bulk bar, same as the other bulk-selecting screens.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  // ——— Dragging the add button into the list ———————————————————————————
  //
  // The same gesture Today and Projects have, over the shape this list has: a
  // drop names an aisle and a spot in it, and the item typed into the sheet
  // that opens lands exactly there. The button reports raw pointer positions,
  // FabDropZoneProvider turns those into an intent, and everything below is
  // what each intent means here.

  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  // Lets the drag scroll the list once it reaches either end of the screen.
  const scrollControl = useRef<DragScroller | null>(null);
  // Separate from the drag scroller above: this one backs the tab-press
  // gesture, not autoscroll.
  const rowScroller = useRef<RowScroller | null>(null);
  useScrollToTopOnTabPress(rowScroller);
  // What the drag is aimed at goes through a channel rather than state: it
  // changes as the finger crosses each row, and re-rendering this screen
  // re-runs every row's renderItem. Only the button's label reads it.
  const fabIntentChannel = useFabIntentChannel();
  const [addSeedAisle, setAddSeedAisle] = useState<string | null>(null);
  // The drop the add sheet was opened by, re-anchored after each item so a
  // burst of ten arrives in the order it was typed rather than inside out.
  const pendingDropRef = useRef<Extract<FabDropIntent, { kind: 'insert' }> | null>(null);

  /**
   * Close the add sheet and forget the placement it was opened with. Missing
   * this leaves the placement armed and the next plain tap on the button
   * inherits it — items filed into an aisle because of a drag ten minutes ago.
   */
  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setAddSeedAisle(null);
    pendingDropRef.current = null;
  }, []);

  const zoneByKey = useMemo(() => {
    const map = new Map<string, DropZone>();
    // Grouped by recipe, every row stands down to `rest`: "which recipe" isn't
    // a placement the add button can seed the way an aisle is (see the
    // ListRow doc comment above `recipeHeader`), so a drop here always
    // resolves to a plain add rather than an insert with a category nobody
    // asked for.
    if (grouped.kind === 'recipe') {
      for (const row of rows) map.set(row.key, { kind: 'rest', key: row.key });
      return map;
    }
    const aislesFor = categoriesByIndex(rows.map(r => (r.type === 'aisle' ? r.aisle : null)));
    rows.forEach((row, i) => {
      if (row.type === 'aisle') {
        map.set(row.key, { kind: 'header', key: row.key, category: row.aisle });
      } else if (row.type === 'cartHeader' || row.type === 'unavailableHeader' || row.type === 'recipeHeader' || row.inCart || row.unavailableHere) {
        // Registered, but with nothing to say about placement: the cart is a
        // record of the trolley rather than a place to file something, which is
        // the same bound groceryDragRange puts on a row drag. Leaving these out
        // entirely would let a drop over them reach back up to the last aisle
        // row instead of resolving to "nowhere in particular". A "Not here" row
        // gets the same treatment for the same reason — it's a record of what
        // this store lacks, not a place to file a new item that presumably
        // isn't unavailable here at all.
        map.set(row.key, { kind: 'rest', key: row.key });
      } else {
        map.set(row.key, { kind: 'task', key: row.key, category: aislesFor[i] ?? null });
      }
    });
    return map;
  }, [rows, grouped.kind]);

  /**
   * Give the freshly added items the position the button was dropped at, then
   * re-anchor onto the last of them so the next add in the same burst lands
   * after it rather than back on the original seam.
   */
  const handleItemsAdded = useCallback(
    (created: GroceryItem[]) => {
      const drop = pendingDropRef.current;
      if (!drop || created.length === 0) return;
      // `rows` is this render's list, from before the add — which is exactly
      // what placeNewGroceryItems wants, since it splices the new rows in
      // itself (and drops them from their old spot if they were already there).
      const placements = placeNewGroceryItems(rows, drop.anchorKey, drop.before, created);
      if (placements) applyDrop(placements);
      const last = created[created.length - 1];
      pendingDropRef.current = { ...drop, anchorKey: last.id, before: false };
    },
    [rows, applyDrop]
  );

  const openAddForDrop = useCallback((intent: FabDropIntent) => {
    // Dropped back on the button: the drag is the whole of what happened, so no
    // sheet, and nothing left armed for the next tap (see closeAdd).
    if (intent.kind === 'cancel') {
      pendingDropRef.current = null;
      haptics.tap();
      return;
    }
    // 'insert' and 'plain' are the only two this screen can produce — there are
    // no stacks to join and nothing is pinnable here.
    if (intent.kind === 'insert') {
      pendingDropRef.current = intent;
      setAddSeedAisle(intent.category);
    } else {
      pendingDropRef.current = null;
      setAddSeedAisle(null);
    }
    setAddOpen(true);
  }, []);

  // Rebuilt each render so it closes over fresh state; the button reads it
  // through a ref, and its responder is built once regardless.
  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setFabDragging(true);
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, home) => dropZonesRef.current?.moveTo(pageY, home),
    onEnd: (pageY, home) => {
      setFabDragging(false);
      // end()/cancel() publish a null intent themselves, which is what clears
      // the label.
      openAddForDrop(dropZonesRef.current?.end(pageY, home) ?? { kind: 'plain' });
    },
    onCancel: () => {
      setFabDragging(false);
      dropZonesRef.current?.cancel();
    },
  };

  const handleToggle = useCallback(
    (id: string) => {
      haptics.impactLight();
      animateLayout();
      toggleChecked(id);
    },
    [toggleChecked]
  );

  const handleEdit = useCallback((id: string) => {
    haptics.tap();
    setEditingId(id);
  }, []);

  // Straight to the substitutes sheet, not to the item sheet scrolled at its
  // Substitutes field: the glyph asks one question, and the editor around that
  // field is not the answer to it.
  const handleOpenSubstitutes = useCallback((id: string) => {
    haptics.tap();
    setSubstitutesForId(id);
  }, []);

  // "Not at Safeway · or margarine", tapped — see storeMarkers above and
  // GroceryRow's tap-to-swap.
  const handleSwapForSubstitute = useCallback(
    (id: string, subId: string) => {
      haptics.tap();
      animateLayout();
      swapForSubstitute(id, subId);
    },
    [swapForSubstitute]
  );

  // "Check"/"Uncheck" flips direction based on the selection itself, the same
  // way SimpleBulkBar's Logbook incomplete action always means the opposite of what's
  // there — a selection that's already all in the cart has nothing left to
  // check off.
  const handleBulkCheck = useCallback(() => {
    const next = !allSelectedChecked;
    animateLayout();
    setCheckedMany(Array.from(selectedIds), next);
    haptics[next ? 'success' : 'tap']();
    exitSelection();
  }, [allSelectedChecked, selectedIds, setCheckedMany, exitSelection]);

  const handleBulkSetAisle = useCallback(
    (aisle: string | null) => {
      if (!aisle) return;
      animateLayout();
      const ids = Array.from(selectedIds);
      setAisleMany(Object.fromEntries(ids.map(id => [id, aisle])));
      exitSelection();
    },
    [selectedIds, setAisleMany, exitSelection]
  );

  const handleBulkRemove = useCallback(() => {
    animateLayout();
    removeFromListMany(Array.from(selectedIds));
    exitSelection();
  }, [selectedIds, removeFromListMany, exitSelection]);

  // There is deliberately no bulk Delete here. It sat one chip along from
  // Remove, did something Remove doesn't — took the rows out of the catalog
  // with their purchase history, unrecoverably — and the two are a swipe apart
  // in a bar you enter by swiping a row. A confirm isn't enough of a guard for
  // that, because the confirm is the same "are you sure" every destructive
  // action shows and the difference between the two chips is a sentence inside
  // it. Deleting from the catalog is a catalog job and has two homes on the
  // catalog surfaces: "Forget" on a single item's sheet, and "Forget" over a
  // selection in the catalog. This screen is the shopping list, where the answer
  // to "I don't want this here" is Remove.

  // The confirm is a sheet rather than an Alert because it now carries a store
  // picker, and an Alert can't hold one. It's still a confirm: nothing is
  // recorded until Finish.
  const handleFinished = useCallback(
    (
      shopId: string | null,
      unavailableIds: string[],
      priceById: Record<string, number>,
      substitutes: Array<{ itemId: string; subItemId: string }>,
      purchasedAt?: string
    ) => {
      setFinishOpen(false);
      // The receipt was for the trip that just ended. Leaving it set would
      // pre-fill the next shop with this one's prices.
      setReceiptSeed(null);
      animateLayout();
      // Three writes rather than one, and they can't collide: finishShopping
      // only touches what was ticked into the trolley, and these are precisely
      // what wasn't. The claims go first so they're recorded even if the trip
      // itself finds nothing left to record. A substitute answer is only ever
      // about a row that was just marked unavailable, so it follows that claim
      // rather than racing it.
      if (shopId && unavailableIds.length > 0) markItemsUnavailable(unavailableIds, shopId);
      // Only a pair that isn't already recorded. `linkItemSub` writes the row
      // whole rather than patching it (see its own note), which is right for
      // the sheet that edits a link and wrong here: this caller knows only the
      // two ids, so re-linking a pair the user has already written would erase
      // its caveat, its ratio and its standing-swap bit for nothing. There is
      // nothing to record about a swap that's already on file.
      for (const { itemId, subItemId } of substitutes) {
        if (itemSubs.some(l => l.itemId === itemId && l.subItemId === subItemId)) continue;
        linkItemSub(itemId, subItemId);
      }
      // The prices ride with the trip rather than being a fourth write: they're
      // about what it bought, so they have to land on the same rows in the same
      // pass that takes them off the list. scanFrozenIds rides along the same
      // way, for the same reason — see finishShopping's own doc comment.
      if (finishShopping(shopId, priceById, purchasedAt, scanFrozenIds) > 0) haptics.success();
      // Consumed either way: an id finishShopping didn't end up touching
      // (marked unavailable, substituted away) was never going to be applied
      // on some later trip either.
      setScanFrozenIds(new Set());
      // Unconditional, and deliberately not inside finishShopping: that
      // early-returns on an empty trolley, and finishing a shop you bought
      // nothing at still ends the trip you were on.
      endTrip();
      setCartOpen(false);
    },
    [finishShopping, markItemsUnavailable, linkItemSub, endTrip, itemSubs, scanFrozenIds]
  );

  /**
   * A scanned receipt, confirmed. Ticks the rows it named, mints or promotes
   * whatever the user chose to add as bought, and hands the store, the prices
   * and the purchase date to the finish sheet, which is where the trip
   * actually ends.
   *
   * Deliberately not a call to `finishShopping`. The receipt answers what came
   * home and what it cost; it can't answer which of the leftovers the store
   * didn't have, and that question is the finish sheet's whole second half. So
   * this fills that sheet in and opens it rather than going around it.
   *
   * `toAdd` is where the writing for #1805's "Add as bought" actually happens
   * — `ReceiptImportSheet` only ever hands back a draft (see its own doc
   * comment on why). Existing rows are promoted with `addExisting`; a line
   * with no catalog match mints one with `addByName`, passing the printed
   * label as the raw text a quick-add would have parsed and the line's own
   * shopper-normalized name as the override, so the row is named the way the
   * catalog already asks for it to be.
   */
  const handleReceiptApply = useCallback(
    (
      shopId: string | null,
      itemIds: string[],
      priceById: Record<string, number>,
      purchasedAt: string,
      toAdd: ReceiptAddDraft[]
    ) => {
      animateLayout();
      const allIds = [...itemIds];
      const allPriceById = { ...priceById };
      for (const draft of toAdd) {
        let id: string;
        if (draft.existingItemId) {
          addExisting(draft.existingItemId);
          id = draft.existingItemId;
        } else {
          id = addByName(draft.label, { name: draft.name, quantity: draft.quantity || null }).id;
        }
        allIds.push(id);
        if (draft.priceMinor !== null) allPriceById[id] = draft.priceMinor;
      }
      if (allIds.length > 0) setCheckedMany(allIds, true);
      setReceiptSeed({
        shopId,
        priceText: Object.fromEntries(
          Object.entries(allPriceById).map(([id, minor]) => [id, priceToInput(minor)])
        ),
        purchasedAt,
        stamp: generateId(),
      });
      setReceiptOpen(false);
      // Already true when the scan was started from the finish sheet, which is
      // the point of that entry: it stays mounted underneath, so the ticks and
      // substitutes given before reaching for the camera are still there when
      // the receipt's own answers land on top of them.
      setFinishOpen(true);
    },
    [setCheckedMany, addExisting, addByName]
  );

  /**
   * A scan session, confirmed. Same two writes the receipt path makes, minus
   * everything a barcode can't know.
   *
   * A receipt names a store, a date and a price per line; a barcode names none
   * of the three, so this seeds nothing and lets the finish sheet default as it
   * always does. Clearing `receiptSeed` is the load-bearing half of that: a
   * receipt read earlier in the session would otherwise attach its store and
   * its prices to a trip these scans are what's actually finishing.
   *
   * It still routes through the finish sheet rather than calling
   * `finishShopping` — see the sheet's own doc comment. Unpacking is the end of
   * a shop, and the finish sheet is where a shop ends *and* where the one
   * question no scan can answer gets asked.
   *
   * The scan sheet's freezer toggle is captured into `scanFrozenIds` rather
   * than written here, for the same reason: nothing is bought yet. It rides
   * along to `finishShopping` in `handleFinished`, once it is.
   *
   * **What a barcode knows and a receipt doesn't is the box**: who makes it,
   * and which one of the item it is. A row this session mints takes its brand
   * through `addByName`'s own override — the same one GroceryAddField's Brand
   * chip uses — so it files as that row's first `ItemProduct`. Deliberately not
   * a follow-up `addProduct` call: one add should leave one row in one shape,
   * and threading the brand through the add keeps the minted row identical to
   * the one the Brand chip produces.
   *
   * A row that matched an item the catalog already had travels in `products`
   * instead, written through `addProduct`'s default rule: the scan
   * can supply the very first answer to "which one?" for an item that has
   * never had a box named, but — the whole point of #1866 — it never
   * overrides a preference the user already chose. Unpacking twenty bags
   * doesn't get to silently re-decide the one you picked on purpose; it only
   * ever fills in the ones nobody's answered yet.
   */
  const handleScanApply = useCallback(
    (
      itemIds: string[],
      toAdd: ReceiptAddDraft[],
      frozenItemIds: ReadonlySet<string>,
      products: ScanProductDraft[],
      gtinLinks: ScannedGtinLink[]
    ) => {
      animateLayout();
      const allIds = [...itemIds];
      const frozenIds = new Set(itemIds.filter(id => frozenItemIds.has(id)));
      // A row this loop mints, with the barcode it came from. The sheet linked
      // everything whose id it already knew; these are the ones that had no id
      // until a moment ago. See BarcodeScanSheet's `onApply`.
      const mintedLinks: ScannedGtinLink[] = [];
      for (const draft of toAdd) {
        let id: string;
        if (draft.existingItemId) {
          addExisting(draft.existingItemId);
          id = draft.existingItemId;
        } else {
          id = addByName(draft.label, {
            name: draft.name,
            quantity: draft.quantity || null,
            brand: draft.brand,
            aisle: draft.aisle,
          }).id;
          // Brand-only, matching what addByName just filed: a minted row is
          // *named* after the residue, so there is no variant left over.
          if (draft.gtin) {
            mintedLinks.push({ gtin: draft.gtin, itemId: id, brand: draft.brand, variant: null });
          }
        }
        allIds.push(id);
        if (draft.frozen) frozenIds.add(id);
      }
      // After the loop, so a row this session minted is already there to hang a
      // box off. Default opts: addProduct only promotes when the item has no
      // preference yet, so this fills in the ones nobody's answered without
      // touching one the user already chose (#1866).
      for (const product of products) {
        addProduct(product.itemId, { brand: product.brand, variant: product.variant });
      }
      // Last, because a link finds its box by the brand and variant the writes
      // above just filed. Running it earlier would land every scan on the
      // item-level fallback and never on the box it actually read.
      linkScannedGtins([...gtinLinks, ...mintedLinks]);
      if (allIds.length > 0) setCheckedMany(allIds, true);
      // Merged rather than replaced: a second scan session before the trip
      // finishes shouldn't forget what the first one flagged.
      if (frozenIds.size > 0) {
        setScanFrozenIds(prev => new Set([...prev, ...frozenIds]));
      }
      setReceiptSeed(null);
      setScanOpen(false);
      setFinishOpen(true);
    },
    [setCheckedMany, addExisting, addByName, addProduct, linkScannedGtins]
  );

  const handleClearTrip = useCallback(() => {
    animateLayout();
    endTrip();
    // The trip these were flagged for is the one being abandoned.
    setScanFrozenIds(new Set());
  }, [endTrip]);

  // Starting a trip and planning one are different verbs on the same sheet:
  // the confirm below makes a task for later, this says you're there now. Only
  // ever one store — you can only stand in one — so the sheet offers it for a
  // single selection and the planner keeps the multi-stop case.
  const handleStartTrip = useCallback(
    (shop: Shop) => {
      animateLayout();
      startTrip(shop.id);
      haptics.success();
      setTripOpen(false);
    },
    [startTrip]
  );

  const confirmClear = useCallback(() => {
    confirmDelete({
      title: 'Clear the list?',
      message: 'Everything comes off the list without being marked as bought. Anything you\u2019ve bought before, or recorded anything about, stays in your grocery catalog. Names you only typed for this list are removed.',
      confirmLabel: 'Clear',
      onConfirm: () => {
        animateLayout();
        clearList();
        haptics.warning();
        setCartOpen(false);
      },
    });
  }, [clearList]);

  // "Get groceries at X" — a real Task, so it can carry its own reminder and
  // show up on Today, with linkUrl set to the same dundundun://groceries
  // scheme a recurring "Grocery run" task already uses. One task per store:
  // two stops are two errands, separately schedulable and separately
  // completable, which one title can't be.
  const createGroceryTasks = useCallback(
    (chosen: Shop[]) => {
      if (chosen.length === 0) {
        addTask({ title: 'Get groceries', linkUrl: GROCERIES_LINK_URL });
      } else {
        for (const shop of chosen) {
          addTask({ title: `Get groceries at ${shop.name}`, linkUrl: GROCERIES_LINK_URL });
        }
      }
      haptics.success();
      setTripOpen(false);
    },
    [addTask]
  );

  const actions = useMemo<ScreenHeaderAction[]>(() => {
    // Clear list is deliberately NOT here. It's destructive-looking, rarely
    // used, and the header is where you're tapping one-handed while walking —
    // it lives at the foot of the list instead, which is where you look when
    // you're done rather than mid-shop.
    const list: ScreenHeaderAction[] = [];
    list.push({
      icon: 'basket-outline',
      onPress: () => setCatalogOpen(true),
      disabled: selectionMode,
      accessibilityLabel: 'Browse your grocery catalog',
    });
    list.push({
      icon: 'options-outline',
      onPress: () => setAislesOpen(true),
      disabled: selectionMode,
      accessibilityLabel: 'List settings: aisles, stores, and grouping',
    });
    list.push({
      icon: copied ? 'checkmark' : 'copy-outline',
      onPress: () => copy(copyText),
      disabled: selectionMode || !copyText,
      accessibilityLabel: 'Copy the list as plain text',
    });
    list.push({
      icon: 'share-outline',
      onPress: handleShare,
      disabled: selectionMode || !shareText,
      accessibilityLabel: 'Share the list',
    });
    // Finishing the shop is deliberately not here. It was the sixth icon in
    // this row, badged with the cart count, and it's the one action every shop
    // ends in — a small target behind a non-obvious glyph is the wrong home
    // for that. It lives on whichever card is above the list instead:
    // `ActiveTripBanner` during a trip, `StartTripPrompt` when rows have been
    // ticked without one. Both put it where the cart count already is.
    return list;
  }, [selectionMode, handleShare, shareText, copied, copy, copyText]);

  // Bottom-up: "Add an item" ends up closest to the button. The recipe entry
  // no longer needs a key by itself — a saved recipe imports nothing over the
  // network — so it's gated on having *either* a saved recipe or a key to
  // import a new one with; a user with neither gets a two-item menu.
  const addMenuItems = useMemo<FabMenuItem[]>(() => {
    const list: FabMenuItem[] = [];
    if (recipes.length > 0 || anthropicApiKey) {
      list.push({ key: 'recipe', label: 'From a recipe', icon: 'restaurant-outline' });
    }
    // In the add menu rather than the header. The header is already five
    // actions wide, and this is an add: it's the one entry point that has to
    // work with an empty list, since unpacking a shop you never wrote down is
    // exactly the case it's for. Gone in simplified mode, which takes the
    // scanner with it.
    if (!featureHidden('barcodeScanning', simpleMode)) {
      list.push({ key: 'scan', label: 'Scan barcodes', icon: 'barcode-outline' });
    }
    list.push({ key: 'item', label: 'Add an item', icon: 'add-circle-outline' });
    return list;
  }, [recipes.length, anthropicApiKey, simpleMode]);

  const handleAddMenuSelect = useCallback((key: string) => {
    if (key === 'recipe') {
      // Only one way in skips the chooser and goes straight there — there'd
      // be nothing left to choose between.
      if (recipes.length === 0 && anthropicApiKey) setAiMode('recipe');
      else if (recipes.length === 1 && !anthropicApiKey) setRecipeToAdd(recipes[0]);
      else setRecipeSourceOpen(true);
    }
    else if (key === 'scan') setScanOpen(true);
    else setAddOpen(true);
  }, [recipes, anthropicApiKey]);

  const renderRow = useCallback(
    ({ item: row, drag, isActive }: { item: ListRow; drag?: () => void; isActive?: boolean }) => {
      // Every row doubles as a target for the add button being dragged in. The
      // wrapper only measures — no styling, no touches claimed — so a row
      // behaves exactly as it did without one, and the dragged row's floating
      // copy registers nothing (a null zone) rather than claiming the real
      // row's slot under the same key.
      const withZone = (content: React.ReactNode) => (
        <FabDropZone zone={isActive ? null : zoneByKey.get(row.key) ?? null}>{content}</FabDropZone>
      );
      if (row.type === 'aisle') {
        return withZone(
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{row.aisle}</Text>
          </View>
        );
      }
      if (row.type === 'recipeHeader') {
        return withZone(
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{row.label}</Text>
          </View>
        );
      }
      if (row.type === 'unavailableHeader') {
        // Same treatment as the aisle header above it, not a dimmer one —
        // every section header in this app reads the same way (see
        // CLAUDE.md's design-system note), so what tells this apart from a
        // new aisle is the wording and the count, the same way "In cart (N)"
        // already reads as a different kind of group without a style of its
        // own. Not a button: unlike the cart, there's nothing to expand —
        // hiding "not here" behind a tap would defeat the reason it exists,
        // which is being visible while you're still standing in the aisle.
        return withZone(
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Not here ({row.count})</Text>
          </View>
        );
      }
      if (row.type === 'cartHeader') {
        return withZone(
          <TouchableOpacity
            style={styles.cartHeader}
            activeOpacity={interaction.activeOpacity}
            onPress={() => {
              haptics.tap();
              animateLayout();
              setCartOpen(o => !o);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: cartOpen }}
            accessibilityLabel={`In cart, ${row.count} ${row.count === 1 ? 'item' : 'items'}`}
          >
            <Text style={styles.sectionTitle}>In cart ({row.count})</Text>
            <Ionicons
              name={cartOpen ? 'chevron-up' : 'chevron-down'}
              size={iconSize.sm}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
        );
      }
      return withZone(
        <GroceryRow
          item={row.item}
          onToggle={handleToggle}
          onEdit={handleEdit}
          onOpenSubstitutes={handleOpenSubstitutes}
          // Nothing in the cart is draggable: that section is a record of the
          // trolley, not a place to file something (see groceryDragRange). A
          // "Not here" row is the same call for the same reason — its
          // position is a fact about this trip, not something to manually
          // rearrange. Reordering is off while selecting too — the long
          // press that would start a drag is how a mis-tapped row gets
          // selected instead. And off while grouped by recipe: a drag
          // reorders within an aisle or moves a row to another one (see
          // resolveGroceryDrop), neither of which recipe grouping has a
          // section to receive.
          drag={selectionMode || row.inCart || row.unavailableHere || grouped.kind === 'recipe' ? undefined : drag}
          isActive={isActive}
          selectionMode={selectionMode}
          selected={selectedIds.has(row.item.id)}
          onSelect={toggleSelection}
          onSwipeSelect={id => enterSelectionMode(id)}
          alternatives={alternativeCaptionById.get(row.item.id)}
          stockedFor={stockedForById.get(row.item.id)}
          product={preferredProductById.get(row.item.id)}
          storeMarker={storeMarkers.get(row.item.id)?.text}
          swapSubstituteId={storeMarkers.get(row.item.id)?.substituteId}
          onSwapForSubstitute={handleSwapForSubstitute}
          tripPriceMinor={tripPriceById.get(row.item.id)?.minor}
          tripPriceRecorded={tripPriceById.get(row.item.id)?.recorded}
          onSetTripPrice={tripPriceById.has(row.item.id) ? handleSetTripPrice : undefined}
        />
      );
    },
    [styles, colors, cartOpen, handleToggle, handleEdit, handleOpenSubstitutes, handleSwapForSubstitute, zoneByKey, selectionMode, selectedIds, toggleSelection, enterSelectionMode, alternativeCaptionById, stockedForById, storeMarkers, tripPriceById, handleSetTripPrice]
  );

  // The "Start shopping" card, mounted either as the list's header or as a
  // sibling above it depending on whether the trolley has anything in it —
  // see both call sites below. Hidden while selecting and while a trip is
  // running, the same two conditions every header action and the trip banner
  // already answer to.
  const startCard =
    selectionMode || activeTripShop || featureHidden('shoppingTrips', simpleMode) ? null : (
      <StartTripPrompt
        // No stores offered on an away list, which leaves the card as the
        // Finish button alone — the shape it already takes for anyone with no
        // stores on file. Every store you have on record is one near home, so
        // "Start shopping at Safeway" in a rental kitchen names the wrong
        // building, and a trip's whole output (which store stocks what, and the
        // row captions saying so) is a record an away trip doesn't keep.
        suggestable={away ? [] : suggestableShops}
        onOpenSheet={() => setTripOpen(true)}
        checkedCount={checkedCount}
        onFinish={() => setFinishOpen(true)}
      />
    );

  // ==== render. Everything below is JSX ====
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        // The title *is* the list you're looking at, which is why it opens the
        // picker rather than a header icon doing it: with one list it reads
        // exactly as it always did ("Groceries"), and with two it is the one
        // place on screen that answers "which list am I adding to".
        title={activeListName}
        onTitlePress={() => { haptics.tap(); setListSheetOpen(true); }}
        titleAccessibilityLabel={`${activeListName}. Switch shopping list`}
        // The mode label goes in the overline rather than the subtitle, and
        // that placement is load-bearing rather than taste: the subtitle is one
        // reserved line, and "Away list. Purchases aren't recorded." wraps to
        // two at 390pt — which makes the header a line taller on an away list
        // than at home and shunts the hub pills down with it, the exact
        // inconsistency ScreenHeader reserves both lines to prevent. The
        // overline is already reserved and unused here, so this costs no
        // height at all, and it keeps the counts on their own line.
        //
        // What being on one *means* is said where there's room to say it: the
        // switcher's hint, and the finish sheet's intro at the moment it
        // actually matters.
        overline={away ? 'Away list' : undefined}
        subtitle={
          listCount > 0
            ? [
                `${remaining} left`,
                checkedCount > 0 ? `${checkedCount} in cart` : null,
                // Absent until something on the list has ever been priced, so
                // the header reads exactly as it did for anyone not using this.
                estimate,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        actions={actions}
      />
      <GroceriesHubPills active="Groceries" />
      <TipHost screen="groceries" />
      {/* A sibling of the list, not its header: the one thing on screen saying
          why rows have started naming other stores has to still be there when
          you're looking at such a row, and a way out of a mode shouldn't have
          to be scrolled back to. Hidden while selecting, like the card below
          and every header action. */}
      {/* A trip can outlive the switch being flipped, so a running one keeps its
          banner (and the way to finish it) however simple the mode is — the
          same call the focus-session header action makes. Only starting one
          goes, with `startCard` above. */}
      {!selectionMode && !!activeTripShop && (
        <ActiveTripBanner
          shopName={activeTripShop.name}
          onChange={() => setTripOpen(true)}
          onFinish={() => setFinishOpen(true)}
          onClear={handleClearTrip}
        />
      )}
      {/* The starting card scrolls with the list (see ListHeaderComponent
          below) right up until it grows a Finish button, and then it moves up
          here beside the trip banner for the banner's own reason: the action a
          shop ends in can't be something you have to scroll back to the top to
          find. One card and one set of props either way — only where it's
          mounted changes, on the tick that gives it something to do. */}
      {checkedCount > 0 && startCard}

      <FabDropZoneProvider
        ref={dropZonesRef}
        onIntentChange={fabIntentChannel.publish}
        scroller={scrollControl}
      >
      <ReorderableList
        data={rows}
        keyExtractor={row => row.key}
        renderItem={renderRow}
        // The user can't scroll during an add-button drag (the button's
        // responder has the touch); the drag scrolls it instead, through the
        // control below.
        scrollEnabled={!fabDragging}
        scrollControlRef={scrollControl}
        rowScrollerRef={rowScroller}
        // dragTick, not tap: a fast drag crosses several rows between frames
        // and unthrottled ticks run together into one long buzz. The lift
        // itself is fired by ReorderableList.
        onHoverChange={haptics.dragTick}
        dragRange={groceryDragRange}
        placeholderStyle={styles.dropSlot}
        onReorder={reordered => applyDrop(resolveGroceryDrop(reordered))}
        contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.list}
        // Scrolls with the rows rather than sitting above the list: it's worth
        // seeing when you open the screen and worth getting out of the way for
        // the rest of the shop. Inside the ScrollView is also the only place a
        // header can go here — see ReorderableList.ListHeaderComponent, where
        // one hung in the container silently offsets the drag math. Hidden
        // while selecting, like every header action is.
        // The banner replaces this outright once a trip is running: this card
        // is for deciding whether/where to go, and the banner says you've
        // gone. Two cards about one trip would be the "two controls for one
        // plan" StartTripPrompt's own note warns about.
        //
        // Always StartTripPrompt, never the coverage-scored card it used to
        // race with — #1662. That card announced "Likely has 2/3 items on
        // your list" as permanent screen furniture on every visit, most of
        // which are checking off items or browsing recipes, not deciding
        // where to shop. The same coverage reasoning still exists — it's
        // what ShoppingTripSheet pre-selects and captions with once you've
        // actually said you're about to shop, via `summarizeTrip` and
        // `describeShopCoverage` (shoppingTrip.ts) — it's just not announced
        // unprompted at the top of the list any more.
        //
        // Only while the trolley is empty: with anything ticked the same card
        // is rendered as a sibling above instead (see there).
        ListHeaderComponent={checkedCount > 0 ? null : startCard}
        // Nothing in the footer applies to an empty list, and the tab-bar
        // spacer would take its height off the box the empty state centres in
        // (the empty state clears the tab bar itself, via bottomOffset).
        ListFooterComponent={
          rows.length === 0 ? null : selectionMode ? (
            <View style={{ height: selectionListPadding }} />
          ) : (
          <View>
            {aisleSortRoute !== 'unavailable' && unsortedCount > 0 && (
              <View style={styles.clearWrap}>
                <InlineAction
                  label={`Sort ${unsortedCount} into aisles`}
                  icon="sparkles-outline"
                  tint={colors.purple}
                  onPress={() => setAiMode('tidy')}
                />
              </View>
            )}
            {/* At the foot of the list for the same reason Clear is: you
                reach for it when you're done, not mid-shop. Gated on there
                being *some* read available: with an API key the model reads the
                paper, and without one Vision still reads it on device. With
                neither, the button would open a sheet that can only
                apologise. */}
            {receiptRoute !== 'unavailable' && listCount > 0 && !featureHidden('receiptImport', simpleMode) && (
              <View style={styles.clearWrap}>
                <InlineAction
                  label="Scan a receipt"
                  icon="receipt-outline"
                  onPress={() => setReceiptOpen(true)}
                />
              </View>
            )}
            {listCount > 0 && (
              <View style={styles.clearWrap}>
                <InlineAction
                  label="Clear the list"
                  icon="trash-outline"
                  variant="neutral"
                  onPress={confirmClear}
                  style={styles.clearButton}
                />
              </View>
            )}
            <View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />
          </View>
          )
        }
        ListEmptyComponent={
          <EmptyState
            icon="cart-outline"
            title="Nothing on the list"
            subtitle={
              catalogCount > 0
                ? 'Everything in your catalog is a tap away, or start typing and it’ll come up.'
                : 'Tap + to add what you need. Paste a whole list and each line becomes an item.'
            }
            actionLabel={catalogCount > 0 ? 'Browse catalog' : 'Add an item'}
            onAction={catalogCount > 0 ? () => setCatalogOpen(true) : () => setAddOpen(true)}
            bottomOffset={tabBarHeight}
          />
        }
      />
      </FabDropZoneProvider>

      {/* The bulk bar sits where the button does, and adding an item isn't
          something you're doing mid-selection anyway. */}
      {!selectionMode && (
        <AddGroceryFabWithDropLabel
          channel={fabIntentChannel}
          items={addMenuItems}
          onSelect={handleAddMenuSelect}
          bottom={insets.bottom + tabBarHeight + spacing.md}
          accessibilityLabel="Add groceries"
          drag={fabDrag}
          dragHint="Drag onto the list to add an item there, or back to the button to cancel"
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={selectableItemIds.length}
          category={{
            title: 'Move to Aisle',
            options: aisleOrder,
            onSet: handleBulkSetAisle,
            onCreate: name => addAisle(name),
            allowNone: false,
          }}
          actions={[
            {
              key: 'check',
              icon: allSelectedChecked ? 'ellipse-outline' : 'checkmark-circle',
              label: allSelectedChecked ? 'Uncheck' : 'Check',
              onPress: handleBulkCheck,
            },
            { key: 'remove', icon: 'remove-circle', label: 'Remove', onPress: handleBulkRemove },
          ]}
          onSelectAll={() => selectAll(selectableItemIds)}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <GroceryAddSheet
        visible={addOpen}
        onClose={closeAdd}
        seedAisle={addSeedAisle}
        onAdded={handleItemsAdded}
      />
      <GroceryCatalogSheet visible={catalogOpen} onClose={() => setCatalogOpen(false)} />
      <GroceryAislesSheet visible={aislesOpen} onClose={() => setAislesOpen(false)} />
      <GroceryListSheet visible={listSheetOpen} onClose={() => setListSheetOpen(false)} />

      <FinishShoppingSheet
        visible={finishOpen}
        checkedCount={checkedCount}
        leftover={leftover}
        purchased={purchased}
        away={away}
        seedShopId={receiptSeed?.shopId}
        seedPriceText={receiptSeed?.priceText}
        seedPurchasedAt={receiptSeed?.purchasedAt}
        seedStamp={receiptSeed?.stamp}
        // Gated for the reason the list's own button is: with neither a key
        // nor an on-device read, the action opens a sheet that can only
        // apologise.
        onScanReceipt={receiptRoute !== 'unavailable' && !featureHidden('receiptImport', simpleMode)
          ? () => setReceiptOpen(true)
          : undefined}
        onClose={() => {
          setFinishOpen(false);
          setReceiptSeed(null);
        }}
        onFinished={handleFinished}
      />
      <BarcodeScanSheet
        visible={scanOpen}
        context="shopping"
        onClose={() => setScanOpen(false)}
        onApply={handleScanApply}
      />

      {/* Rendered over the finish sheet rather than instead of it when that's
          where it was opened from — the two are siblings, and the finish
          sheet's own `visible` is left alone. */}
      <ReceiptImportSheet
        visible={receiptOpen}
        context="shopping"
        onClose={() => setReceiptOpen(false)}
        onApply={handleReceiptApply}
      />
      <ShoppingTripSheet
        visible={tripOpen}
        onClose={() => setTripOpen(false)}
        onCreate={createGroceryTasks}
        onStart={handleStartTrip}
        intent="start"
      />
      <SubstituteSheet
        visible={substitutesForId !== null}
        itemId={substitutesForId}
        onSwap={subId => {
          if (substitutesForId) handleSwapForSubstitute(substitutesForId, subId);
        }}
        onClose={() => setSubstitutesForId(null)}
      />
      <GroceryItemSheet
        visible={editingId !== null}
        itemId={editingId}
        onClose={() => setEditingId(null)}
        onOpenRecipe={recipeId => {
          setEditingId(null);
          openRecipe(recipeId);
        }}
        recipeExists={recipeId => recipeIds.has(recipeId)}
      />
      <GroceryAISheet
        visible={aiMode !== null}
        mode={aiMode ?? 'tidy'}
        onClose={() => setAiMode(null)}
      />
      <RecipeSourceSheet
        visible={recipeSourceOpen}
        allowAIImport={!!anthropicApiKey}
        onPickSaved={recipe => {
          setRecipeSourceOpen(false);
          setRecipeToAdd(recipe);
        }}
        onImportWithAI={() => {
          setRecipeSourceOpen(false);
          setAiMode('recipe');
        }}
        onClose={() => setRecipeSourceOpen(false)}
      />
      <RecipeToListSheet
        visible={recipeToAdd !== null}
        recipe={recipeToAdd}
        onClose={() => setRecipeToAdd(null)}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    list: {
      flexGrow: 1,
      paddingTop: spacing.xs,
    },
    // Full height, and none of the list's padding, so the empty state's
    // `flex: 1` centres on the same line it does everywhere else.
    emptyContainer: { flexGrow: 1 },
    dropSlot: {
      // Matches GroceryRow's own card geometry, so the gap that opens is
      // exactly the shape of the row about to land in it.
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      backgroundColor: colors.bgSecondary,
      opacity: 0.55,
    },
    sectionHeader: {
      paddingHorizontal: spacing.md + spacing.xs,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    cartHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md + spacing.xs,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    clearWrap: {
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    // Same fix as FinishShoppingSheet's "New store" pill: this sits directly
    // on the screen's root colors.bg rather than a card, where the default
    // neutral tint (bgTertiary) is nearly indistinguishable from it.
    clearButton: { backgroundColor: colors.bgSecondary },
    sectionTitle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
  });
}
