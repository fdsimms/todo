// The Pantry screen: what the app thinks is in the kitchen, sorted by
// freshness, with one field that finds and adds, a chip on each row that marks it,
// drag between freezer, fridge and aisles, recipes for what's about to go, and
// scans that fill it (see the note above the component). One component of
// ~870 lines, so grep a landmark:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
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
import { listedAnywhere } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAiRoute } from '../hooks/useOnDeviceAi';
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
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { ReorderableList } from '../components/ReorderableList';
import { HubPills } from '../components/HubPills';
import { TipHost } from '../components/TipHost';
import { ActiveTripBanner } from '../components/ActiveTripBanner';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PressableScale } from '../components/PressableScale';
import { GroceryItemSheet, type CollapsibleFieldKey } from '../components/GroceryItemSheet';
import { navigateToFoodSearchSettings } from '../components/NutritionSearchSheet';
import { ItemDisposalOffer } from '../components/ItemDisposalOffer';
import { buildPantryReviewDeck } from '../utils/pantryReview';
import { PANTRY_REVIEW_TITLE, wantsPantryReview } from '../utils/pantryReviewTasks';
import { ProductRatingOffer } from '../components/ProductRatingOffer';
import { LeftoverSheet } from '../components/LeftoverSheet';
import { useSheetMount } from '../hooks/useSheetMount';
import { PantryReviewSheet } from '../components/PantryReviewSheet';
import { BarcodeScanSheet, type ScanProductDraft } from '../components/BarcodeScanSheet';
import { featureHidden } from '../utils/simpleMode';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { ReceiptImportSheet, type ReceiptAddDraft } from '../components/ReceiptImportSheet';
import { freshnessColor } from '../components/LeftoversCard';
import { useNowTick } from '../hooks/useNowTick';
import { haptics } from '../utils/haptics';
import { ActionMenu, type ActionMenuAction } from '../components/ActionMenu';
import type { CardAnchor } from '../components/CardSheet';
import { defaultOnHandUntil, isRunningLow } from '../utils/grocerySuggest';
import {
  PANTRY_CHIP_LABEL,
  pantryRowChip,
  pantryRowMarks,
  pantryRowMenu,
  type PantryRowAction,
  type PantryRowFacts,
} from '../utils/pantryRowMenu';
import { animateLayout } from '../utils/layoutAnimation';
import { resolveActiveTrip } from '../utils/activeTrip';
import { resetToGroceries } from '../navigation/navigationRef';
import { useFilterField } from '../hooks/useFilterField';
import { FieldClearButton } from '../components/FieldClearButton';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { isPortionBox } from '../types';
import { LazySheet } from '../components/LazySheet';
import { useFabBottom } from '../components/Fab';
import { useRowSelection } from '../hooks/useRowSelection';
import { PaintSelectionProvider, PaintSelectionRow } from '../components/PaintSelection';
import { ListBulkBar } from '../components/ListBulkBar';
import { SwipeableRow } from '../components/SwipeableRow';
import { SwipeActionButtons } from '../components/SwipeActionButtons';
import { SelectionDot } from '../components/SelectionDot';
import { applyPantryBulk, type PantryBulkAction } from '../utils/pantryBulk';

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
 * One of the Groceries/Recipes/Meal plan/Food log hub (`HubPills`),
 * rather than a sheet popped over Groceries — see that component's doc
 * comment for why it moved. Displayed as "Pantry" (`HubPills`'
 * label, and this screen's own `ScreenHeader` title) while the route, this
 * file and everything in `kitchenInventory.ts` keep the `Kitchen`/`kitchen*`
 * name — see `HubPills`' doc comment for why the two differ.
 *
 * **The corrections stay where the thing lives.** A catalog row's trailing
 * chip is the one this screen exists for most. It names the row's state
 * (`pantryRowChip`) and opens a menu (`pantryRowMenu`) whose entries each write
 * what `GroceryItemSheet`'s pill of the same name writes, so "Used it up" and
 * "Went bad" are `markOutOfMany`'s two outcomes chosen up front rather than
 * asked for afterwards. The row itself opens `GroceryItemSheet` with the
 * Pantry pills already showing (`initialField`) for anything past that.
 * **A container's chip says where it is** ("Fridge" or "Freezer"), and its
 * menu has "Finished it" and "Threw it out" as two entries the person picks,
 * because guessing "eaten" would quietly write a fridge-history row they never
 * chose. Its row still opens `LeftoverSheet` for anything past that.
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
 * one name or a whole session at a time (a scan also says the packet is new,
 * which clears the old one's freezer, opened and running-low claims — see
 * `addManyToPantry`'s `acquired`). They exist because that correction
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
 * finished trip's — names, what each cost, and which went straight in the
 * freezer — because it isn't a trip: no purchase count, no store stocking
 * claim, no purchase date (see `handleReceiptApply`).
 *
 * That keeps the model the one #1040 settled on — computed from what you buy,
 * corrected when it's wrong, never an inventory anybody has to keep up.
 * Quantities, per-row expiry editing and checking things back in are the
 * inventory, and stay out.
 */
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ROW_ACTION_ICON: Record<PantryRowAction, IconName> = {
  have: 'checkmark-circle-outline',
  low: 'trending-down-outline',
  clearLow: 'refresh-outline',
  usedUp: 'checkmark-done-outline',
  spoiled: 'trash-outline',
  boughtMore: 'add-circle-outline',
  opened: 'open-outline',
  unopened: 'close-circle-outline',
  freeze: 'snow-outline',
  thaw: 'sunny-outline',
  out: 'close-circle-outline',
  finished: 'checkmark-circle-outline',
  tossed: 'trash-bin-outline',
  split: 'git-branch-outline',
  edit: 'create-outline',
};

export function KitchenScreen() {
  // ==== layout, theme, settings and navigation ====
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const fabBottom = useFabBottom();
  const colors = useColors();
  // This screen's own settings, from a gear in its header. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('Kitchen', 'Pantry settings');
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  // ==== the grocery store ====
  const items = useGroceryStore(useShallow(s => s.items));
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const addToPantry = useGroceryStore(s => s.addToPantry);
  const addManyToPantry = useGroceryStore(s => s.addManyToPantry);
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);
  const setFrozen = useGroceryStore(s => s.setFrozen);
  const setOpened = useGroceryStore(s => s.setOpened);
  const setOnHandUntil = useGroceryStore(s => s.setOnHandUntil);
  const setRunningLow = useGroceryStore(s => s.setRunningLow);
  const setProductOpened = useGroceryStore(s => s.setProductOpened);
  const setGroceryLastAction = useGroceryStore(s => s.setLastAction);
  const setLeftoverLastAction = useLeftoverStore(s => s.setLastAction);
  const setAisle = useGroceryStore(s => s.setAisle);
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  // The frozen portions among the boxes (#2925). Their rows open the item's
  // Pantry field, where "Freeze some" and the portion's own line live, rather
  // than its Products field, which doesn't list them: a portion is some of the
  // item, not a brand of it. See ItemProduct.isPortion.
  const portionIds = useMemo(
    () => new Set(itemProducts.filter(p => isPortionBox(p)).map(p => p.id)),
    [itemProducts]
  );
  const listEntries = useGroceryStore(useShallow(s => s.listEntries));
  const markProductsOutOf = useGroceryStore(s => s.markProductsOutOf);
  const setProductFrozen = useGroceryStore(s => s.setProductFrozen);
  // The chip's menu. `facts` is read when it opens and kept, so a row that
  // changes under the card while it fades doesn't relabel the entries.
  const [rowMenu, setRowMenu] = useState<{
    entry: KitchenEntry;
    anchor: CardAnchor;
    facts: PantryRowFacts;
  } | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const tripShopId = useGroceryStore(s => s.tripShopId);
  // See GroceryScreen's note: the scanner asks the route, not the key.
  const receiptRoute = useAiRoute('receiptImport');
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

  // ==== recipes and leftovers ====
  const recipes = useRecipeStore(useShallow(s => s.recipes));

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const setLeftoverWeight = useLeftoverStore(s => s.setLeftoverWeight);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const setLeftoverFrozen = useLeftoverStore(s => s.setFrozen);
  const splitLeftover = useLeftoverStore(s => s.splitLeftover);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);

  // ==== local state (the field, sheets, scan, receipt, review) ====
  const { query, clear: clearQuery, props: filterField } = useFilterField();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // Which field the sheet opens on. Pantry for every row tap (see the sheet
  // below); the repeat-waste offer is the one thing that asks for another.
  const [openItemField, setOpenItemField] = useState<CollapsibleFieldKey>('pantry');
  const [openLeftoverId, setOpenLeftoverId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);

  // ==== what is in the kitchen (entries, sections, drag rows) ====
  // This screen never unmounts once visited (the drawer's tabs stay mounted
  // under `enableScreens(false)`), so a use-by day computed once at mount
  // would go stale the same way an unmemoized LeftoversCard row would — see
  // useNowTick's own doc comment (#1732).
  const nowMs = useNowTick();
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const entries = useMemo(
    // Every trolley for the "on the list" clause: a pantry row saying so has
    // no business caring which list. See kitchenInventory.
    () => kitchenInventory(items, leftovers, now, itemProducts, listedAnywhere(listEntries)),
    [items, leftovers, now, itemProducts, listEntries]
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

  // ==== bulk selection ====
  // A swipe on a row selects it, the way every other list's rows do, and the
  // bar acts on the lot at once: clearing out a fridge was two taps a row.
  // Containers are in it too, since that's half of what goes off.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    painting,
    paintProps,
  } = useRowSelection();
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const selectableIds = useMemo(
    () => rows.flatMap(r => (r.type === 'entry' ? [r.entry.id] : [])),
    [rows]
  );
  const runBulk = (action: PantryBulkAction) => {
    const chosen = entries.filter(e => selectedIds.has(e.id));
    animateLayout();
    const changed = applyPantryBulk(action, chosen);
    if (changed > 0) {
      if (action === 'usedUp' || action === 'spoiled') haptics.success();
      else haptics.tap();
    } else {
      haptics.warning();
    }
    exitSelection();
  };

  // ==== recipes for what is about to go ====
  // What to cook with what's dying. Off `useUpEntries` rather than the whole
  // kitchen, so this answers "what saves the spinach" and not "what could I
  // make for dinner" — the recipe list is already the second question.
  //
  // Hidden while the field has text: the field filters the list below to what
  // you're looking for, and a suggestion block that ignored the query would be
  // the one part of the screen not answering it.
  const suggestions = useMemo(
    () => (query ? [] : useUpRecipes(useUpEntries(entries), recipes, items)),
    [entries, recipes, items, query]
  );
  const shownSuggestions = useMemo(
    // Two, which is what fits above the fold without pushing the pantry itself
    // off screen. The block is an offer, not the content of the screen.
    () => suggestions.slice(0, 2),
    [suggestions]
  );

  // ==== the list header rows ====
  // Inside the list's header rather than fixed above it, so it scrolls away
  // with the content it's about. The screen already spends its fixed height on
  // the hub pills and the find-or-add field; two more permanent rows would push
  // the pantry itself off the first screen, which is the thing the user came
  // for.
  // The review deck, offered as a row once it's big enough to be worth a pass:
  // the header's own button is an unlabelled icon, and this is when it has
  // something to say. The threshold is the review task's (wantsPantryReview),
  // so the row and the task never disagree about whether there's a pass to do.
  const reviewDeck = useMemo(
    () => buildPantryReviewDeck(items, now, itemProducts),
    [items, now, itemProducts]
  );
  const reviewCount = !query && wantsPantryReview(reviewDeck) ? reviewDeck.cards.length : 0;
  const reviewRow = reviewCount === 0 ? null : (
    <View style={[styles.suggestWrap, shownSuggestions.length > 0 && styles.suggestWrapFollowed]}>
      <TouchableOpacity
        style={styles.suggestRow}
        activeOpacity={interaction.activeOpacity}
        onPress={() => { haptics.tap(); setReviewOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel={`${PANTRY_REVIEW_TITLE}. ${reviewCount} things to check, one at a time`}
      >
        <Ionicons name="albums-outline" size={iconSize.md} color={colors.accent} />
        <View style={styles.suggestBody}>
          <Text style={styles.suggestName} numberOfLines={1}>{PANTRY_REVIEW_TITLE}</Text>
          <Text style={styles.suggestMeta} numberOfLines={1}>{reviewCount} things to check, one at a time</Text>
        </View>
        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );

  const suggestionHeader = shownSuggestions.length === 0 ? null : (
    <View style={styles.suggestWrap}>
      <Text style={styles.sectionTitle}>Recipes for what’s expiring</Text>
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

  // ==== links in (an entry, the pantry review) ====
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
        setOpenItemField(portionIds.has(focused.sourceId) ? 'pantry' : 'products');
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
        setOpenItemField(isPortionBox(product) ? 'pantry' : 'products');
        setOpenItemId(product.itemId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntryId, focusStamp, handledFocusStamp]);

  // The other half of the kitchen link: "Review what's in the pantry" carries
  // `?review=1` (see pantryReviewTasks.PANTRY_REVIEW_LINK_URL) and lands here
  // with the deck up. Its own stamp rather than a share of focusStamp above —
  // the two arrive from different links and never together, and one flag
  // answering for both would make a bare use-up link that happened to follow a
  // review link reopen the deck.
  const reviewStamp: number | undefined = route.params?.openPantryReview;
  const [handledReviewStamp, setHandledReviewStamp] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (reviewStamp === undefined || reviewStamp === handledReviewStamp) return;
    setHandledReviewStamp(reviewStamp);
    setReviewOpen(true);
  }, [reviewStamp, handledReviewStamp]);

  // ==== find or add, and marking out ====
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
    clearQuery();
  };

  // What a row's chip says about its packet, read off the store row it was
  // built from.
  const rowFacts = (entry: KitchenEntry): PantryRowFacts | null => {
    if (entry.kind === 'leftover') {
      const leftover = leftovers.find(l => l.id === entry.sourceId);
      if (!leftover) return null;
      return { kind: 'leftover', portion: false, low: false, opened: false, frozen: !!leftover.frozenAt };
    }
    if (entry.kind === 'product') {
      const product = itemProducts.find(p => p.id === entry.sourceId);
      if (!product) return null;
      return {
        kind: 'product',
        portion: isPortionBox(product),
        low: false,
        opened: !!product.openedAt,
        frozen: !!product.frozenAt,
      };
    }
    const item = items.find(i => i.id === entry.sourceId);
    if (!item) return null;
    return {
      kind: 'grocery',
      portion: false,
      low: isRunningLow(item, new Date()),
      opened: !!item.openedAt,
      frozen: !!item.frozenAt,
    };
  };

  const openRowMenu = (entry: KitchenEntry, anchor: CardAnchor) => {
    const facts = rowFacts(entry);
    if (!facts) return;
    haptics.tap();
    setRowMenu({ entry, anchor, facts });
    setRowMenuOpen(true);
  };

  // Each action writes what the item sheet's pill of the same name writes.
  // A box's ✕ used to write the box and say nothing about its siblings, and
  // that holds for all of these: being out of the Beyond one is not being out
  // of vegan ground beef, and a box's own opened or frozen stamp is its own.
  // A portion's out deletes it (see `markProductsOutOf`).
  const applyRowAction = (entry: KitchenEntry, action: PantryRowAction) => {
    if (entry.kind === 'leftover') {
      // The container sheet's own actions, each chosen here on purpose.
      switch (action) {
        case 'finished': haptics.success(); finishLeftover(entry.sourceId, 'eaten'); break;
        case 'tossed': haptics.warning(); finishLeftover(entry.sourceId, 'tossed'); break;
        case 'freeze':
          setLeftoverFrozen(entry.sourceId, true);
          setLeftoverLastAction({
            label: `Froze “${entry.title}”`,
            undo: () => setLeftoverFrozen(entry.sourceId, false),
          });
          break;
        case 'thaw': setLeftoverFrozen(entry.sourceId, false); break;
        case 'split': splitLeftover(entry.sourceId); break;
        case 'edit': setOpenLeftoverId(entry.sourceId); break;
      }
      return;
    }
    if (entry.kind === 'product') {
      if (action === 'out') {
        if (markProductsOutOf([entry.sourceId]) > 0) haptics.success();
      } else if (action === 'opened' || action === 'unopened') {
        setProductOpened(entry.sourceId, action === 'opened');
        if (action === 'opened') {
          setGroceryLastAction({
            label: `Marked “${entry.title}” opened`,
            undo: () => setProductOpened(entry.sourceId, false),
          });
        }
      } else if (action === 'freeze' || action === 'thaw') {
        setProductFrozen(entry.sourceId, action === 'freeze');
        if (action === 'freeze') {
          setGroceryLastAction({
            label: `Froze “${entry.title}”`,
            undo: () => setProductFrozen(entry.sourceId, false),
          });
        }
      }
      return;
    }
    const item = items.find(i => i.id === entry.sourceId);
    if (!item) return;
    switch (action) {
      case 'have': {
        // Undo puts back what the row said before, which may have been an
        // earlier "Got it" rather than nothing.
        const before = item.onHandUntil;
        setOnHandUntil(item.id, defaultOnHandUntil(item, new Date()));
        setGroceryLastAction({
          label: `Marked “${item.name}” as on hand`,
          undo: () => setOnHandUntil(item.id, before),
        });
        break;
      }
      case 'low': setRunningLow(item.id, true); break;
      case 'clearLow': setRunningLow(item.id, false); break;
      case 'usedUp': if (markOutOfMany([item.id], 'usedUp') > 0) haptics.success(); break;
      case 'spoiled': if (markOutOfMany([item.id], 'spoiled') > 0) haptics.success(); break;
      // A new packet through the receipt's own path, so the old one's opened,
      // frozen and running low marks go and the list entry it made goes too.
      case 'boughtMore':
        if (addManyToPantry([item.name], undefined, undefined, undefined, { acquired: true }) > 0) haptics.success();
        break;
      // Undo is offered for the way in only. The way out (not opened, thawed)
      // has no stamp to restore, so the opposite entry is its undo.
      case 'opened':
        setOpened(item.id, true);
        setGroceryLastAction({
          label: `Marked “${item.name}” opened`,
          undo: () => setOpened(item.id, false),
        });
        break;
      case 'unopened': setOpened(item.id, false); break;
      case 'freeze':
        setFrozen(item.id, true);
        setGroceryLastAction({
          label: `Froze “${item.name}”`,
          undo: () => setFrozen(item.id, false),
        });
        break;
      case 'thaw': setFrozen(item.id, false); break;
    }
  };

  const rowMenuActions: ActionMenuAction[] = rowMenu
    ? pantryRowMenu(rowMenu.facts).map(e => ({
        key: e.key,
        label: e.label,
        icon: ROW_ACTION_ICON[e.key],
        onPress: () => applyRowAction(rowMenu.entry, e.key),
      }))
    : [];

  // ==== writing a drop ====
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

  // ==== barcode scan and receipt ====
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
  //
  // The shelf price read beside a barcode rides the same name-keyed map
  // handleReceiptApply below builds, and for the same reason (#2934): it was
  // shown on the scan row and then dropped here. Matched rows carry it in
  // `priceById`, drafts on `priceMinor`. It is filed against the store a
  // running trip names, or none: a scan doesn't say where the shelf was, and
  // `setItemPrice` records an item-level price when there is no store.
  const handleScanApply = (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[],
    priceById: Readonly<Record<string, number>>
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
      {
        brand: string | null;
        variant: string | null;
        gtin?: string | null;
        aisle?: string | null;
        nameFromScan?: boolean;
      }
    >();
    const noteScanned = (
      name: string,
      box: { brand: string | null; variant: string | null } | undefined,
      gtin: string | null,
      aisle?: string | null,
      nameFromScan?: boolean
    ) => {
      if (!box && !gtin && !aisle) return;
      productNames.set(name, {
        brand: box?.brand ?? null,
        variant: box?.variant ?? null,
        gtin,
        aisle,
        nameFromScan,
      });
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
      // A minted row's brand, and its variant when the name was shortened, same
      // as GroceryScreen's own scan handler.
      const box = matched ?? (draft.brand || draft.variant ? { brand: draft.brand, variant: draft.variant ?? null } : undefined);
      // Same restraint as the box: the source's category only applies to a row
      // this batch mints, matching GroceryScreen.handleScanApply's own
      // addByName(..., { aisle: draft.aisle }) call, which never touches an
      // already-matched item's filing either.
      // Same restraint again on the last argument: only a row this batch mints
      // can be wearing the source's words, and `addManyToPantry` checks that
      // for itself before it writes.
      noteScanned(
        draft.name,
        box,
        gtin,
        draft.existingItemId ? undefined : draft.aisle,
        draft.existingItemId ? undefined : draft.nameFromScan
      );
    }
    const priceByName = new Map<string, number>();
    for (const id of itemIds) {
      const name = items.find(i => i.id === id)?.name;
      const minor = priceById[id];
      if (name && minor !== undefined) priceByName.set(name, minor);
    }
    for (const draft of toAdd) {
      if (draft.priceMinor !== null) priceByName.set(draft.name, draft.priceMinor);
    }
    setScanOpen(false);
    if (names.length === 0) return;
    // `acquired`: a scanned bag is a new packet, so the old one's freezer,
    // opened and running-low claims go (see addManyToPantry).
    const prices = priceByName.size > 0
      ? { byName: priceByName, shopId: useGroceryStore.getState().activeShop()?.id ?? null }
      : undefined;
    if (addManyToPantry(names, frozenNames, productNames, prices, { acquired: true }) > 0) {
      haptics.success();
    }
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
   * What it does say is that these are new packets (`acquired`), so the old
   * one's freezer, opened and running-low claims don't carry over to them.
   *
   * The prices ride the same name-keyed map the freezer flag and the box do,
   * for the reason `addManyToPantry` gives — a row this batch mints has no id
   * until the loop creates it. What they record is deliberately smaller than a
   * trip's: see that action's own doc comment.
   *
   * The freezer flag is the sheet's per-row snowflake (#2925), reduced to names
   * exactly as `handleScanApply` reduces the barcode sheet's: matched rows by
   * `frozenItemIds`, new ones by `draft.frozen`. `addManyToPantry` applies it
   * after the `acquired` clear, so it lands on the new packet.
   */
  const handleReceiptApply = (
    shopId: string | null,
    itemIds: string[],
    priceById: Record<string, number>,
    _purchasedAt: string,
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>
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
    const frozenNames = new Set([
      ...itemIds
        .filter(id => frozenItemIds.has(id))
        .map(nameOf)
        .filter((name): name is string => !!name),
      ...toAdd.filter(draft => draft.frozen).map(draft => draft.name),
    ]);
    setReceiptOpen(false);
    if (names.length === 0) return;
    if (
      addManyToPantry(
        names, frozenNames, undefined, { byName: priceByName, shopId }, { acquired: true }
      ) > 0
    ) haptics.success();
  };

  // ==== row renderers ====
  const renderEntry = (entry: KitchenEntry, drag: () => void, isActive: boolean) => {
    // Three levels for four states, the fridge card's own rule: `fresh` reads
    // as ordinary tertiary text, so most of a kitchen stays quiet and the one
    // thing going off is the one thing coloured.
    const tint = entry.freshness ? freshnessColor(entry.freshness, colors) : colors.textTertiary;
    const isPortion = entry.kind === 'product' && portionIds.has(entry.sourceId);
    const facts = rowFacts(entry);
    const chipKind = facts ? pantryRowChip(facts) : 'have';
    const marks = facts ? pantryRowMarks(facts) : [];
    const selected = selectedIds.has(entry.id);
    const swipeSelect = {
      onSelect: () => enterSelectionMode(entry.id),
      accessibilityLabel: `Select ${entry.title}`,
    };
    const rowBody = (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => {
          if (selectionMode) { toggleSelection(entry.id); return; }
          haptics.tap();
          if (entry.kind === 'leftover') setOpenLeftoverId(entry.sourceId);
          // A box's corrections live on the box, so its row opens the item
          // sheet with the Products field already unfolded — the same
          // pre-opening a catalog row gets for its Pantry field, and for the
          // same reason: a collapsed field halfway down a dense sheet is in
          // practice no way to correct anything. A frozen portion's
          // corrections are in the Pantry field instead (see `portionIds`).
          else if (entry.kind === 'product' && entry.itemId) {
            setOpenItemField(portionIds.has(entry.sourceId) ? 'pantry' : 'products');
            setOpenItemId(entry.itemId);
          } else setOpenItemId(entry.sourceId);
        }}
        // The lift haptic is ReorderableList's own, so there's none here.
        // No drag while selecting: the rows are being picked, not moved.
        onLongPress={selectionMode ? undefined : drag}
        delayLongPress={interaction.delayLongPress}
        accessibilityRole="button"
        // The selection dot isn't its own element, so the row says whether it's picked.
        accessibilityState={selectionMode ? { selected } : undefined}
        accessibilityLabel={`${entry.title}, ${entry.caption}`}
        accessibilityHint={
          entry.kind === 'leftover'
            ? 'Opens the container to close it out. Long press to move it between the fridge and the freezer'
            : isPortion
              ? 'Opens the item to take this portion out of the freezer. Long press to move it to another aisle or the freezer'
              : entry.kind === 'product'
                ? 'Opens the item to correct this one. Long press to move it to another aisle or the freezer'
                : 'Opens the item to correct it further. Long press to move it to another aisle or the freezer'
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
          {/* What was done to the packet, as tags rather than more caption: the
              caption keeps the dates and these keep it scannable. */}
          {marks.length > 0 && (
            <View style={styles.marks}>
              {marks.map(mark => (
                <View key={mark} style={styles.mark}>
                  <Ionicons
                    name={mark === 'frozen' ? 'snow-outline' : 'open-outline'}
                    size={iconSize.xs}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.markText}>{mark === 'frozen' ? 'Frozen' : 'Opened'}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {/* The state the row is in, which also opens everything that can be
            said about it. The chip replaces a bare ✕ that only said "out",
            and a container's says where it is, with "finished" and "threw it
            out" as two entries of its menu so neither is guessed. */}
        {facts && !selectionMode && (
          <PressableScale
            style={[styles.chip, chipKind === 'low' && styles.chipLow]}
            onPress={e => openRowMenu(entry, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            hitSlop={8}
            accessibilityLabel={`${entry.productName ? `${entry.productName} ` : ''}${entry.title}, ${PANTRY_CHIP_LABEL[chipKind]}`}
            accessibilityHint="Opens the ways to mark it, such as finished, running low or bought more"
          >
            <Text style={[styles.chipText, chipKind === 'low' && styles.chipTextLow]}>
              {PANTRY_CHIP_LABEL[chipKind]}
            </Text>
            <Ionicons
              name="chevron-down"
              size={iconSize.xs}
              color={chipKind === 'low' ? colors.warningText : colors.textTertiary}
            />
          </PressableScale>
        )}
        <SwipeActionButtons enabled={!isActive && !selectionMode} selectAction={swipeSelect} />
        {/* In the chip's place while selecting, so nothing moves aside for it. */}
        {selectionMode && (
          <SelectionDot selected={selected} onPress={() => toggleSelection(entry.id)} />
        )}
      </TouchableOpacity>
    );
    return (
      // The card is the wrapper, so the swipe panel reveals inside its rounded
      // edge. SwipeableRow stays mounted through selection mode (see its note).
      <PaintSelectionRow rowId={isActive ? null : entry.id} style={styles.rowWrapper}>
        <SwipeableRow enabled={!isActive && !selectionMode} selectAction={swipeSelect}>
          {rowBody}
        </SwipeableRow>
      </PaintSelectionRow>
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
        // "40 things in the pantry · 2 to use up" wraps mid-phrase beside the
        // action buttons, so each part gets its own line. The second part goes
        // in the overline rather than a second subtitle line: a two-line
        // subtitle made this header a line taller than every other hub page's
        // and shunted the pills down when moving between them.
        overline={entries.length > 0 ? describeKitchen(entries).split(' · ')[1] : undefined}
        subtitle={entries.length > 0 ? describeKitchen(entries).split(' · ')[0] : undefined}
        actions={withScreenSettings([
          // Gated on a key for the reason the shopping list's own receipt
          // button is: the reading is the whole feature, and without one this
          // opens a sheet that can only apologise — which now means neither an
          // API key nor an on-device read, since Vision reads a receipt without
          // one.
          // Both also go with simplified mode, which drops this screen from the
          // hub pills — a deep link (a use-up task's own link) can still land
          // here, so the actions have to answer for the mode themselves.
          ...(receiptRoute !== 'unavailable' && !featureHidden('receiptImport', simpleMode)
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
          // Ungated, unlike the two above: the review deck needs no API key and
          // no camera, it writes only what this screen's own rows already write
          // (see PantryReviewSheet), and it is the one action here that is
          // useful with nothing else set up. The sheet handles an empty deck
          // itself rather than the button hiding, so the answer to "is there
          // anything to check" is given where it was asked.
          {
            icon: 'albums-outline' as const,
            onPress: () => setReviewOpen(true),
            accessibilityLabel: 'Go through the pantry one thing at a time',
          },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <HubPills hub="kitchen" active="Kitchen" />
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
      <ProductRatingOffer />

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
        <TextInput
          style={styles.search}
          {...filterField}
          placeholder="Find or add an item…"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType={canAdd ? 'done' : 'search'}
          onSubmitEditing={canAdd ? handleAdd : undefined}
          // An add keeps the keyboard up for the next name (handleAdd clears
          // the field for exactly that); a search has nothing to keep it for.
          blurOnSubmit={!canAdd}
          accessibilityLabel="Find something in the pantry, or type a name to add it"
        />
        <FieldClearButton query={query} onClear={clearQuery} />
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

      <PaintSelectionProvider {...paintProps}>
      <ReorderableList
        refreshControl={pullSearch.refreshControl}
        // A paint down the selection dots owns the touch; the list has to be
        // told directly (see PaintSelectionProvider).
        scrollEnabled={!painting}
        data={rows}
        keyExtractor={kitchenRowKey}
        renderItem={renderRow}
        scrollToTop={{ bottom: fabBottom }}
        // dragTick, not tap: a fast drag crosses several rows between frames
        // and unthrottled ticks run together into one long buzz. The lift
        // itself is fired by ReorderableList.
        dragRange={kitchenDragRange}
        placeholderStyle={styles.dropSlot}
        onReorder={reordered => applyMoves(resolveKitchenDrop(reordered))}
        ListHeaderComponent={reviewRow || suggestionHeader ? <>{reviewRow}{suggestionHeader}</> : null}
        // Full height when empty so the empty state's `flex: 1` has something
        // to centre in, and without the list's padding shifting that centre.
        contentContainerStyle={
          rows.length === 0
            ? styles.emptyContainer
            : [styles.list, {
              // Clear of the bulk bar while selecting, so the last rows can
              // scroll out from under it.
              paddingBottom: selectionMode
                ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm
                : tabBarHeight + spacing.xl,
            }]
        }
        ListEmptyComponent={
          <EmptyState
            icon="file-tray-stacked-outline"
            title={typed ? 'Nothing matches' : 'Nothing in the pantry yet'}
            subtitle={
              typed
                ? 'Nothing in the pantry has that name. Add it above if you have it.'
                : 'Finish a shopping trip and what you bought shows up here. To add something you already have, type a name above or scan a barcode or receipt.'
            }
            bottomOffset={tabBarHeight}
          />
        }
      />
      </PaintSelectionProvider>

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={selectableIds.length}
          actions={[
            { key: 'usedUp', icon: 'checkmark-done-circle', label: 'Used up', onPress: () => runBulk('usedUp') },
            { key: 'spoiled', icon: 'trash', label: 'Went bad', tone: 'destructive', onPress: () => runBulk('spoiled') },
            { key: 'have', icon: 'add-circle', label: 'Got it', onPress: () => runBulk('have') },
            { key: 'freeze', icon: 'snow', label: 'Freeze', onPress: () => runBulk('freeze') },
          ]}
          onSelectAll={() => selectAll(selectableIds)}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <LazySheet open={openItemId !== null}>
        <GroceryItemSheet
          visible={openItemId !== null}
          itemId={openItemId}
          onClose={() => {
            setOpenItemId(null);
            setOpenItemField('pantry');
          }}
          onOpenRecipe={recipeId => {
            setOpenItemId(null);
            setOpenItemField('pantry');
            navigation.navigate('RecipeDetail', { recipeId });
          }}
          onOpenSettings={entryId => {
            setOpenItemId(null);
            setOpenItemField('pantry');
            navigateToFoodSearchSettings(navigation, entryId);
          }}
          recipeExists={recipeId => recipes.some(r => r.id === recipeId)}
          // Opened on the Pantry pills, since that's what a catalog row here is:
          // the sheet is dense enough that a collapsed "Pantry" field halfway
          // down it was, in practice, no way to say you're out of something. The
          // repeat-waste offer is the one thing that opens it anywhere else, and
          // it lands on the field it's actually asking about.
          initialField={openItemField}
        />
      </LazySheet>

      <LazySheet open={scanOpen}>
        <BarcodeScanSheet
          visible={scanOpen}
          context="pantry"
          onClose={() => setScanOpen(false)}
          onApply={handleScanApply}
        />
      </LazySheet>

      <ReceiptImportSheet
        visible={receiptOpen}
        context="pantry"
        onClose={() => setReceiptOpen(false)}
        onApply={handleReceiptApply}
      />

      <LazySheet open={reviewOpen}>
        <PantryReviewSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
      </LazySheet>

      <LazySheet open={rowMenu !== null}>
        <ActionMenu
          visible={rowMenuOpen}
          title={rowMenu ? [rowMenu.entry.productName, rowMenu.entry.title].filter(Boolean).join(' ') : ''}
          actions={rowMenuActions}
          anchor={rowMenu?.anchor ?? null}
          onClose={() => setRowMenuOpen(false)}
        />
      </LazySheet>

      <LazySheet open={openLeftover !== null}>
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
          onSetWeight={grams => openLeftover && setLeftoverWeight(openLeftover.id, grams)}
          onFinish={outcome => openLeftover && finishLeftover(openLeftover.id, outcome)}
          onSetFrozen={frozen => openLeftover && setLeftoverFrozen(openLeftover.id, frozen)}
          onSplit={() => openLeftover && splitLeftover(openLeftover.id)}
          onReopen={() => openLeftover && reopenLeftover(openLeftover.id)}
          onDelete={() => openLeftover && deleteLeftover(openLeftover.id)}
          onClose={() => setOpenLeftoverId(null)}
          onOpenRecipe={
            openLeftover?.recipeId && recipes.some(r => r.id === openLeftover.recipeId)
              ? () => navigation.navigate('RecipeDetail', { recipeId: openLeftover.recipeId })
              : undefined
          }
        />
      </LazySheet>
      {pullSearch.sheet}
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
      marginBottom: spacing.md,
    },
    search: {
      flex: 1,
      fontSize: font.md,
      color: colors.text,
      // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
      // with no baseline compensation, so the glyphs sit low in the box.
      minHeight: 40,
      padding: 0,
    },
    // Left-aligned under the field it belongs to, and only as wide as its
    // label — the pill is one option, not a submit button spanning the sheet.
    addWrap: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
    },
    list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
    emptyContainer: { flexGrow: 1 },
    suggestWrap: {
      paddingHorizontal: spacing.md,
      // Both sides, not just the one that happened to matter: whatever
      // follows may have no top margin of its own.
      marginTop: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.xs,
    },
    // The review row's wrap when the recipes header follows it: that one brings
    // its own top margin, so this one drops its bottom.
    suggestWrapFollowed: { marginBottom: 0 },
    suggestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingVertical: spacing.smd,
      paddingHorizontal: spacing.md,
    },
    suggestBody: { flex: 1, minWidth: 0 },
    suggestName: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    suggestMeta: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.xxs },
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
    // The card: margins, corners and the clip the swipe panel reveals inside.
    rowWrapper: {
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: spacing.xxs,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    // Flush inside the card, with its own fill so the panel stays covered
    // until the row slides.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      paddingVertical: spacing.smd,
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
      marginVertical: spacing.xxs,
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
      marginVertical: spacing.xxs,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderStyle: 'dashed',
      borderColor: colors.separator,
      paddingVertical: spacing.smd,
      paddingHorizontal: spacing.md,
    },
    dropHintText: { fontSize: font.sm, color: colors.textTertiary },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.xxs },
    metaBox: { color: colors.textSecondary, fontWeight: fontWeight.medium },
    marks: { flexDirection: 'row', gap: spacing.xsm, marginTop: spacing.xsm },
    mark: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.xxs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    markText: { fontSize: font.xxs, fontWeight: fontWeight.semibold, color: colors.textSecondary },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.xsm - 1,
      paddingHorizontal: spacing.smd - 1,
      borderRadius: radius.full,
      borderWidth: border.hairline,
      borderColor: colors.separator,
    },
    chipLow: { borderColor: colors.warningText, backgroundColor: colors.warningBg },
    chipText: { fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary },
    chipTextLow: { color: colors.warningText },
  });
}
