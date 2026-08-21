// The grocery item sheet: name, quantity, aisle, shops, price, substitutes,
// either/or. One component of ~910 lines, so grep a landmark rather than
// reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   subCaption, makeStyles  helpers and styles, at the bottom
//
// The open-ended pill grids here go through PillGroup, which caps itself past
// eight; see docs/arch/groceries.md for what aisles, shops and substitutes mean.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { format } from 'date-fns/format';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  type LayoutChangeEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { useRecipeStore } from '../store/useRecipeStore';
import { recipesUsingIngredient } from '../utils/recipeComponents';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SearchField } from './SearchField';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import { editorSearchTerms, matchesEditorQuery, filterEditorRows, type EditorSearchable } from '../utils/editorSearch';
import { describeShops, shopsForItem, unavailableShopsFor } from '../utils/groceryShops';
import { describeSubstitutes, substitutesFor, type Substitute } from '../utils/itemSubs';
import { SubstituteSheet } from './SubstituteSheet';
import { ProductSheet } from './ProductSheet';
import {
  RATING_LABELS,
  describeProduct,
  describeProductPurchases,
  preferredProductOf,
  productsForItem,
} from '../utils/groceryProduct';
import { MergeItemSheet } from './MergeItemSheet';
import {
  cheapestShopFor,
  describePriceContext,
  describePriceStanding,
  describeShopPrices,
  formatPriceInput,
  lastPriceFor,
  parsePriceInput,
  priceStandingFor,
  priceToInput,
  shopPricesFor,
} from '../utils/groceryPrice';
import {
  defaultOnHandUntil,
  OUT_OF_IT_UNTIL,
} from '../utils/grocerySuggest';
import { describeExpiry, expiryDaysFromNow, expiryKeyFor } from '../utils/groceryShelfLife';
import { wantsUseUpTask } from '../utils/groceryExpiry';
import { dayKeyToDate } from '../utils/dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';
import { CountStepper } from './CountStepper';
import {
  GROCERY_EXPIRY_DAYS_MAX,
  GROCERY_BRAND_MAX_LENGTH,
  GROCERY_VARIANT_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
} from '../types';

/** "10000.00" — the widest thing GROCERY_PRICE_MINOR_MAX allows. */
const PRICE_INPUT_MAX_LENGTH = 8;

/**
 * The price field edits one target at a time — the item's own price, or one
 * store's. This keys the first; a store keys itself by id.
 */
const ITEM_PRICE_KEY = 'item';

/** The five collapsible fields in the "More" card, in the order they render. */
type CollapsibleFieldKey = 'products' | 'aisle' | 'stores' | 'pantry' | 'useBy' | 'substitutes' | 'usedIn';

interface Props {
  visible: boolean;
  itemId: string | null;
  onClose: () => void;
  /** Closes the sheet and opens the recipe this item came from. */
  onOpenRecipe?: (recipeId: string) => void;
  /**
   * Whether that recipe is still there. The pointer is a snapshot and doesn't
   * cascade, so a row can outlive it — in which case the line stays as the
   * plain caption it always was rather than becoming a button to nowhere.
   */
  recipeExists?: (recipeId: string) => boolean;
  /**
   * Which picker is already open when the sheet appears. Only for callers whose
   * whole reason for opening the sheet is that field — KitchenScreen, where the
   * row you tapped is a pantry row and "Out of it" is what you came to say.
   * Left closed by default: a long-press from the list has no such subject, and
   * a sheet that opens with a section unfolded for no reason is the progressive
   * disclosure these editors exist to avoid.
   */
  initialField?: CollapsibleFieldKey;
}

/**
 * Everything about one item that isn't "do I need it". Reached by long-press,
 * which is also where the single destructive action lives — there is no undo
 * anywhere in groceries, so deleting a catalog row is behind a confirm rather
 * than on a swipe.
 */
export function GroceryItemSheet({
  visible, itemId, onClose, onOpenRecipe, recipeExists, initialField,
}: Props) {
  // ==== store bindings ====
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const item = useGroceryStore(s => (itemId ? s.items.find(i => i.id === itemId) ?? null : null));
  const clearChoice = useGroceryStore(s => s.clearChoice);
  // Named siblings, live ones only — the same read GroceryScreen does for the
  // row caption, phrased as a sentence here because the sheet has the room.
  const alternativeNames = useGroceryStore(s => {
    if (!item?.choiceGroup) return null;
    const names = s.items
      .filter(i => i.id !== item.id && i.choiceGroup === item.choiceGroup && i.onList)
      .map(i => i.name);
    return names.length > 0 ? names.join(' or ') : null;
  });
  // The reverse of sourceRecipeTitle below: not where this row was first
  // created from, but every recipe that calls for it right now. See
  // recipesUsingIngredient.
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const usedInRecipes = useMemo(
    () => (item ? recipesUsingIngredient(item.nameKey, recipes) : []),
    [item, recipes]
  );
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const renameItem = useGroceryStore(s => s.renameItem);
  const setQuantity = useGroceryStore(s => s.setQuantity);
  const setNote = useGroceryStore(s => s.setNote);
  const setProductStrict = useGroceryStore(s => s.setProductStrict);
  const setProductUnavailable = useGroceryStore(s => s.setProductUnavailable);
  const setPreferredProduct = useGroceryStore(s => s.setPreferredProduct);
  const setAisle = useGroceryStore(s => s.setAisle);
  const addAisle = useGroceryStore(s => s.addAisle);
  const setOnHandUntil = useGroceryStore(s => s.setOnHandUntil);
  const setStaple = useGroceryStore(s => s.setStaple);
  const setExpiresAt = useGroceryStore(s => s.setExpiresAt);
  const setShelfLifeDays = useGroceryStore(s => s.setShelfLifeDays);
  const setUseUpTask = useGroceryStore(s => s.setUseUpTask);
  const setItemPrice = useGroceryStore(s => s.setItemPrice);
  const clearItemShopPrice = useGroceryStore(s => s.clearItemShopPrice);
  const useUpTasksEnabled = useSettingsStore(s => s.groceryUseUpTasks);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const removeFromList = useGroceryStore(s => s.removeFromList);
  const deleteItem = useGroceryStore(s => s.deleteItem);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const linkItemShop = useGroceryStore(s => s.linkItemShop);
  const unlinkItemShop = useGroceryStore(s => s.unlinkItemShop);
  const markItemsUnavailable = useGroceryStore(s => s.markItemsUnavailable);
  const clearItemUnavailable = useGroceryStore(s => s.clearItemUnavailable);
  const addShop = useGroceryStore(s => s.addShop);
  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));

  const [name, setName] = useState('');
  const [quantity, setQuantityText] = useState('');
  // ==== local state (the draft fields, and which section is open) ====
  const [note, setNoteText] = useState('');
  // Which price the field is editing: null is the item's own ("any store"),
  // else the store's id. The stores are the item's linked ones — see
  // priceTargetOptions.
  const [priceTarget, setPriceTarget] = useState<string | null>(null);
  // What's been typed, per target, buffered until Save. A map rather than one
  // string because switching stores mid-edit must neither commit what was
  // typed (Cancel has to mean cancel) nor throw it away. A key absent means
  // untouched and the stored price shows through; '' means the user emptied
  // it, which is how a price is taken back.
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  // Which substitute sheet is up, if any: 'add' opens the picker, an item id
  // opens that link for review. Null closes it.
  const [subSheet, setSubSheet] = useState<'add' | string | null>(null);
  // Same shape as subSheet above: 'add' opens a blank product, an id opens
  // that one for review. Null closes it.
  const [productSheet, setProductSheet] = useState<'add' | string | null>(null);
  const [mergeSheetOpen, setMergeSheetOpen] = useState(false);
  // One picker open at a time, like every other editor in the app — see the
  // progressive-disclosure note in CLAUDE.md.
  const [openField, setOpenField] = useState<CollapsibleFieldKey | null>(null);

  // Field search — TaskEditor's magnifier, ported: sixteen fields is a lot to
  // scan for "where's expiry" when the sheet calls it Use by. Off by default
  // and behind the header icon, so an item nobody is searching looks exactly
  // as it did.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTerms = useMemo(
    () => (searchOpen ? editorSearchTerms(searchQuery) : []),
    [searchOpen, searchQuery]
  );
  const searching = searchTerms.length > 0;
  const toggleSearch = () => {
    haptics.tap();
    animateLayout();
    setSearchOpen(open => !open);
    setSearchQuery('');
  };
  // Where `initialField`'s section actually lands once it's laid out — the
  // card and the field within it each report their own y through onLayout,
  // and the field the caller asked for isn't visible on a card this long
  // (Aisle/Stores/Pantry/Use by/Substitutes stacked below Name/Brand/
  // Variant/Quantity/Price/Note) without scrolling to it ourselves.
  // null, not 0: a child's onLayout isn't guaranteed to fire after its
  // parent's, so 0 would read as "the card starts at the top" and scroll to
  // the wrong offset if the field's own callback lands first.
  const cardYRef = useRef<number | null>(null);
  const fieldYRefs = useRef<Partial<Record<CollapsibleFieldKey, number>>>({});
  const pendingScrollField = useRef<CollapsibleFieldKey | null>(null);

  const maybeScrollToInitialField = () => {
    const field = pendingScrollField.current;
    if (!field || cardYRef.current === null) return;
    const fieldY = fieldYRefs.current[field];
    if (fieldY === undefined) return;
    const y = Math.max(0, cardYRef.current + fieldY - spacing.md);
    keyboardScroll.ref.current?.scrollTo?.({ y, animated: false });
    pendingScrollField.current = null;
  };

  useEffect(() => {
    if (visible && item) {
      setName(item.name);
      setQuantityText(item.quantity ?? '');
      setNoteText(item.note);
      setPriceTarget(null);
      setPriceEdits({});
      setNameError(null);
      setOpenField(initialField ?? null);
      setSubSheet(null);
      cardYRef.current = null;
      fieldYRefs.current = {};
      pendingScrollField.current = initialField ?? null;
    }
  }, [visible, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==== derived values and suggestions ====
  // Every box named under this item, preferred one first — the list the
  // Products field renders. Brand/variant suggestions are deliberately *not*
  // computed here any more: they were drawn from the whole catalog, which is
  // how "Siggi's" ended up offered under a loaf of bread. They now live in
  // ProductSheet, scoped to this item's own products, which is the only scope
  // a brand actually repeats in.
  const products = useMemo(
    () => (item ? productsForItem(item.id, itemProducts, item.preferredProductId) : []),
    [item, itemProducts]
  );
  const preferred = useMemo(
    () => (item ? preferredProductOf(item, itemProducts) : null),
    [item, itemProducts]
  );

  const toggleField = (field: CollapsibleFieldKey) =>
    setOpenField(current => (current === field ? null : field));
  const closeField = () => {
    animateLayout();
    setOpenField(null);
  };

  if (!item) {
    // Themed even though there's nothing to show: this branch renders while
    // the sheet is closing too (onClose nulls itemId in the same update that
    // flips visible to false), and an unstyled Modal here defaults to a
    // native white background, flashing behind the close animation (#1618).
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.root} />
      </Modal>
    );
  }

  const linkFor = (shopId: string) =>
    itemShops.find(l => l.itemId === item.id && l.shopId === shopId) ?? null;

  // Every field below commits on its own, the moment it stops being edited —
  // matching the CollapsibleField pills further down, which have always
  // applied on tap. There is no longer a Save to defer to and nothing to
  // discard, so the header is a bare Done (see GroceryAislesSheet's own).
  //
  // renameItem refuses a collision rather than merging two catalog rows —
  // merging means choosing whose purchase history survives — so a rejected
  // rename leaves nameError showing and the item's stored name untouched;
  // the field itself keeps whatever was typed until it's corrected.
  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) { setNameError(null); return; }
    if (!renameItem(item.id, trimmed)) {
      setNameError('Another item already has that name.');
      haptics.error();
      return;
    }
    setNameError(null);
  };
  const commitQuantity = () => {
    if (quantity !== (item.quantity ?? '')) setQuantity(item.id, quantity);
  };
  const commitNote = () => {
    if (note !== item.note) setNote(item.id, note);
  };
  // Scoped to one target rather than looping every buffered edit: unlike the
  // old Save, there's no longer a single moment that flushes the whole
  // priceEdits map, so each target has to commit for itself — on its own
  // field blurring, and (below) right before the picker switches which
  // target the one physical field is bound to. Anything that doesn't parse
  // ("4.9.9", a typo mid-correction) is left alone rather than cleared.
  const commitPrice = (key: string) => {
    const raw = priceEdits[key];
    if (raw === undefined) return;
    const shopId = key === ITEM_PRICE_KEY ? null : key;
    const link = shopId ? linkFor(shopId) : null;
    // A store unlinked in this same sheet since the price was typed has
    // nowhere to put it, and it isn't an item-level price either — the user
    // said which store it was.
    if (shopId && !link) return;
    const stored = shopId ? link!.lastPriceMinor : item.lastPriceMinor;
    const trimmed = raw.trim();
    const parsed = parsePriceInput(trimmed);
    if (!trimmed) {
      if (stored === null) return;
      // Clearing one store's number says nothing about the item — that's the
      // whole reason clearItemShopPrice exists next to setItemPrice.
      if (shopId) clearItemShopPrice(item.id, shopId);
      else setItemPrice(item.id, null);
      return;
    }
    if (parsed !== null && parsed !== stored) {
      setItemPrice(item.id, parsed, shopId);
    }
  };

  /**
   * Creating an aisle here always files this item into it: you're standing in
   * the item's aisle picker, so "Baby" with the item left in Other would be a
   * step that looks like it did nothing. addAisle hands back the existing name
   * on a collision, so typing one that's already there just selects it.
   */
  const handleCreateAisle = (aisleName: string) => {
    const created = addAisle(aisleName);
    if (!created) return 'That isn’t a usable aisle name.';
    setAisle(item.id, created);
    haptics.success();
    // Collapses like any other single-choice pick — the field's summary is
    // already showing the new aisle, which is the confirmation.
    closeField();
  };

  /**
   * Same reasoning as handleCreateAisle: you're here to say where this item can
   * be bought, so a store created from this sheet is linked to the item on the
   * spot rather than left to be found again from the Stores tab. addShop,
   * unlike addAisle, hands back null on a name collision rather than the
   * existing store — a store's identity is its id, not its name, so there's no
   * "you meant this one" to fall back to and the name has to be rejected.
   */
  const handleCreateShop = (shopName: string) => {
    const created = addShop(shopName);
    if (!created) return 'There’s already a store with that name.';
    linkItemShop(item.id, created.id);
    haptics.success();
    // No closeField: stores are multi-select, so you're probably not done.
  };

  const linkedShops = shopsForItem(item, itemShops, shops);
  const linkedCounts = new Map(linkedShops.map(s => [s.shop.id, s.purchaseCount]));
  // Stores the user has said don't stock this — the third pill state, and the
  // only place in the app those claims can be seen and taken back.
  const notStocked = new Set(unavailableShopsFor(item.id, itemShops, shops).map(s => s.id));
  const summary = describeShops(item, itemShops, shops);
  const substitutes = substitutesFor(item.id, itemSubs, items);
  const substitutesSummary = describeSubstitutes(substitutes);

  // Prices: two lines, never more. What the stored number was for, and the
  // store-by-store list with the one comparison that's safe to state tagged
  // inside it. cheapestShopFor refuses on a single priced store, a tie, or
  // prices recorded for different quantities — in which case the list is shown
  // untagged, which is the honest answer and shows the reader why.
  const now = new Date();
  const priceContext = describePriceContext(item, now);
  const shopPrices = shopPricesFor(item.id, itemShops, shops);
  const cheapest = cheapestShopFor(item.id, itemShops, shops);
  const shopPriceLine = describeShopPrices(shopPrices, currencySymbol, cheapest?.shop.id ?? null);

  /**
   * Which stores the price field can be pointed at: the ones this item is
   * linked to, and no others. setItemPrice writes onto an *existing* link and
   * deliberately won't mint one — a price is not a claim that the shop stocks
   * it — so an unlinked store here would be a pill that silently did nothing.
   * Linking is one section down, which is where that claim belongs.
   *
   * A store marked as not stocking this is already dropped by shopsForItem, and
   * so is every price read: pricing a shelf you've said is empty has no answer
   * to show.
   */
  const activeTarget =
    priceTarget && linkedShops.some(s => s.shop.id === priceTarget) ? priceTarget : null;
  const priceKey = activeTarget ?? ITEM_PRICE_KEY;
  const targetShopName = linkedShops.find(s => s.shop.id === activeTarget)?.shop.name ?? null;
  // The target's *own* price, never a fallback: a field about to be written has
  // to show what's actually stored for what it's about to write (the same call
  // the unit-conversion note makes about editable fields). What it cost
  // elsewhere is the placeholder instead — a starting point that asserts
  // nothing until it's typed over, exactly as FinishShoppingSheet seeds its rows.
  const storedPrice = activeTarget ? linkFor(activeTarget)?.lastPriceMinor ?? null : item.lastPriceMinor;
  const price = priceEdits[priceKey] ?? (storedPrice === null ? '' : priceToInput(storedPrice));
  const priceHint = lastPriceFor(item, activeTarget, itemShops);
  // The verdict on what's stored, judged against the run kept for whichever
  // target (item or store) the field is currently pointed at — never against
  // what's mid-edit in the field, which isn't a price yet.
  const priceStandingText = describePriceStanding(priceStandingFor(item, activeTarget, itemShops));

  const priceTargetOptions: PillGroupOption[] = [
    {
      key: ITEM_PRICE_KEY,
      label: 'Any store',
      // Never buried behind "N more" — it's the option meaning "I'm not saying
      // where", and the one the field defaults to.
      pinned: true,
      selected: activeTarget === null,
      accessibilityLabel: 'Last price paid, without saying which store',
      onPress: () => {
        haptics.tap();
        commitPrice(priceKey);
        setPriceTarget(null);
      },
    },
    ...linkedShops.map(({ shop }) => ({
      key: shop.id,
      label: shop.name,
      selected: activeTarget === shop.id,
      accessibilityLabel: `Last price at ${shop.name}`,
      onPress: () => {
        haptics.tap();
        commitPrice(priceKey);
        setPriceTarget(shop.id);
      },
    })),
  ];

  // A future onHandUntil is an active "Got it"; OUT_OF_IT_UNTIL is an active
  // "Out of it"; anything else leaves the purchase reading deciding — see
  // GroceryItem.onHandUntil and grocerySuggest.probablyHaveReason.
  //
  // "Out of it" tests the sentinel rather than merely "in the past", which
  // this used to and which its own note claimed was the same thing (#1770).
  // It stopped being the same thing when trips started stamping windows that
  // lapse: a row bought last spring came to sit here with the negative pill
  // lit, reporting a claim nobody had made. Trips no longer write the column
  // at all, but rows stamped before that still carry the shape.
  const onHandFuture = !!item.onHandUntil && new Date(item.onHandUntil).getTime() >= Date.now();
  const onHandPast = item.onHandUntil === OUT_OF_IT_UNTIL;
  const markGotIt = () => {
    haptics.tap();
    setOnHandUntil(item.id, defaultOnHandUntil(item, new Date()));
  };
  const markOutOfIt = () => {
    haptics.tap();
    setOnHandUntil(item.id, OUT_OF_IT_UNTIL);
  };
  const clearOnHand = () => {
    haptics.tap();
    setOnHandUntil(item.id, null);
  };
  // ==== actions: saving fields back to the item ====
  const toggleStaple = () => {
    haptics.tap();
    setStaple(item.id, !item.isStaple);
  };

  // The stepper talks in days from today and the row stores a day; a date
  // survives the app being closed for a week, where "5 days" would quietly
  // mean five days from whenever you next looked. Same conversion
  // keepUntilKeyFor/keepDaysBetween do for a leftover.
  //
  // While the item is on hand this is a real countdown (expiresAt); while
  // it isn't, there's nothing to count down from yet, so the stepper reads
  // and writes the remembered shelf life instead — see
  // GroceryItem.shelfLifeDays for why a purchase is what activates it.
  const expiryDays = onHandFuture
    ? (item.expiresAt ? expiryDaysFromNow(item.expiresAt, new Date()) : null)
    : item.shelfLifeDays;
  const pickExpiryDays = (days: number | null) => {
    haptics.tap();
    setShelfLifeDays(item.id, days);
    if (onHandFuture) {
      setExpiresAt(item.id, days === null ? null : expiryKeyFor(new Date(), days));
    }
  };
  // Whether this item gets a task, as the store will decide it — not whether
  // one exists right now. A task completed this morning shouldn't make the row
  // read as though the item had been opted out of.
  const hasUseUpTask = wantsUseUpTask(item, useUpTasksEnabled);

  /**
   * One pill, three states, cycled by tapping: nothing → *you get it here* →
   * *they don't have it* → nothing.
   *
   * A cycle rather than two controls because the states are answers to one
   * question, and the field's hint spells the order out — the alternative was a
   * second grid of the same stores, which is the exact thing PillGroup exists
   * to stop (~30 pills pushing the name and quantity off the sheet).
   *
   * The one branch that isn't a plain step is a store with real purchases:
   * dropping those destroys a record, and groceries have no undo, so it asks —
   * and the ask is where "they've stopped stocking it" lives, since that's the
   * case where the history is worth keeping and the shelf is still empty.
   */
  const toggleShop = (shopId: string) => {
    const shopName = shops.find(s => s.id === shopId)?.name ?? 'this store';

    // Third state → back to nothing. clearItemUnavailable keeps any purchases
    // and drops a row that was only ever the claim.
    if (notStocked.has(shopId)) {
      haptics.tap();
      clearItemUnavailable(item.id, shopId);
      return;
    }

    const count = linkedCounts.get(shopId);
    if (count === undefined) {
      haptics.tap();
      linkItemShop(item.id, shopId);
      return;
    }
    if (count === 0) {
      haptics.tap();
      markItemsUnavailable([item.id], shopId);
      return;
    }
    Alert.alert(
      `${shopName} and ${item.name}`,
      `${count} ${count === 1 ? 'purchase' : 'purchases'} recorded here. Forgetting them can’t be undone. The item and its overall count stay either way.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          // The common case by far, and it keeps everything: the shop did sell
          // it to you, and has stopped.
          text: 'They don’t have it now',
          onPress: () => {
            markItemsUnavailable([item.id], shopId);
            haptics.tap();
          },
        },
        {
          text: 'Forget purchases',
          style: 'destructive',
          onPress: () => {
            unlinkItemShop(item.id, shopId);
            haptics.warning();
          },
        },
      ]
    );
  };

  const handleForgetItem = () => {
    confirmDelete({
      title: `Forget ${item.name}?`,
      // No pointer at "Remove from list" for a provisional row: it does the
      // same thing there, so offering it as the gentler option is a lie.
      message: item.inCatalog
        ? 'This removes it from your catalog along with its history, and can’t be undone. To just take it off this week’s list, use "Remove from list".'
        : 'This removes it altogether, and can’t be undone.',
      confirmLabel: 'Forget',
      onConfirm: () => {
        deleteItem(item.id);
        haptics.warning();
        onClose();
      },
    });
  };

  const aisleOptions: PillGroupOption[] = aisleOrder.map(aisle => ({
    key: aisle,
    label: aisle,
    selected: aisle === item.aisle,
    onPress: () => {
      haptics.tap();
      setAisle(item.id, aisle);
      closeField();
    },
  }));

  const shopOptions: PillGroupOption[] = shops.map(shop => {
    const count = linkedCounts.get(shop.id);
    const active = count !== undefined;
    const absent = notStocked.has(shop.id);
    return {
      key: shop.id,
      label: shop.name,
      // Only an observed link shows a number. A count of 0 on a hand-marked
      // store reads as "never bought here", the opposite of what the tap meant.
      suffix: count ? ` · ${count}` : undefined,
      selected: active,
      negative: absent,
      accessibilityLabel: absent
        ? `${shop.name}, marked as not stocking this. Tap to clear.`
        : active
          ? count === 0
            ? `${shop.name}, marked by you. Tap to say they don’t have it.`
            : `${shop.name}, bought here ${count} ${count === 1 ? 'time' : 'times'}. Tap for options.`
          : `${shop.name}. Tap to mark that you can get this here.`,
      onPress: () => toggleShop(shop.id),
    };
  });

  // The preferred product's own words, for the labels below. Null only when
  // there's no preference, in which case none of this renders.
  const wantedProduct = describeProduct(preferred);

  const productStrictOptions: PillGroupOption[] = [
    {
      key: 'strict',
      label: 'Only this one',
      selected: item.productStrict,
      accessibilityLabel: item.productStrict
        ? `Only ${wantedProduct}, on. Stores carrying a different one don’t count as having this. Tap to turn off.`
        : `Only ${wantedProduct} — count only stores recorded as carrying it`,
      onPress: () => {
        haptics.tap();
        setProductStrict(item.id, !item.productStrict);
      },
    },
  ];

  /**
   * "Which stores haven't got it" — the claim, one pill per store, multi-select.
   *
   * Every store is offered, not just the linked ones: finding out a shop hasn't
   * got the one you want is a thing that happens at a shop you've never
   * recorded this item at. The ones already marked as not stocking the item at
   * all are left out, since that claim outranks this one and saying both is
   * contradictory.
   *
   * Deliberately a claim rather than a "which one do they carry" field. The app
   * can only ever know the product you last *got* somewhere, and a shelf holds
   * several at once, so a recorded product can never stand in for this — see
   * groceryShops.lacksWantedProduct.
   *
   * The claim is about the *preferred* product specifically, which is why these
   * pills only appear while there is one and why switching the preference
   * changes what they're marking. A claim made about Arnold's stays filed
   * against Arnold's rather than silently transferring to whatever you switch
   * to — see ItemShopLink.unavailableProductIds.
   */
  const productNegativeOptions: PillGroupOption[] = shops
    .filter(s => !notStocked.has(s.id))
    .map(shop => {
      const marked = preferred
        ? linkFor(shop.id)?.unavailableProductIds[preferred.id] !== undefined
        : false;
      return {
        key: shop.id,
        label: shop.name,
        selected: marked,
        negative: marked,
        accessibilityLabel: marked
          ? `${shop.name}, marked as not having ${wantedProduct}. Tap to clear.`
          : `${shop.name}. Tap to say they haven’t got ${wantedProduct}.`,
        onPress: () => {
          haptics.tap();
          setProductUnavailable(item.id, shop.id, !marked);
        },
      };
    });

  const pantryOptions: PillGroupOption[] = [
    {
      key: 'staple',
      label: 'Always have it',
      selected: item.isStaple,
      accessibilityLabel: item.isStaple
        ? 'Always have it, marked as a staple. Tap to clear.'
        : 'Always have it, mark as a staple you always keep stocked',
      onPress: toggleStaple,
    },
    {
      key: 'got',
      label: 'Got it',
      selected: onHandFuture,
      accessibilityLabel: onHandFuture
        ? 'Got it, marked on hand. Tap to clear.'
        : 'Got it, mark as on hand',
      onPress: onHandFuture ? clearOnHand : markGotIt,
    },
    {
      key: 'out',
      label: 'Out of it',
      selected: onHandPast,
      accessibilityLabel: onHandPast
        ? 'Out of it, marked not on hand. Tap to clear.'
        : 'Out of it, mark as not on hand',
      onPress: onHandPast ? clearOnHand : markOutOfIt,
    },
  ];

  const linkedNames = shops.filter(s => linkedCounts.has(s.id)).map(s => s.name);
  const notStockedNames = shops.filter(s => notStocked.has(s.id)).map(s => s.name);
  // Names, not a bare count: which shops is the fact, and the first one plus
  // "+3" fits the one line a collapsed field gets. Counting *stores* rather
  // than purchases, so this can't be read as a trip total — see describeShops.
  const plusMore = (names: string[]) =>
    names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
  // A collapsed field shows one value, so the positives win the line when there
  // are any — where you *can* get it is the more useful half. An item with only
  // negatives would otherwise summarise as "Any", which is the one thing the
  // user has said it isn't.
  const storesSummary = linkedNames.length
    ? plusMore(linkedNames)
    : notStockedNames.length
      ? `Not ${plusMore(notStockedNames)}`
      : undefined;
  const usedInSummary = usedInRecipes.length ? plusMore(usedInRecipes.map(r => r.name)) : undefined;

  // Search visibility for the fields that render directly (not inside the
  // collapsible card below) — same shape as TaskEditor's titleVisible/
  // notesVisible: a row that isn't shown for this item at all (no expiry, not
  // on the list) stays hidden search or not, so it never inflates the count.
  const nameVisible = !searching
    || matchesEditorQuery({ key: 'name', label: 'Name', keywords: ['title', 'rename', 'what', 'called'] }, searchTerms);
  const brandVisible = !searching
    || matchesEditorQuery({ key: 'brand', label: 'Brand', keywords: ['manufacturer', 'strict', 'only this brand', 'maker'] }, searchTerms);
  const variantVisible = !searching
    || matchesEditorQuery({ key: 'variant', label: 'Variant', keywords: ['type', 'style', 'kind', 'flavor'] }, searchTerms);
  const quantityVisible = !searching
    || matchesEditorQuery({ key: 'quantity', label: 'Quantity', keywords: ['amount', 'size', 'how much'] }, searchTerms);
  const priceVisible = !searching
    || matchesEditorQuery({ key: 'price', label: 'Last price', keywords: ['cost', 'spend', 'money', 'store price'] }, searchTerms);
  const noteVisible = !searching
    || matchesEditorQuery({ key: 'note', label: 'Note', keywords: ['comment', 'details', 'memo'] }, searchTerms);
  const useUpTaskVisible = !!item.expiresAt && (!searching
    || matchesEditorQuery({ key: 'useUpTask', label: 'Use-up task', keywords: ['reminder', 'notification', 'task'] }, searchTerms));
  const removeFromListVisible = item.onList && (!searching
    || matchesEditorQuery({ key: 'removeFromList', label: 'Remove from list', keywords: ['take off', 'delete'] }, searchTerms));
  const mergeVisible = !searching
    || matchesEditorQuery({ key: 'merge', label: 'Merge with another item', keywords: ['duplicate', 'combine', 'same thing'] }, searchTerms);
  const forgetVisible = !searching
    || matchesEditorQuery({ key: 'forget', label: 'Forget this item', keywords: ['delete', 'remove', 'trash'] }, searchTerms);

  // The seven collapsible fields, as one filterable list — same convention as
  // EditorGroup's rows: each carries its own label and keywords, so there's
  // no separate index to keep in step with the JSX below.
  const collapsibleRows: (EditorSearchable & { node: React.ReactNode })[] = [
    {
      key: 'products',
      label: 'Products',
      keywords: ['brand', 'variant', 'which one', 'kind', 'type', 'flavor', 'rating', 'rate', 'loved', 'never again', 'avoid', 'only this one', 'strict'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.products = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          {/* First of the collapsible fields, because it qualifies the name
              directly above it: this is the half of "what am I buying" that
              deliberately stays out of the name, so the name keeps matching
              recipes and purchase history.

              Rows rather than a PillGroup, the call Substitutes already makes
              one field down and for the same reason: a pill can only express
              membership, and a product also carries a rating, a note and a
              purchase count. It replaced two free-text fields (Brand and
              Variant) whose suggestion chips were drawn from the whole
              catalog — see ProductSheet for why that scope was wrong. */}
          <CollapsibleField
            label="Products"
            summary={wantedProduct ?? undefined}
            emptySummary="Any"
            hint={`The specific ones you buy. Pick the one you want, and rate them so you remember which ${item.name.toLowerCase()} was which.`}
            expanded={openField === 'products'}
            onToggle={() => toggleField('products')}
          >
            {products.map((product, i) => {
              const isPreferred = product.id === item.preferredProductId;
              const bought = describeProductPurchases(product);
              // The rating first, then the note, then the count: one line of
              // qualifications under the name, in the order they'd change a
              // decision. Two lines of tertiary grey under every row reads as
              // a paragraph — the same call subCaption makes below.
              const meta = [
                product.rating ? RATING_LABELS[product.rating] : null,
                product.note || null,
                bought,
              ].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity
                  key={product.id}
                  style={[styles.subRow, i > 0 && styles.subRowDivided]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    setProductSheet(product.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${describeProduct(product)}${isPreferred ? ', the one you want' : ''}${meta ? `. ${meta}` : ''}`}
                  accessibilityHint="Opens this product, where you can rate, edit or remove it"
                >
                  <View style={styles.subBody}>
                    <View style={styles.productNameRow}>
                      <Text style={styles.subName} numberOfLines={1}>{describeProduct(product)}</Text>
                      {/* The preference is marked on the row rather than
                          shown by reordering alone: the list is short, and
                          "first" is not a thing anyone reads as "chosen". */}
                      {isPreferred && (
                        <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
                      )}
                    </View>
                    {!!meta && <Text style={styles.subMeta} numberOfLines={1}>{meta}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
            {/* One row, not two stacked pills: they're a pair of controls
                under the list, and full-width-looking pills on their own lines
                read as the stack of links InlineAction exists to undo. Both
                neutral, matching the Add substitute pill one field down —
                the sheet having two ranks of add button is the drift. */}
            <View style={styles.productActions}>
              <InlineAction
                label="Add product"
                icon="pricetag-outline"
                variant="neutral"
                onPress={() => {
                  haptics.tap();
                  setProductSheet('add');
                }}
                accessibilityLabel={`Add a product for ${item.name}`}
              />
              {/* Only once there's more than one box to choose between, and
                  only while one is chosen. With a single product the
                  preference is already unambiguous, and clearing it would be a
                  control whose whole effect is to make the row say less. */}
              {products.length > 1 && !!preferred && (
                <InlineAction
                  label="No preference"
                  icon="close-circle-outline"
                  variant="neutral"
                  onPress={() => {
                    haptics.tap();
                    setPreferredProduct(item.id, null);
                  }}
                  accessibilityLabel="Clear which one you want, so any of them will do"
                />
              )}
            </View>
            {/* Off by default and only offered once there's a product to be
                strict about — see GroceryItem.productStrict. It's a pill
                rather than a switch for the same reason "Always have it" is
                one: it's a one-word state on the item, and the pantry field
                below already spells that idiom in this sheet. */}
            {!!preferred && (
              <>
                <View style={styles.brandStrictRow}>
                  <PillGroup options={productStrictOptions} noun="option" surface="page" />
                </View>
                <Text style={styles.hint}>
                  {item.productStrict
                    ? 'Stores you’ve marked as not having it won’t count as having this. Mark them under Stores.'
                    : 'Off, so every store that stocks this counts, whichever one it has.'}
                </Text>
              </>
            )}
          </CollapsibleField>
        </View>
      ),
    },
    {
      key: 'aisle',
      label: 'Aisle',
      keywords: ['section', 'shelf', 'location', 'walk'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.aisle = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          <CollapsibleField
            label="Aisle"
            summary={item.aisle}
            hint="Groups this item on your list, in the order you walk the store."
            expanded={openField === 'aisle'}
            onToggle={() => toggleField('aisle')}
          >
            <PillGroup
              options={aisleOptions}
              noun="aisle"
              onCreate={handleCreateAisle}
              filterPlaceholder="Find or add an aisle…"
            />
          </CollapsibleField>
        </View>
      ),
    },
    {
      key: 'stores',
      label: 'Stores',
      keywords: ['where', 'buy', 'shop', 'find', 'sell', 'carries', 'not stocked', 'unavailable', 'out of stock'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.stores = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          <CollapsibleField
            label="Stores"
            summary={storesSummary}
            emptySummary="Any"
            hint="Tap a store to say you can get this there, again to say they don’t have it. Finishing a shopping trip marks them for you."
            expanded={openField === 'stores'}
            onToggle={() => toggleField('stores')}
          >
            <PillGroup options={shopOptions} noun="store" onCreate={handleCreateShop} />
            {/* Only while a product rule is actually in force. Without one
                these claims would be recording evidence nothing reads, and
                the sheet is already dense — the pills above are what a person
                comes to Stores for. */}
            {item.productStrict && !!wantedProduct && (
              <View style={styles.brandAtBlock}>
                <Text style={styles.label}>
                  {`Haven’t got ${wantedProduct}`.toUpperCase()}
                </Text>
                <PillGroup options={productNegativeOptions} noun="store" />
                {/* The rule that makes the whole feature safe, said where
                    someone is about to rely on it. */}
                <Text style={styles.hint}>
                  Only what you’ve marked here is left out. A store you haven’t
                  marked still counts — shops carry several versions, so getting
                  a different one somewhere isn’t knowing they haven’t got yours.
                </Text>
              </View>
            )}
          </CollapsibleField>
        </View>
      ),
    },
    {
      key: 'pantry',
      label: 'Pantry',
      keywords: ['staple', 'always have it', 'have it', 'on hand', 'got it', 'out of it'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.pantry = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          <CollapsibleField
            label="Pantry"
            summary={
              item.isStaple
                ? 'Always have it'
                : onHandFuture
                  ? `Got it until ${format(new Date(item.onHandUntil!), 'd MMM')}`
                  : onHandPast
                    ? 'Out of it'
                    : undefined
            }
            emptySummary="Automatic"
            hint={
              item.isStaple
                ? 'Treated as on hand at all times, and kept out of the way in its own group when a recipe adds ingredients to the list.'
                : onHandPast
                  ? 'Marked out of it. Won’t show as probably-have until you buy it again.'
                  : 'Decided automatically from purchase history when this comes up in a week plan.'
            }
            expanded={openField === 'pantry'}
            onToggle={() => toggleField('pantry')}
          >
            <PillGroup options={pantryOptions} noun="state" />
          </CollapsibleField>
        </View>
      ),
    },
    {
      key: 'useBy',
      label: 'Use by',
      keywords: ['expiry', 'expire', 'expires', 'goes off', 'best before', 'spoil', 'shelf life'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.useBy = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          <CollapsibleField
            label="Use by"
            summary={
              item.expiresAt
                ? `${format(dayKeyToDate(item.expiresAt), 'd MMM')} · ${describeExpiry(item.expiresAt)}`
                : item.shelfLifeDays !== null
                  ? `Keeps ${item.shelfLifeDays} ${item.shelfLifeDays === 1 ? 'day' : 'days'}`
                  : undefined
            }
            emptySummary="None"
            hint={
              item.expiresAt
                ? "The day this should be used up by. Finishing a shopping trip fills it in for things that go off, and the use-up task is dated from it."
                : "How long this keeps once bought. It doesn't count down yet — finishing a shopping trip starts the clock from there, and adds the use-up task."
            }
            expanded={openField === 'useBy'}
            onToggle={() => toggleField('useBy')}
          >
            <View style={styles.stepperRow}>
              <Text style={styles.stepperHint}>{onHandFuture ? 'Days from today' : 'Days once bought'}</Text>
              <CountStepper
                value={expiryDays}
                onChange={pickExpiryDays}
                min={0}
                max={GROCERY_EXPIRY_DAYS_MAX}
                allowNull
                emptyLabel="None"
                format={n => (onHandFuture && n === 0 ? 'Today' : `${n}d`)}
                label="Use by"
                describeValue={n => {
                  if (n === null) return onHandFuture ? 'No use-by date' : 'No shelf life recorded';
                  if (onHandFuture) return n === 0 ? 'Use by today' : `${n} days from today`;
                  return `Keeps ${n} ${n === 1 ? 'day' : 'days'} once bought`;
                }}
              />
            </View>
          </CollapsibleField>
        </View>
      ),
    },
    {
      key: 'substitutes',
      label: 'Substitutes',
      keywords: ['swap', 'instead of', 'replace', 'alternative', 'out of stock', 'sold out'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.substitutes = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          {/* Rows rather than a PillGroup, unlike the three fields above. A
              pill can only express membership, and a substitute also carries
              a note and a direction — with pills you'd have to tap each lit
              one to find out whether it says anything at all. A grid was
              mocked alongside this and dropped. */}
          <CollapsibleField
            label="Substitutes"
            summary={substitutesSummary ?? undefined}
            emptySummary="None"
            hint={`If there’s no ${item.name.toLowerCase()}, what you’d use instead. Saved on this item, so every recipe calling for it can use it.`}
            expanded={openField === 'substitutes'}
            onToggle={() => toggleField('substitutes')}
          >
            {substitutes.map((sub, i) => (
              <TouchableOpacity
                key={sub.item.id}
                style={[styles.subRow, i > 0 && styles.subRowDivided]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  setSubSheet(sub.item.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${sub.item.name}${sub.link.note ? `, ${sub.link.note}` : ''}`}
                accessibilityHint="Opens this substitute, where you can edit or remove it"
              >
                <View style={styles.subBody}>
                  <Text style={styles.subName} numberOfLines={1}>{sub.item.name}</Text>
                  {/* The note and the direction share one sub-line: they're
                      both qualifications of the name above, and two lines of
                      tertiary grey under every row reads as a paragraph. */}
                  {!!subCaption(sub) && (
                    <Text style={styles.subMeta} numberOfLines={1}>{subCaption(sub)}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
            <InlineAction
              label="Add substitute"
              icon="swap-horizontal"
              variant="neutral"
              onPress={() => {
                haptics.tap();
                setSubSheet('add');
              }}
              style={styles.subAdd}
              accessibilityLabel={`Add a substitute for ${item.name}`}
            />
          </CollapsibleField>
        </View>
      ),
    },
    {
      key: 'usedIn',
      label: 'Used in',
      keywords: ['recipes', 'recipe', 'meal'],
      node: (
        <View onLayout={(e: LayoutChangeEvent) => {
          fieldYRefs.current.usedIn = e.nativeEvent.layout.y;
          maybeScrollToInitialField();
        }}>
          {/* The reverse of the sourceRecipeTitle link above: not where
              this row was first created from, but every recipe that calls
              for it right now, via recipesUsingIngredient. Read-only — a
              recipe's ingredients are edited on the recipe itself. */}
          <CollapsibleField
            label="Used in"
            summary={usedInSummary}
            emptySummary="No recipes yet"
            hint="Every recipe on your list that calls for this. Editing the ingredient happens on the recipe itself."
            expanded={openField === 'usedIn'}
            onToggle={() => toggleField('usedIn')}
          >
            {usedInRecipes.map((r, i) => (
              onOpenRecipe ? (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.subRow, i > 0 && styles.subRowDivided]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => onOpenRecipe(r.id)}
                  accessibilityRole="button"
                  accessibilityLabel={r.name}
                  accessibilityHint="Closes this and opens the recipe"
                >
                  <View style={styles.subBody}>
                    <Text style={styles.subName} numberOfLines={1}>{r.name}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : (
                <View key={r.id} style={[styles.subRow, i > 0 && styles.subRowDivided]}>
                  <View style={styles.subBody}>
                    <Text style={styles.subName} numberOfLines={1}>{r.name}</Text>
                  </View>
                </View>
              )
            ))}
          </CollapsibleField>
        </View>
      ),
    },
  ];
  const visibleCollapsibleRows = filterEditorRows(collapsibleRows, searchTerms);

  const totalMatches = searching
    ? [nameVisible, brandVisible, variantVisible, quantityVisible, priceVisible, noteVisible,
        useUpTaskVisible, removeFromListVisible, mergeVisible, forgetVisible].filter(Boolean).length
      + visibleCollapsibleRows.length
    : 0;

  // ==== render. Everything below is JSX ====
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={toggleSearch}
            hitSlop={8}
            style={styles.headerSearchButton}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Close field search' : 'Find a field'}
            accessibilityState={{ expanded: searchOpen }}
          >
            <Ionicons
              name={searchOpen ? 'close' : 'search'}
              size={iconSize.sm}
              color={searchOpen ? colors.accent : colors.textSecondary}
            />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Item</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {searchOpen && (
            <SearchField
              style={styles.fieldSearch}
              placeholder="Find a field"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              accessibilityLabel="Find a field"
            />
          )}
          {searching && totalMatches === 0 && (
            <Text style={styles.searchEmpty}>No fields match “{searchQuery.trim()}”.</Text>
          )}

          {nameVisible && (
          <>
          <Text style={styles.label}>NAME</Text>
          <TextInput
            style={[styles.input, !!nameError && styles.inputError]}
            value={name}
            onChangeText={t => {
              setName(t);
              if (nameError) setNameError(null);
            }}
            onBlur={commitName}
            onSubmitEditing={commitName}
            placeholder="Item name"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Item name"
          />
          {!!nameError && <Text style={styles.error}>{nameError}</Text>}
          {/* A snapshot, not editable here — see GroceryItem.sourceRecipeTitle.
              Renaming the item doesn't touch it, and there's nothing to
              reassign; it just says why this row exists. */}
          {!!item.sourceRecipeTitle && (
            item.sourceRecipeId && onOpenRecipe && recipeExists?.(item.sourceRecipeId) ? (
              <TouchableOpacity
                style={styles.recipeLink}
                activeOpacity={interaction.activeOpacity}
                onPress={() => onOpenRecipe(item.sourceRecipeId!)}
                accessibilityRole="button"
                accessibilityLabel={`Open the recipe ${item.sourceRecipeTitle}`}
                accessibilityHint="Closes this and opens the recipe"
              >
                <Ionicons name="restaurant-outline" size={iconSize.sm} color={colors.accent} />
                <Text style={styles.recipeLinkText} numberOfLines={1}>
                  From the recipe “{item.sourceRecipeTitle}”
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.hint}>From the recipe “{item.sourceRecipeTitle}”</Text>
            )
          )}
          {/* The either/or this row is one option of, and the way out of it.
              Unlinking is offered here rather than on the row because it's a
              correction, not a shopping decision — at the shelf you resolve the
              choice by ticking one (see resolveChoice), and that needs no
              second control. */}
          {!!alternativeNames && (
            <View style={styles.choiceBlock}>
              <Text style={styles.hint}>
                Either/or with {alternativeNames}. Tick one at the store and the
                rest come off the list.
              </Text>
              <InlineAction
                label="Not an either/or"
                icon="unlink-outline"
                variant="neutral"
                surface="page"
                onPress={() => {
                  haptics.tap();
                  clearChoice(item.id);
                }}
              />
            </View>
          )}
          </>
          )}

          {quantityVisible && (
          <>
          <Text style={styles.label}>QUANTITY</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantityText}
            onBlur={commitQuantity}
            placeholder="e.g. 2 lb, x3, a bunch"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_QUANTITY_MAX_LENGTH}
            accessibilityLabel="Quantity"
          />
          </>
          )}

          {priceVisible && (
          <>
          {/* The pills qualify the label and sit above the field, so the field
              always reads as the price of whatever is selected. Below it they'd
              be indistinguishable from the Stores grid further down, which
              *links* a store rather than pointing this field at one — and a
              third grey caption under the field is what the note below is
              already guarding against. With no linked stores there's nothing to
              choose between, so the row doesn't render at all. */}
          <Text style={styles.label}>{linkedShops.length > 0 ? 'LAST PRICE AT' : 'LAST PRICE'}</Text>
          {linkedShops.length > 0 && (
            <View style={styles.priceTargets}>
              <PillGroup options={priceTargetOptions} noun="store" surface="page" />
            </View>
          )}
          <View style={styles.priceField}>
            <Text style={styles.priceSymbol}>{currencySymbol}</Text>
            <TextInput
              style={styles.priceInput}
              value={price}
              onChangeText={text =>
                setPriceEdits(prev => ({ ...prev, [priceKey]: formatPriceInput(text) }))
              }
              onBlur={() => commitPrice(priceKey)}
              onSubmitEditing={() => commitPrice(priceKey)}
              placeholder={priceHint === null ? '0.00' : priceToInput(priceHint)}
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
              maxLength={PRICE_INPUT_MAX_LENGTH}
              accessibilityLabel={targetShopName ? `Last price at ${targetShopName}` : 'Last price'}
            />
            {/* Same clear affordance as SearchField's — emptying the field is
                already how a price gets removed on Save (see handleSave), this
                just saves reaching for backspace on a long mistyped number. */}
            {price.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  haptics.tap();
                  setPriceEdits(prev => ({ ...prev, [priceKey]: '' }));
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  targetShopName ? `Clear price at ${targetShopName}` : 'Clear price'
                }
              >
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
          {/* What the number is *for* and how old it is — never the number
              itself, which the field above is already showing.

              Item-level, so it's dropped while the field is pointed at a store:
              sitting under a field reading Costco's $3.19, "Last paid for 2 L"
              reads as describing that, when it's the last paid anywhere. The
              store line below already names the selected store and its price,
              which is the context that belongs there — and rewording this one
              per target would be a second phrasing of the same fact to keep
              true. */}
          {!!priceContext && activeTarget === null && (
            <Text style={styles.hint}>{priceContext}</Text>
          )}
          {/* The one arithmetic verdict on the stored price: the lowest ever
              paid, close to usual, or a real step from it. Judged against the
              same run priceContext is already reporting the age of, so it
              tracks the field the same way — dropped for the same reason
              whenever it has nothing to say. */}
          {!!priceStandingText && <Text style={styles.hint}>{priceStandingText}</Text>}
          {!!shopPriceLine && <Text style={styles.hint}>{shopPriceLine}</Text>}
          </>
          )}

          {noteVisible && (
          <>
          <Text style={styles.label}>NOTE</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNoteText}
            onBlur={commitNote}
            placeholder="e.g. the blue cap one"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Note"
          />
          </>
          )}

          {/* Collapsed by default, like every other editor in the app. These
              three grids used to render in full — sixteen aisles and one pill
              per store — which pushed the name/quantity/note fields this sheet
              exists to edit off the first screen.

              Filtered by field search the same way EditorGroup's rows are:
              each of the six carries its own label and keywords, and a query
              with no hit among them collapses the whole card rather than
              leaving it standing empty. */}
          {visibleCollapsibleRows.length > 0 && (
            <View
              style={styles.card}
              onLayout={(e: LayoutChangeEvent) => {
                cardYRef.current = e.nativeEvent.layout.y;
                maybeScrollToInitialField();
              }}
            >
              {visibleCollapsibleRows.map((row, i) => (
                <React.Fragment key={row.key}>
                  {i > 0 && <View style={styles.separator} />}
                  {row.node}
                </React.Fragment>
              ))}
            </View>
          )}

          {/* The per-item half of the setting, and the only place it can be
              said. Shown whenever there's a date to hang a task off, with the
              feature off as well as on: opting one item in is what makes a
              default-off setting workable, and deleting the task the other way
              records the same answer inverted (see GroceryItem.useUpTask). */}
          {useUpTaskVisible && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                haptics.tap();
                setUseUpTask(item.id, !hasUseUpTask);
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: hasUseUpTask }}
              accessibilityLabel="Use-up task"
              accessibilityHint={
                hasUseUpTask
                  ? 'Removes the task to use this up'
                  : 'Adds a task to use this up before its use-by date'
              }
            >
              <Ionicons
                name={hasUseUpTask ? 'checkbox' : 'square-outline'}
                size={iconSize.md}
                color={hasUseUpTask ? colors.accent : colors.textSecondary}
              />
              <View style={styles.actionBody}>
                <Text style={styles.actionLabel}>Use-up task</Text>
                <Text style={styles.actionHint}>
                  {hasUseUpTask
                    ? 'A task to use this up appears before the use-by date.'
                    : 'No task for this item, whatever the setting says.'}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {removeFromListVisible && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => {
                removeFromList(item.id);
                haptics.tap();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove from list"
            >
              <Ionicons name="remove-circle-outline" size={iconSize.md} color={colors.textSecondary} />
              <View style={styles.actionBody}>
                <Text style={styles.actionLabel}>Remove from list</Text>
                {/* The hint has to say which of the two things this does — a
                    provisional row is deleted outright, and finding that out
                    afterwards is the whole surprise this copy exists to avoid. */}
                <Text style={styles.actionHint}>
                  {item.inCatalog
                    ? 'Keeps it in your catalog for next time.'
                    : 'It isn’t in your catalog yet, so this forgets it entirely.'}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {mergeVisible && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setMergeSheetOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel="Merge with another item"
            >
              <Ionicons name="git-merge-outline" size={iconSize.md} color={colors.textSecondary} />
              <View style={styles.actionBody}>
                <Text style={styles.actionLabel}>Merge with another item</Text>
                <Text style={styles.actionHint}>
                  For a duplicate under a different name — combines the two into one.
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {forgetVisible && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={interaction.activeOpacity}
              onPress={handleForgetItem}
              accessibilityRole="button"
              accessibilityLabel="Forget this item"
            >
              <Ionicons name="trash-outline" size={iconSize.md} color={colors.red} />
              <View style={styles.actionBody}>
                <Text style={[styles.actionLabel, { color: colors.red }]}>Forget this item</Text>
                <Text style={styles.actionHint}>
                  Deletes it and its history. There&apos;s no undo.
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* describeShops owns the wording because it also owns the rule that
              the item's count is the total and the per-store ones are partial —
              a trip finished without naming a store bumps one and not the
              other, so nothing here may reconcile them. */}
          {!!summary && <Text style={styles.footnote}>{summary}.</Text>}
        </ScrollView>
      </View>

      {/* Rendered inside this Modal rather than beside it, for the reason
          BuyAgainSheet nests this sheet: a Modal presents from the view
          controller its React parent belongs to, so a sibling would be asking
          the screen's controller to present a second sheet while this one is
          already up. */}
      <ProductSheet
        visible={productSheet !== null}
        itemId={item.id}
        editingProductId={productSheet === 'add' ? null : productSheet}
        onClose={() => setProductSheet(null)}
      />
      <SubstituteSheet
        visible={subSheet !== null}
        itemId={item.id}
        editingSubItemId={subSheet === 'add' ? null : subSheet}
        onClose={() => setSubSheet(null)}
      />
      <MergeItemSheet
        visible={mergeSheetOpen}
        itemId={item.id}
        onClose={() => setMergeSheetOpen(false)}
        onMerged={survivorId => {
          setMergeSheetOpen(false);
          // The row this sheet is open for lost the merge — nothing left to
          // show, so the whole sheet closes rather than rendering over a
          // deleted item.
          if (survivorId !== item.id) onClose();
        }}
      />
    </Modal>
  );
}

/**
 * The row's sub-line: the ratio, then the caveat, then the direction. All
 * three are qualifications of the name above them — "both ways" is worth
 * saying because the link is directional, without it there's no way to tell a
 * pair the user ticked from one they didn't, short of opening the other item.
 */
function subCaption(sub: Substitute): string | null {
  const ratio = sub.link.ratioFrom && sub.link.ratioTo
    ? `${sub.link.ratioFrom} → ${sub.link.ratioTo}`
    : null;
  // First, and stated as what it does rather than as a setting's name: it's
  // the one thing in this row that changes what a recipe shops for, so a
  // reader skimming the field has to meet it before the caveats.
  const parts = [
    sub.link.standing ? 'always used instead' : null,
    ratio,
    sub.link.note,
    sub.isMutual ? 'both ways' : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    // Same 64 width the plain spacer held, now the field-search toggle — still
    // matches Done's own minWidth, so the title stays centered the way
    // GroceryAislesSheet's single-button header does.
    headerSearchButton: { width: 64, alignItems: 'center', justifyContent: 'center' },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    // Between rows only, so the first one sits flush under the field's hint
    // the way the pill grids in the fields above do.
    subRowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    subBody: { flex: 1 },
    subName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    // The tick sits beside the name rather than at the row's trailing edge,
    // where the chevron already is — two glyphs at the same end read as one
    // control with a decoration on it.
    productNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    subMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    // Clears the last row, and gives the field's own bottom padding something
    // to sit under rather than jamming the pill against the separator below.
    subAdd: { marginTop: spacing.sm, alignSelf: 'flex-start' },
    productActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    // No marginHorizontal on either — `body`'s own padding already insets them.
    fieldSearch: { marginBottom: spacing.md },
    searchEmpty: { color: colors.textTertiary, fontSize: font.sm, marginBottom: spacing.md },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: 'transparent',
      paddingHorizontal: spacing.md,
      fontSize: font.md,
      color: colors.text,
      // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
      // with no baseline compensation, so the glyphs sit low in the box.
      height: 44,
    },
    inputError: { borderColor: colors.red },
    // The same box as `input`, with the currency symbol living inside it so the
    // field reads as money before anything is typed into it.
    priceField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      height: 44,
    },
    priceTargets: { marginBottom: spacing.sm },
    // Margin on both sides it needs, not just the one that happened to matter:
    // the hint below has no top margin of its own.
    brandStrictRow: { marginTop: spacing.sm, marginBottom: spacing.sm },
    brandAtBlock: { marginTop: spacing.sm },
    brandAtRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    // Fixed share of the row so the fields line up into a column rather than
    // stepping in and out with the length of each store's name.
    brandAtName: { flex: 1, fontSize: font.md, color: colors.text },
    brandAtInput: {
      flex: 1.4,
      // bgTertiary, not the bgSecondary the top-level `input` uses: these rows
      // sit *inside* the Stores card, which is itself bgSecondary, so the field
      // would be invisible against it in both themes. Same step up the row's
      // quantity pill takes over its own card.
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: font.md,
      color: colors.text,
      // Same rule as `input` above — never lineHeight on a TextInput.
      height: 40,
    },
    priceSymbol: { color: colors.textSecondary, fontSize: font.md },
    // No lineHeight, same as `input` — see the note there.
    priceInput: { flex: 1, fontSize: font.md, color: colors.text, padding: 0 },
    error: { fontSize: font.sm, color: colors.red, marginTop: spacing.xs },
    hint: { fontSize: font.sm, color: colors.textTertiary, marginBottom: spacing.sm },
    choiceBlock: { alignItems: 'flex-start', marginBottom: spacing.sm },
    // A row rather than bare accent text: this leaves the sheet for another
    // screen, and the chevron is what says so (same shape EditorRow uses).
    recipeLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      marginBottom: spacing.xs,
    },
    recipeLinkText: { flex: 1, fontSize: font.sm, color: colors.accent },
    // The three pickers share one card, so they read as a list of settings
    // rather than three floating grids — matching the editors' CollapsibleField
    // cards, whose dividers run full-width for want of an icon column.
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      marginTop: spacing.md,
      overflow: 'hidden',
    },
    separator: { height: border.hairline, backgroundColor: colors.separator },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    stepperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    stepperHint: { flex: 1, fontSize: font.sm, color: colors.textTertiary },
    actionBody: { flex: 1 },
    actionLabel: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    actionHint: { fontSize: font.sm, color: colors.textTertiary, marginTop: 2 },
    footnote: {
      fontSize: font.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
  });
}
