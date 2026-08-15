import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
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
import { BuyAgainSheet } from '../components/BuyAgainSheet';
import { PantrySheet } from '../components/PantrySheet';
import { GroceryItemSheet } from '../components/GroceryItemSheet';
import { GroceryAislesSheet } from '../components/GroceryAislesSheet';
import { FinishShoppingSheet } from '../components/FinishShoppingSheet';
import { ShoppingTripSheet } from '../components/ShoppingTripSheet';
import { StartTripPrompt } from '../components/StartTripPrompt';
import { ActiveTripBanner } from '../components/ActiveTripBanner';
import {
  describeGroupedUnavailable,
  describeTripMarker,
  resolveActiveTrip,
  tripMarkerFor,
} from '../utils/activeTrip';
import { InlineAction } from '../components/InlineAction';
import { ListBulkBar } from '../components/ListBulkBar';
import { ReorderableList } from '../components/ReorderableList';
import { useRowSelection } from '../hooks/useRowSelection';
import { GroceryAISheet, type GroceryAIMode } from '../components/GroceryAISheet';
import { RecipeSourceSheet } from '../components/RecipeSourceSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { OTHER_AISLE } from '../utils/groceryAisles';
import { describeListEstimate, estimateListTotal } from '../utils/groceryPrice';
import { useGroceryStore } from '../store/useGroceryStore';
import { useTaskStore } from '../store/useTaskStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { alternativeCaptions } from '../utils/recipeComponents';
import { buildGrocerySections } from '../utils/grocerySuggest';
import { resolveGroceryDrop, groceryDragRange, placeNewGroceryItems } from '../utils/groceryReorder';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { KNOWN_LINK_APPS } from '../constants/linkApps';
import type { GroceryItem, Recipe, Shop } from '../types';

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
 */
type ListRow =
  | { type: 'aisle'; key: string; aisle: string }
  | { type: 'unavailableHeader'; key: string; aisle: string; count: number }
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
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const cartHoldIds = useGroceryStore(useShallow(s => s.cartHoldIds));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const toggleChecked = useGroceryStore(s => s.toggleChecked);
  const setCheckedMany = useGroceryStore(s => s.setCheckedMany);
  const setAisleMany = useGroceryStore(s => s.setAisleMany);
  const addAisle = useGroceryStore(s => s.addAisle);
  const removeFromListMany = useGroceryStore(s => s.removeFromListMany);
  const finishShopping = useGroceryStore(s => s.finishShopping);
  const markItemsUnavailable = useGroceryStore(s => s.markItemsUnavailable);
  const linkItemSub = useGroceryStore(s => s.linkItemSub);
  const swapForSubstitute = useGroceryStore(s => s.swapForSubstitute);
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

  const [cartOpen, setCartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [buyAgainOpen, setBuyAgainOpen] = useState(false);
  const [pantryOpen, setPantryOpen] = useState(false);
  const [aislesOpen, setAislesOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which field the item sheet should open pre-expanded to — the swap glyph's
  // whole point is skipping the ellipsis-then-scroll-to-Substitutes path an
  // ordinary open leaves at null.
  const [editingInitialField, setEditingInitialField] = useState<
    'aisle' | 'stores' | 'pantry' | 'useBy' | 'substitutes' | null
  >(null);
  const [aiMode, setAiMode] = useState<GroceryAIMode | null>(null);
  const [recipeSourceOpen, setRecipeSourceOpen] = useState(false);
  const [recipeToAdd, setRecipeToAdd] = useState<Recipe | null>(null);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  // sourceRecipeId is a snapshot pointer and doesn't cascade, so a row can
  // outlive the recipe that put it there. The set is what decides whether the
  // row gets a button at all — see GroceryRow.onOpenRecipe.
  const recipeIds = useMemo(() => new Set(recipes.map(r => r.id)), [recipes]);
  // "or pears", per row. Only what's still on the list counts as a live option
  // — an off-list catalog row that once shared the group is history — and
  // alternativeCaptions drops a group that's down to one, so a resolved pair
  // stops captioning itself with no extra bookkeeping. Shared with the recipe
  // screen's either/or ingredients: it's the same rule, and writing it twice is
  // how the two would drift.
  const alternativeCaptionById = useMemo(
    () => alternativeCaptions(items.filter(i => i.onList && i.choiceGroup)),
    [items]
  );
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
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);

  const { sections, inCart, remaining } = useMemo(
    () => buildGrocerySections(items, aisleOrder, cartHoldIds),
    [items, aisleOrder, cartHoldIds]
  );

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
  // A trip can outlive the moment it was last rendered, and activeTripShop
  // can't notice on its own — its inputs haven't changed. Clearing the store
  // fields is what makes an expired trip disappear rather than merely stop
  // resolving. Focus rather than mount: this screen stays mounted behind a tab.
  useFocusEffect(
    useCallback(() => {
      checkTripExpiry();
    }, [checkTripExpiry])
  );

  // The persistent trip bar's "Finish" tap (openFinishShoppingFromTripBar in
  // navigationRef.ts) — this screen may not even be mounted when it's tapped,
  // so the handoff is a stamped route param rather than a direct call, same
  // shape Today's openQuickAdd shortcut uses. Guarded on selectionMode for the
  // same reason the header's own Finish icon is disabled during it.
  const [handledOpenFinish, setHandledOpenFinish] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openFinish === undefined || route.params.openFinish === handledOpenFinish) return;
    setHandledOpenFinish(route.params.openFinish);
    if (!selectionMode) setFinishOpen(true);
  }, [route.params?.openFinish, handledOpenFinish, selectionMode]);

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
  const storeMarkers = useMemo(() => {
    const out = new Map<string, { text: string; substituteId?: string; unavailable: boolean }>();
    if (!activeTripShop) return out;
    for (const item of items) {
      if (!item.onList) continue;
      const marker = tripMarkerFor(item, itemShops, shops, activeTripShop, itemSubs, items);
      if (!marker) continue;
      const unavailable = marker.kind === 'unavailable';
      out.set(item.id, {
        text: unavailable ? describeGroupedUnavailable(marker) : describeTripMarker(marker),
        substituteId: marker.substitute?.id,
        unavailable,
      });
    }
    return out;
  }, [activeTripShop, items, itemShops, shops, itemSubs]);

  const checkedCount = useMemo(() => items.filter(i => i.onList && i.checked).length, [items]);
  // What the trip is about to leave behind, in the walk order the list is in —
  // the finish sheet asks about these, and only these. Ids and names only: the
  // sheet has no business holding rows it can't edit.
  const leftover = useMemo(
    () =>
      sections.flatMap(section =>
        section.data.filter(i => !i.checked).map(i => ({ id: i.id, name: i.name }))
      ),
    [sections]
  );
  // The other half of the same read: what the trip is taking home, in the same
  // walk order, for the finish sheet's price fields. Carries quantity because a
  // price is only meaningful next to what it bought.
  const purchased = useMemo(
    () =>
      sections.flatMap(section =>
        section.data
          .filter(i => i.checked)
          .map(i => ({ id: i.id, name: i.name, quantity: i.quantity }))
      ),
    [sections]
  );
  // "≈ $47.30 · 9 of 14 priced", or null while nothing on the list has a price.
  // describeListEstimate owns the wording, including the rule that a partial
  // total may never be rendered without saying how partial it is.
  const estimate = useMemo(
    () => describeListEstimate(estimateListTotal(items), currencySymbol),
    [items, currencySymbol]
  );
  const listCount = remaining + checkedCount;
  const catalogCount = items.length;
  // Only worth offering when the lexicon actually left a gap.
  const unsortedCount = useMemo(
    () => items.filter(i => i.onList && i.aisle === OTHER_AISLE).length,
    [items]
  );

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    for (const section of sections) {
      out.push({ type: 'aisle', key: `aisle:${section.aisle}`, aisle: section.aisle });
      // Held back rather than pushed in place, so the aisle's own roster
      // stays first and the "Not here" group — if this trip's store leaves
      // anything out of it — reads as a footnote to that roster, not a
      // second aisle. Order within each bucket is still the aisle's own
      // sortOrder walk, just split rather than reordered.
      const notHere: GroceryItem[] = [];
      for (const item of section.data) {
        if (storeMarkers.get(item.id)?.unavailable) {
          notHere.push(item);
          continue;
        }
        out.push({ type: 'item', key: item.id, item, inCart: false, unavailableHere: false });
      }
      if (notHere.length > 0) {
        out.push({
          type: 'unavailableHeader',
          key: `unavailable:${section.aisle}`,
          aisle: section.aisle,
          count: notHere.length,
        });
        for (const item of notHere) {
          out.push({ type: 'item', key: item.id, item, inCart: false, unavailableHere: true });
        }
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
  }, [sections, inCart, cartOpen, storeMarkers]);

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
    const aislesFor = categoriesByIndex(rows.map(r => (r.type === 'aisle' ? r.aisle : null)));
    const map = new Map<string, DropZone>();
    rows.forEach((row, i) => {
      if (row.type === 'aisle') {
        map.set(row.key, { kind: 'header', key: row.key, category: row.aisle });
      } else if (row.type === 'cartHeader' || row.type === 'unavailableHeader' || row.inCart || row.unavailableHere) {
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
  }, [rows]);

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
    setEditingInitialField(null);
    setEditingId(id);
  }, []);

  const handleOpenSubstitutes = useCallback((id: string) => {
    haptics.tap();
    setEditingInitialField('substitutes');
    setEditingId(id);
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
  // way LogbookBulkBar's incomplete action always means the opposite of what's
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
  // selection in Buy again. This screen is the shopping list, where the answer
  // to "I don't want this here" is Remove.

  // The confirm is a sheet rather than an Alert because it now carries a store
  // picker, and an Alert can't hold one. It's still a confirm: nothing is
  // recorded until Finish.
  const handleFinished = useCallback(
    (
      shopId: string | null,
      unavailableIds: string[],
      priceById: Record<string, number>,
      substitutes: Array<{ itemId: string; subItemId: string }>
    ) => {
      setFinishOpen(false);
      animateLayout();
      // Three writes rather than one, and they can't collide: finishShopping
      // only touches what was ticked into the trolley, and these are precisely
      // what wasn't. The claims go first so they're recorded even if the trip
      // itself finds nothing left to record. A substitute answer is only ever
      // about a row that was just marked unavailable, so it follows that claim
      // rather than racing it.
      if (shopId && unavailableIds.length > 0) markItemsUnavailable(unavailableIds, shopId);
      for (const { itemId, subItemId } of substitutes) linkItemSub(itemId, subItemId);
      // The prices ride with the trip rather than being a fourth write: they're
      // about what it bought, so they have to land on the same rows in the same
      // pass that takes them off the list.
      if (finishShopping(shopId, priceById) > 0) haptics.success();
      // Unconditional, and deliberately not inside finishShopping: that
      // early-returns on an empty trolley, and finishing a shop you bought
      // nothing at still ends the trip you were on.
      endTrip();
      setCartOpen(false);
    },
    [finishShopping, markItemsUnavailable, linkItemSub, endTrip]
  );

  const handleClearTrip = useCallback(() => {
    animateLayout();
    endTrip();
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
    Alert.alert(
      'Clear the list?',
      'Everything comes off the list without being marked as bought. Items already in your catalog stay there; items typed just for this list are removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            clearList();
            haptics.warning();
            setCartOpen(false);
          },
        },
      ]
    );
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

  const handleCreateGroceryTask = useCallback(() => {
    // With no suggestable stores configured there's nothing to pick between,
    // so the sheet would be a whole screen for a question with one answer —
    // that's the only case this skips straight to a plain task. One store is
    // still a real choice (plan a task for later, or say you're shopping
    // there right now), so the sheet has to open for it too: treated the
    // same as "none", nobody with a single default store could ever reach
    // "Start shopping at X" from here.
    if (suggestableShops.length === 0) {
      createGroceryTasks([]);
      return;
    }
    setTripOpen(true);
  }, [suggestableShops, createGroceryTasks]);

  const actions = useMemo<ScreenHeaderAction[]>(() => {
    // Clear list is deliberately NOT here. It's destructive-looking, rarely
    // used, and the header is where you're tapping one-handed while walking —
    // it lives at the foot of the list instead, which is where you look when
    // you're done rather than mid-shop.
    const list: ScreenHeaderAction[] = [];
    list.push({
      icon: 'basket-outline',
      onPress: () => setBuyAgainOpen(true),
      disabled: selectionMode,
      accessibilityLabel: 'Buy again',
    });
    // Beside Buy again, since both read the catalog rather than the list: one
    // is what to get, the other is what you already have.
    list.push({
      icon: 'file-tray-stacked-outline',
      onPress: () => setPantryOpen(true),
      disabled: selectionMode,
      accessibilityLabel: 'Pantry',
    });
    list.push({
      icon: 'walk-outline',
      onPress: handleCreateGroceryTask,
      disabled: selectionMode,
      accessibilityLabel: 'Shopping trip — plan for later or start one now',
    });
    list.push({
      icon: 'options-outline',
      onPress: () => setAislesOpen(true),
      disabled: selectionMode,
      accessibilityLabel: 'Aisle order',
    });
    list.push({
      icon: 'bag-check-outline',
      onPress: () => setFinishOpen(true),
      disabled: selectionMode || checkedCount === 0,
      badge: checkedCount || undefined,
      badgeColor: colors.accent,
      tint: 'accent',
      accessibilityLabel: 'Finish shopping',
    });
    return list;
  }, [checkedCount, selectionMode, handleCreateGroceryTask]);

  // Bottom-up: "Add an item" ends up closest to the button. The recipe entry
  // no longer needs a key by itself — a saved recipe imports nothing over the
  // network — so it's gated on having *either* a saved recipe or a key to
  // import a new one with; a user with neither gets a two-item menu.
  const addMenuItems = useMemo<FabMenuItem[]>(() => {
    const list: FabMenuItem[] = [];
    if (recipes.length > 0 || anthropicApiKey) {
      list.push({ key: 'recipe', label: 'From a recipe', icon: 'restaurant-outline' });
    }
    list.push({ key: 'buyAgain', label: 'Buy again', icon: 'basket-outline' });
    list.push({ key: 'item', label: 'Add an item', icon: 'add-circle-outline' });
    return list;
  }, [recipes.length, anthropicApiKey]);

  const handleAddMenuSelect = useCallback((key: string) => {
    if (key === 'recipe') {
      // Only one way in skips the chooser and goes straight there — there'd
      // be nothing left to choose between.
      if (recipes.length === 0 && anthropicApiKey) setAiMode('recipe');
      else if (recipes.length === 1 && !anthropicApiKey) setRecipeToAdd(recipes[0]);
      else setRecipeSourceOpen(true);
    }
    else if (key === 'buyAgain') setBuyAgainOpen(true);
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
          // selected instead.
          drag={selectionMode || row.inCart || row.unavailableHere ? undefined : drag}
          isActive={isActive}
          selectionMode={selectionMode}
          selected={selectedIds.has(row.item.id)}
          onSelect={toggleSelection}
          onSwipeSelect={id => enterSelectionMode(id)}
          onOpenRecipe={
            row.item.sourceRecipeId && recipeIds.has(row.item.sourceRecipeId)
              ? openRecipe
              : undefined
          }
          alternatives={alternativeCaptionById.get(row.item.id)}
          storeMarker={storeMarkers.get(row.item.id)?.text}
          swapSubstituteId={storeMarkers.get(row.item.id)?.substituteId}
          onSwapForSubstitute={handleSwapForSubstitute}
        />
      );
    },
    [styles, colors, cartOpen, handleToggle, handleEdit, handleOpenSubstitutes, handleSwapForSubstitute, zoneByKey, selectionMode, selectedIds, toggleSelection, enterSelectionMode, recipeIds, openRecipe, alternativeCaptionById, storeMarkers]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Groceries"
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
      {/* A sibling of the list, not its header: the one thing on screen saying
          why rows have started naming other stores has to still be there when
          you're looking at such a row, and a way out of a mode shouldn't have
          to be scrolled back to. Hidden while selecting, like the card below
          and every header action. */}
      {!selectionMode && !!activeTripShop && (
        <ActiveTripBanner
          shopName={activeTripShop.name}
          onChange={() => setTripOpen(true)}
          onFinish={() => setFinishOpen(true)}
          onClear={handleClearTrip}
        />
      )}

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
        // The banner replaces it outright once a trip is running: the prompt
        // below is for deciding whether/where to go, and the banner says
        // you've gone. Two cards about one trip would be the "two controls
        // for one plan" ShoppingTripSheet's own note warns about.
        //
        // Deliberately quiet rather than pre-justified with coverage data
        // (#1662) — a store-by-store "likely has 2/3 items" read used to sit
        // here on every single visit, which is screen furniture on the far
        // more common visits that aren't "where do I shop this". The fuller
        // reasoning still exists; it's the sheet's own suggestion card, opened
        // by tapping this exact same prompt.
        ListHeaderComponent={
          selectionMode || activeTripShop ? null : (
            <StartTripPrompt
              suggestable={suggestableShops}
              onStart={handleStartTrip}
              onOpenSheet={() => setTripOpen(true)}
            />
          )
        }
        // Nothing in the footer applies to an empty list, and the tab-bar
        // spacer would take its height off the box the empty state centres in
        // (the empty state clears the tab bar itself, via bottomOffset).
        ListFooterComponent={
          rows.length === 0 ? null : selectionMode ? (
            <View style={{ height: selectionListPadding }} />
          ) : (
          <View>
            {!!anthropicApiKey && unsortedCount > 0 && (
              <View style={styles.clearWrap}>
                <InlineAction
                  label={`Sort ${unsortedCount} into aisles`}
                  icon="sparkles-outline"
                  tint={colors.purple}
                  onPress={() => setAiMode('tidy')}
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
                ? 'Everything you’ve bought before is a tap away, or start typing and it’ll come up.'
                : 'Tap + to add what you need. Paste a whole list and each line becomes an item.'
            }
            actionLabel={catalogCount > 0 ? 'Buy again' : 'Add an item'}
            onAction={catalogCount > 0 ? () => setBuyAgainOpen(true) : () => setAddOpen(true)}
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
      <BuyAgainSheet visible={buyAgainOpen} onClose={() => setBuyAgainOpen(false)} />
      <PantrySheet visible={pantryOpen} onClose={() => setPantryOpen(false)} />
      <GroceryAislesSheet visible={aislesOpen} onClose={() => setAislesOpen(false)} />
      <FinishShoppingSheet
        visible={finishOpen}
        checkedCount={checkedCount}
        leftover={leftover}
        purchased={purchased}
        onClose={() => setFinishOpen(false)}
        onFinished={handleFinished}
      />
      <ShoppingTripSheet
        visible={tripOpen}
        onClose={() => setTripOpen(false)}
        onCreate={createGroceryTasks}
        onStart={handleStartTrip}
      />
      <GroceryItemSheet
        visible={editingId !== null}
        itemId={editingId}
        initialField={editingInitialField ?? undefined}
        onClose={() => {
          setEditingId(null);
          setEditingInitialField(null);
        }}
        onOpenRecipe={recipeId => {
          setEditingId(null);
          setEditingInitialField(null);
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
