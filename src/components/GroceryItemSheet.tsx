import React, { useMemo, useState, useEffect } from 'react';
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
import { SheetHeaderButton } from './SheetHeaderButton';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { describeShops, shopsForItem, unavailableShopsFor } from '../utils/groceryShops';
import {
  cheapestShopFor,
  describePriceContext,
  describeShopPrices,
  lastPriceFor,
  parsePriceInput,
  priceToInput,
  shopPricesFor,
} from '../utils/groceryPrice';
import { defaultOnHandUntil, OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
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
   * whole reason for opening the sheet is that field — PantrySheet, where the
   * row you tapped is a pantry row and "Out of it" is what you came to say.
   * Left closed by default: a long-press from the list has no such subject, and
   * a sheet that opens with a section unfolded for no reason is the progressive
   * disclosure these editors exist to avoid.
   */
  initialField?: 'aisle' | 'stores' | 'pantry' | 'useBy';
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  const renameItem = useGroceryStore(s => s.renameItem);
  const setQuantity = useGroceryStore(s => s.setQuantity);
  const setNote = useGroceryStore(s => s.setNote);
  const setBrand = useGroceryStore(s => s.setBrand);
  const setVariant = useGroceryStore(s => s.setVariant);
  const setBrandStrict = useGroceryStore(s => s.setBrandStrict);
  const setBrandUnavailable = useGroceryStore(s => s.setBrandUnavailable);
  const setAisle = useGroceryStore(s => s.setAisle);
  const addAisle = useGroceryStore(s => s.addAisle);
  const setOnHandUntil = useGroceryStore(s => s.setOnHandUntil);
  const setStaple = useGroceryStore(s => s.setStaple);
  const setExpiresAt = useGroceryStore(s => s.setExpiresAt);
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

  const [name, setName] = useState('');
  const [quantity, setQuantityText] = useState('');
  const [brand, setBrandText] = useState('');
  const [variant, setVariantText] = useState('');
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
  // One picker open at a time, like every other editor in the app — see the
  // progressive-disclosure note in CLAUDE.md.
  const [openField, setOpenField] = useState<'aisle' | 'stores' | 'pantry' | 'useBy' | null>(null);

  useEffect(() => {
    if (visible && item) {
      setName(item.name);
      setQuantityText(item.quantity ?? '');
      setBrandText(item.brand ?? '');
      setVariantText(item.variant ?? '');
      setNoteText(item.note);
      setPriceTarget(null);
      setPriceEdits({});
      setNameError(null);
      setOpenField(initialField ?? null);
    }
  }, [visible, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleField = (field: 'aisle' | 'stores' | 'pantry' | 'useBy') =>
    setOpenField(current => (current === field ? null : field));
  const closeField = () => {
    animateLayout();
    setOpenField(null);
  };

  if (!item) {
    return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} />;
  }

  const linkFor = (shopId: string) =>
    itemShops.find(l => l.itemId === item.id && l.shopId === shopId) ?? null;

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== item.name) {
      // renameItem refuses a collision rather than merging two catalog rows —
      // merging means choosing whose purchase history survives.
      if (!renameItem(item.id, trimmed)) {
        setNameError('Another item already has that name.');
        haptics.error();
        return;
      }
    }
    setQuantity(item.id, quantity);
    setBrand(item.id, brand);
    setVariant(item.id, variant);
    setNote(item.id, note);
    // After setQuantity, so a price being *changed* here is paired with the
    // quantity being saved alongside it. A price left alone keeps the quantity
    // it was recorded against, which is the point: retyping the quantity
    // doesn't retroactively make an old price a price for the new one.
    //
    // An emptied field clears the price; anything that doesn't parse is left
    // alone rather than clearing it, since "4.9.9" is a typo mid-correction and
    // throwing the old price away over it is the one outcome nobody wants.
    //
    // Every target that was typed into, not just the one on screen — the buffer
    // outlives switching stores, so Save is where all of it lands. The item's
    // own price goes last: a store write updates it as a side effect (see
    // setItemPrice), and an explicit "Any store" edit is the more direct
    // statement of the two, so it has to win.
    const edits = Object.entries(priceEdits).sort(
      ([a], [b]) => Number(a === ITEM_PRICE_KEY) - Number(b === ITEM_PRICE_KEY)
    );
    for (const [key, raw] of edits) {
      const shopId = key === ITEM_PRICE_KEY ? null : key;
      const link = shopId ? linkFor(shopId) : null;
      // A store unlinked in this same sheet since the price was typed has
      // nowhere to put it, and it isn't an item-level price either — the user
      // said which store it was.
      if (shopId && !link) continue;
      const stored = shopId ? link!.lastPriceMinor : item.lastPriceMinor;
      const trimmedPrice = raw.trim();
      const parsed = parsePriceInput(trimmedPrice);
      if (!trimmedPrice) {
        if (stored === null) continue;
        // Clearing one store's number says nothing about the item — that's the
        // whole reason clearItemShopPrice exists next to setItemPrice.
        if (shopId) clearItemShopPrice(item.id, shopId);
        else setItemPrice(item.id, null);
      } else if (parsed !== null && parsed !== stored) {
        setItemPrice(item.id, parsed, shopId);
      }
    }
    haptics.success();
    onClose();
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

  const priceTargetOptions: PillGroupOption[] = [
    {
      key: ITEM_PRICE_KEY,
      label: 'Any store',
      // Never buried behind "N more" — it's the option meaning "I'm not saying
      // where", and the one the field defaults to.
      pinned: true,
      selected: activeTarget === null,
      accessibilityLabel: 'Price paid, without saying which store',
      onPress: () => {
        haptics.tap();
        setPriceTarget(null);
      },
    },
    ...linkedShops.map(({ shop }) => ({
      key: shop.id,
      label: shop.name,
      selected: activeTarget === shop.id,
      accessibilityLabel: `Price at ${shop.name}`,
      onPress: () => {
        haptics.tap();
        setPriceTarget(shop.id);
      },
    })),
  ];

  // A future onHandUntil is an active "Got it"; a past one (always
  // OUT_OF_IT_UNTIL in practice) is an active "Out of it"; null leaves the
  // pantry guess deciding — see GroceryItem.onHandUntil.
  const onHandFuture = !!item.onHandUntil && new Date(item.onHandUntil).getTime() >= Date.now();
  const onHandPast = !!item.onHandUntil && !onHandFuture;
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
  const toggleStaple = () => {
    haptics.tap();
    setStaple(item.id, !item.isStaple);
  };

  // The stepper talks in days from today and the row stores a day; a date
  // survives the app being closed for a week, where "5 days" would quietly
  // mean five days from whenever you next looked. Same conversion
  // keepUntilKeyFor/keepDaysBetween do for a leftover.
  const expiryDays = item.expiresAt ? expiryDaysFromNow(item.expiresAt, new Date()) : null;
  const pickExpiryDays = (days: number | null) => {
    haptics.tap();
    setExpiresAt(item.id, days === null ? null : expiryKeyFor(new Date(), days));
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
      `${count} ${count === 1 ? 'purchase' : 'purchases'} recorded here. Forgetting them can’t be undone — the item and its overall count stay either way.`,
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

  const confirmDelete = () => {
    Alert.alert(
      `Forget ${item.name}?`,
      // No pointer at "Remove from list" for a provisional row: it does the
      // same thing there, so offering it as the gentler option is a lie.
      item.inCatalog
        ? 'This removes it from your catalog along with its history, and can’t be undone. To just take it off this week’s list, use "Remove from list".'
        : 'This removes it altogether, and can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            deleteItem(item.id);
            haptics.warning();
            onClose();
          },
        },
      ]
    );
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

  const brandStrictOptions: PillGroupOption[] = [
    {
      key: 'strict',
      label: 'Only this brand',
      selected: item.brandStrict,
      accessibilityLabel: item.brandStrict
        ? `Only ${item.brand}, on. Stores carrying another brand don’t count as having this. Tap to turn off.`
        : `Only ${item.brand} — count only stores recorded as carrying it`,
      onPress: () => {
        haptics.tap();
        setBrandStrict(item.id, !item.brandStrict);
      },
    },
  ];

  /**
   * "Which stores haven't got it" — the claim, one pill per store, multi-select.
   *
   * Every store is offered, not just the linked ones: finding out a shop hasn't
   * got your brand is a thing that happens at a shop you've never recorded this
   * item at. The ones already marked as not stocking the item at all are left
   * out, since that claim outranks this one and saying both is contradictory.
   *
   * Deliberately a claim rather than a "which brand do they carry" field. The
   * app can only ever know the brand you last *got* somewhere, and a shelf
   * holds several brands at once, so a recorded brand can never stand in for
   * this — see groceryShops.lacksWantedBrand.
   */
  const brandNegativeOptions: PillGroupOption[] = shops
    .filter(s => !notStocked.has(s.id))
    .map(shop => {
      const marked = linkFor(shop.id)?.brandUnavailableAt != null;
      return {
        key: shop.id,
        label: shop.name,
        selected: marked,
        negative: marked,
        accessibilityLabel: marked
          ? `${shop.name}, marked as not having ${item.brand}. Tap to clear.`
          : `${shop.name}. Tap to say they haven’t got ${item.brand}.`,
        onPress: () => {
          haptics.tap();
          setBrandUnavailable(item.id, shop.id, !marked);
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
        : 'Always have it — mark as a staple you always keep stocked',
      onPress: toggleStaple,
    },
    {
      key: 'got',
      label: 'Got it',
      selected: onHandFuture,
      accessibilityLabel: onHandFuture
        ? 'Got it, marked on hand. Tap to clear.'
        : 'Got it — mark as on hand',
      onPress: onHandFuture ? clearOnHand : markGotIt,
    },
    {
      key: 'out',
      label: 'Out of it',
      selected: onHandPast,
      accessibilityLabel: onHandPast
        ? 'Out of it, marked not on hand. Tap to clear.'
        : 'Out of it — mark as not on hand',
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Item</Text>
          <SheetHeaderButton label="Save" onPress={handleSave} minWidth={64} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>NAME</Text>
          <TextInput
            style={[styles.input, !!nameError && styles.inputError]}
            value={name}
            onChangeText={t => {
              setName(t);
              if (nameError) setNameError(null);
            }}
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
                  recipe: {item.sourceRecipeTitle}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.hint}>recipe: {item.sourceRecipeTitle}</Text>
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
                Either/or with {alternativeNames}. Tick one at the shop and the
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

          {/* Directly under the name, because it qualifies the name — this is
              the half of "what am I buying" that deliberately stays out of it
              so the name keeps matching recipes and purchase history. Left
              empty it clears back to no preference. */}
          <Text style={styles.label}>BRAND</Text>
          <TextInput
            style={styles.input}
            value={brand}
            onChangeText={setBrandText}
            placeholder="Any brand"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_BRAND_MAX_LENGTH}
            accessibilityLabel="Brand"
          />
          <Text style={styles.hint}>
            Shown on the list so you know which one to get.
          </Text>
          {/* Off by default and only offered once there's a brand to be strict
              about — see GroceryItem.brandStrict. It's a pill rather than a
              switch for the same reason "Always have it" is one: it's a
              one-word state on the item, and the pantry row two fields down
              already spells that idiom in this sheet. */}
          {!!item.brand && (
            <>
              <View style={styles.brandStrictRow}>
                <PillGroup options={brandStrictOptions} noun="option" />
              </View>
              <Text style={styles.hint}>
                {item.brandStrict
                  ? 'Stores you’ve marked as not having it won’t count as having this. Mark them under Stores.'
                  : 'Off, so every store that stocks this counts, whichever brand it has.'}
              </Text>
            </>
          )}

          {/* After the whole brand block rather than between the field and its
              pill: "Only this brand" qualifies the field above it and reads as
              a stray question with another field wedged in between. With no
              brand set — the common case — the pill doesn't render and this
              does sit directly under BRAND.

              A separate field rather than more room in BRAND, because the two
              are different facts: see GroceryItem.variant. On the list they
              compose into the one caption. */}
          <Text style={styles.label}>VARIANT</Text>
          <TextInput
            style={styles.input}
            value={variant}
            onChangeText={setVariantText}
            placeholder="Low fat, 4%, crunchy…"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_VARIANT_MAX_LENGTH}
            accessibilityLabel="Variant"
          />
          <Text style={styles.hint}>
            Shown on the list, after the brand.
          </Text>

          <Text style={styles.label}>QUANTITY</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantityText}
            placeholder="2 lb, x3, a bunch…"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_QUANTITY_MAX_LENGTH}
            accessibilityLabel="Quantity"
          />

          {/* The pills qualify the label and sit above the field, so the field
              always reads as the price of whatever is selected. Below it they'd
              be indistinguishable from the Stores grid further down, which
              *links* a store rather than pointing this field at one — and a
              third grey caption under the field is what the note below is
              already guarding against. With no linked stores there's nothing to
              choose between, so the row doesn't render at all. */}
          <Text style={styles.label}>{linkedShops.length > 0 ? 'PRICE AT' : 'PRICE'}</Text>
          {linkedShops.length > 0 && (
            <View style={styles.priceTargets}>
              <PillGroup options={priceTargetOptions} noun="store" />
            </View>
          )}
          <View style={styles.priceField}>
            <Text style={styles.priceSymbol}>{currencySymbol}</Text>
            <TextInput
              style={styles.priceInput}
              value={price}
              onChangeText={text => setPriceEdits(prev => ({ ...prev, [priceKey]: text }))}
              placeholder={priceHint === null ? '0.00' : priceToInput(priceHint)}
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              maxLength={PRICE_INPUT_MAX_LENGTH}
              accessibilityLabel={targetShopName ? `Price at ${targetShopName}` : 'Price'}
            />
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
          {!!shopPriceLine && <Text style={styles.hint}>{shopPriceLine}</Text>}

          <Text style={styles.label}>NOTE</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNoteText}
            placeholder="The blue cap one"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            accessibilityLabel="Note"
          />

          {/* Collapsed by default, like every other editor in the app. These
              three grids used to render in full — sixteen aisles and one pill
              per store — which pushed the name/quantity/note fields this sheet
              exists to edit off the first screen. */}
          <View style={styles.card}>
            <CollapsibleField
              label="Aisle"
              summary={item.aisle}
              hint="Groups this item on your list, in the order you walk the shop."
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

            <View style={styles.separator} />

            <CollapsibleField
              label="Stores"
              summary={storesSummary}
              emptySummary="Any"
              hint="Tap a store to say you can get this there, again to say they don’t have it. Finishing a shop marks them for you."
              expanded={openField === 'stores'}
              onToggle={() => toggleField('stores')}
            >
              <PillGroup options={shopOptions} noun="store" onCreate={handleCreateShop} />
              {/* Only while a brand rule is actually in force. Without one
                  these claims would be recording evidence nothing reads, and
                  the sheet is already dense — the pills above are what a person
                  comes to Stores for. */}
              {item.brandStrict && !!item.brand && (
                <View style={styles.brandAtBlock}>
                  <Text style={styles.label}>
                    {`Haven’t got ${item.brand}`.toUpperCase()}
                  </Text>
                  <PillGroup options={brandNegativeOptions} noun="store" />
                  {/* The rule that makes the whole feature safe, said where
                      someone is about to rely on it. */}
                  <Text style={styles.hint}>
                    Only what you’ve marked here is left out. A store you haven’t
                    marked still counts — shops carry several brands, so getting a
                    different one somewhere isn’t knowing they haven’t got yours.
                  </Text>
                </View>
              )}
            </CollapsibleField>

            <View style={styles.separator} />

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
                    ? 'Marked out of it — won’t show as probably-have until you buy it again.'
                    : 'Decided automatically from purchase history when this comes up in a week plan.'
              }
              expanded={openField === 'pantry'}
              onToggle={() => toggleField('pantry')}
            >
              <PillGroup options={pantryOptions} noun="state" />
            </CollapsibleField>

            <View style={styles.separator} />

            <CollapsibleField
              label="Use by"
              summary={
                item.expiresAt
                  ? `${format(dayKeyToDate(item.expiresAt), 'd MMM')} · ${describeExpiry(item.expiresAt)}`
                  : undefined
              }
              emptySummary="None"
              hint="The day this should be used up by. Finishing a shop fills it in for things that go off, and the use-up task is dated from it."
              expanded={openField === 'useBy'}
              onToggle={() => toggleField('useBy')}
            >
              <View style={styles.stepperRow}>
                <Text style={styles.stepperHint}>Days from today</Text>
                <CountStepper
                  value={expiryDays}
                  onChange={pickExpiryDays}
                  min={0}
                  max={GROCERY_EXPIRY_DAYS_MAX}
                  allowNull
                  emptyLabel="None"
                  format={n => (n === 0 ? 'Today' : `${n}d`)}
                  label="Use by"
                  describeValue={n => (n === null ? 'No use-by date' : n === 0 ? 'Use by today' : `${n} days from today`)}
                />
              </View>
            </CollapsibleField>
          </View>

          {/* The per-item half of the setting, and the only place it can be
              said. Shown whenever there's a date to hang a task off, with the
              feature off as well as on: opting one item in is what makes a
              default-off setting workable, and deleting the task the other way
              records the same answer inverted (see GroceryItem.useUpTask). */}
          {!!item.expiresAt && (
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

          {item.onList && (
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

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={interaction.activeOpacity}
            onPress={confirmDelete}
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

          {/* describeShops owns the wording because it also owns the rule that
              the item's count is the total and the per-store ones are partial —
              a trip finished without naming a store bumps one and not the
              other, so nothing here may reconcile them. */}
          {!!summary && <Text style={styles.footnote}>{summary}.</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
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
    body: { padding: spacing.md, paddingBottom: spacing.xl },
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
