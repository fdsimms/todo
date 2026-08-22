import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
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
  checkboxRadius,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PillGroup } from './PillGroup';
import { SegmentedControl } from './SegmentedControl';
import { WhenPicker } from './WhenPicker';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { extractReceipt, describeAIError, type ExtractedReceipt } from '../services/aiSuggestions';
import {
  acceptedByDefault,
  isPlausibleReceiptDate,
  matchReceiptLines,
  matchReceiptShop,
  receiptCautionsFor,
  type ReceiptCaution,
  type ReceiptMatch,
} from '../utils/receiptMatch';
import { formatPrice, typicalPriceFor } from '../utils/groceryPrice';
import { ReceiptPricePairing } from './ReceiptPricePairing';
import { autoPairing, pricesByItemId, type Pairing } from '../utils/pricePairing';
import { formatScheduledDate } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { SHOP_NAME_MAX_LENGTH, type ReceiptStyle } from '../types';

/**
 * One "Left alone" line the user opted to add as bought instead — either
 * promoting an existing off-list catalog row or minting a new one. Handed to
 * `onApply` alongside the matched rows; nothing is written from this sheet
 * (see the component doc comment), so `GroceryScreen` is where these actually
 * become catalog rows (#1805).
 */
export interface ReceiptAddDraft {
  /** An existing catalog row to promote back onto the list, or null to mint a new one from `name`. */
  existingItemId: string | null;
  /** The line's shopper-normalized name — what a minted row is named. */
  name: string;
  /** The line exactly as printed, passed through as the raw text a new row is added from. */
  label: string;
  /**
   * Who makes it, when the source said so — recorded as the minted row's first
   * `ItemProduct`.
   *
   * Always null from a receipt, which prints a store's own shorthand for a
   * product and never its maker. It is on the shared draft rather than a
   * scan-only one because the two paths mint rows through the same handler, and
   * a second draft type would only be this field's absence.
   */
  brand: string | null;
  quantity: string;
  priceMinor: number | null;
}

/** Matches the shopping list's own checkbox, so the shape reads as familiar. */
const CHECK_SIZE = 22;

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Hands the confirmed reading back to the screen: which store, which rows to
   * check off, and what each of them cost.
   *
   * Deliberately does *not* finish the trip. This sheet reads a receipt; the
   * finish sheet ends a shop, and it also asks the one question a receipt can't
   * answer — which of the leftovers the store didn't have. Ending the trip from
   * here would either skip that question or duplicate it.
   */
  onApply: (
    shopId: string | null,
    itemIds: string[],
    priceById: Record<string, number>,
    purchasedAt: string,
    toAdd: ReceiptAddDraft[],
  ) => void;
}

/**
 * Reading a store receipt into the shopping list: what to check off, what it
 * cost, and where you were.
 *
 * Every one of those three was already recordable by hand in the finish sheet,
 * and in practice the prices never were — a per-row price for a forty-row shop
 * is more typing than anyone does while unpacking bags. The receipt already has
 * all of it, so this is an *input method* for the finish sheet rather than a
 * new place a trip can end.
 *
 * **Nothing is written from here.** The confirm hands its answers to
 * `GroceryScreen`, which ticks the rows and opens the finish sheet with the
 * store and the prices filled in. The user then finishes the shop exactly as
 * they always have, with one more chance to see what's about to be recorded.
 * Two confirms sounds like one too many until you look at what the second one
 * is guarding: `finishShopping` takes the whole list off in one pass.
 *
 * **A weak match is shown but never pre-checked.** The tiers come from
 * `receiptMatch.ts`; what this sheet adds is that the difference is *visible* —
 * an unchecked row with "Is this…?" on it is a question, and a pre-checked one
 * is an assertion. Getting that backwards is how someone ends up having marked
 * chicken thighs bought because the receipt said breast.
 *
 * **What the receipt doesn't mention is not a claim about anything.** Lines
 * that match nothing are listed and ignored by default; list rows the receipt
 * never named are left exactly where they are, unticked. Same call
 * `FinishShoppingSheet` makes about a leftover — the usual reason something is
 * missing is that you didn't get to it. A left-alone line can still be added
 * as bought, but only if the user checks it (#1805) — nothing here decides
 * that on its own.
 *
 * **The purchase is dated when it actually happened, not when it's scanned.**
 * `receipt.date` seeds the date field below the store picker; an implausible
 * one (future, or far enough in the past to be suspicious) is shown as a
 * caution and defaulted back to today rather than trusted outright — see
 * `isPlausibleReceiptDate` (#1806). Either way it's editable, and it's what
 * every checked row — matched or added as bought — is dated with.
 */
export function ReceiptImportSheet({ visible, onClose, onApply }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const addShop = useGroceryStore(s => s.addShop);
  const setShopReceiptStyle = useGroceryStore(s => s.setShopReceiptStyle);
  const rememberAliases = useGroceryStore(s => s.rememberAliases);
  const aliasItemFor = useGroceryStore(s => s.aliasItemFor);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ExtractedReceipt | null>(null);
  const [matches, setMatches] = useState<ReceiptMatch[]>([]);
  /** Which matched rows are going to be checked off. Ids, not indices. */
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [shopId, setShopId] = useState<string | null>(null);
  /** When the trip happened — the receipt's own date once it's read, today until then. */
  const [purchasedDate, setPurchasedDate] = useState<Date>(new Date());
  /** Set once, on read, when the receipt named a date outside a sane range (#1806). */
  const [dateImplausible, setDateImplausible] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  /** "Left alone" rows opted in to "Add as bought", by index into `unclaimed` (#1805). */
  const [addAsBought, setAddAsBought] = useState<Set<number>>(new Set());
  /**
   * Which price on an opaque store's receipt belongs to which row. Empty until
   * the user pairs, or until `autoPairing` finds an ordering that is forced.
   */
  const [pairing, setPairing] = useState<Pairing>({});
  /** The row waiting for a price. Held here so a re-render doesn't drop it. */
  const [pairSelectedId, setPairSelectedId] = useState<string | null>(null);

  const input = useRecipeImportSource('photo', 'read a receipt');
  const { photo, reset: resetInput } = input;

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setReceipt(null);
    setMatches([]);
    setAccepted(new Set());
    setShopId(null);
    setPurchasedDate(new Date());
    setDateImplausible(false);
    setDatePickerOpen(false);
    setAddAsBought(new Set());
    setPairing({});
    setPairSelectedId(null);
    resetInput();
  }, [resetInput]);

  // Reset on close rather than on open, so a sheet that stays mounted doesn't
  // hand last week's receipt to this week's shop — same rule the finish sheet's
  // own reset follows.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const run = useCallback(async () => {
    if (!photo) return;
    setLoading(true);
    setError(null);
    try {
      const result = await extractReceipt(photo);
      setReceipt(result);
      // The store has to be resolved before the lines are, since an alias is
      // scoped to the printer that produced the text.
      const readShopId = matchReceiptShop(result.storeName, shops)?.id ?? null;
      setMatches(
        matchReceiptLines(result.lines, items, line => aliasItemFor(readShopId, line.label))
      );
      setShopId(readShopId);
      const now = new Date();
      const plausible = !!result.date && isPlausibleReceiptDate(result.date, now);
      // Noon rather than midnight, so the day it names can't slip across a
      // timezone boundary on the way to an ISO timestamp.
      setPurchasedDate(plausible ? new Date(`${result.date}T12:00:00`) : now);
      setDateImplausible(!!result.date && !plausible);
      if (result.lines.length > 0) haptics.success();
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [photo, items, shops, aliasItemFor]);

  /**
   * What arrives checked, re-decided whenever the reading or the named store
   * changes.
   *
   * The store is in here because the price check reads that store's own price
   * as its baseline, so the same receipt can be plausible at Costco and
   * suspicious at Safeway. Re-deciding does discard ticks made by hand, which
   * is the same call `FinishShoppingSheet` makes when its store changes: the
   * answers are about the store, so refiling them onto a different one would be
   * asserting something nobody said. In practice the store is set once off the
   * receipt's own header and never touched again.
   */
  useEffect(() => {
    setAccepted(new Set(acceptedByDefault(matches, items, shopId, itemShops)));
    // `items`/`itemShops` are deliberately not dependencies: this is a decision
    // about the receipt just read, and re-running it because an unrelated row
    // changed elsewhere would silently undo the user's review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, shopId]);

  const toggle = (itemId: string) => {
    haptics.tap();
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAddAsBought = (index: number) => {
    haptics.tap();
    setAddAsBought(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleApply = () => {
    if (opaque) {
      // Nothing was matched, so there is nothing to remember and nothing to add
      // as bought — an opaque line has no name to learn. The pairing is the
      // whole answer: these rows came home, and this is what each cost.
      haptics.success();
      onApply(
        shopId,
        Object.keys(pairing),
        pricesByItemId(pairing, pairPrices),
        purchasedDate.toISOString(),
        []
      );
      return;
    }
    const priceById: Record<string, number> = {};
    for (const match of matches) {
      if (!match.itemId || !accepted.has(match.itemId)) continue;
      if (match.line.priceMinor !== null) priceById[match.itemId] = match.line.priceMinor;
    }
    const toAdd: ReceiptAddDraft[] = matches
      .filter(m => m.itemId === null)
      .filter((_, i) => addAsBought.has(i))
      .map(m => ({
        existingItemId: m.offListMatchId,
        name: m.line.name,
        label: m.line.label,
        brand: null,
        quantity: m.line.quantity,
        priceMinor: m.line.priceMinor,
      }));
    // Everything the user is applying with a row attached, printed text and
    // all, so the same shorthand resolves without asking next time. Scoped to
    // the store, because that is whose printer wrote it. The "add as bought"
    // rows can only be remembered when they name an existing row — a line
    // minting a brand new item has no id yet, and #1856 leaves catching those
    // to the next receipt rather than plumbing ids back out of the screen.
    rememberAliases([
      ...matches
        .filter(m => m.itemId !== null && accepted.has(m.itemId))
        .map(m => ({ shopId, rawText: m.line.label, itemId: m.itemId as string })),
      ...toAdd
        .filter(d => d.existingItemId !== null)
        .map(d => ({ shopId, rawText: d.label, itemId: d.existingItemId as string })),
    ]);
    haptics.success();
    onApply(shopId, Array.from(accepted), priceById, purchasedDate.toISOString(), toAdd);
  };

  /** Returning the message rejects the name and holds the field open. */
  const handleAddShop = (name: string) => {
    const shop = addShop(name);
    if (!shop) return 'You already have a store with that name.';
    haptics.success();
    setShopId(shop.id);
  };

  const nameFor = (itemId: string) => items.find(i => i.id === itemId)?.name ?? '';

  const receiptStyleOf = (id: string): ReceiptStyle =>
    shops.find(s => s.id === id)?.receiptStyle ?? 'itemized';

  const RECEIPT_STYLE_OPTIONS: { value: ReceiptStyle; label: string }[] = [
    { value: 'itemized', label: 'Item names' },
    { value: 'opaque', label: 'Prices only' },
    { value: 'none', label: 'No receipt' },
  ];

  /**
   * Whether the store now selected prints prices without names.
   *
   * Derived from the *currently picked* store rather than settled once when the
   * receipt is read, so correcting the store switches the sheet's whole mode.
   * That is the coherent behaviour: the claim is about a printer, and picking a
   * different store is saying a different printer produced this paper.
   */
  const opaque = shops.find(s => s.id === shopId)?.receiptStyle === 'opaque';

  /**
   * The rows an opaque receipt's prices get paired onto: what's on the list
   * right now.
   *
   * The list is the right source rather than the receipt, because at an opaque
   * store the receipt has nothing on it to make rows *from* — that is the whole
   * problem. What the trip bought is either already ticked here or was scanned
   * in beforehand, and either way it is on the list.
   */
  const pairRows = useMemo(
    () => items.filter(i => i.onList).map(i => ({ id: i.id, name: i.name })),
    [items]
  );

  /** Every price the receipt charged, in printed order. */
  const pairPrices = useMemo(
    () => (receipt?.lines ?? [])
      .map(l => l.priceMinor)
      .filter((p): p is number => p !== null),
    [receipt]
  );

  // Runs once per (receipt, store) rather than on every pairing change, or it
  // would fight the user: clearing a pair they just undid would re-apply the
  // guess on the next render. Almost always a no-op — see `autoPairing`.
  useEffect(() => {
    if (!opaque || !receipt) return;
    setPairing(
      autoPairing(
        pairRows.map(row => {
          const item = items.find(i => i.id === row.id);
          return {
            id: row.id,
            baselineMinor: item ? typicalPriceFor(item, shopId, itemShops)?.minor ?? null : null,
          };
        }),
        pairPrices
      )
    );
    setPairSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opaque, receipt, shopId]);

  const claimed = matches.filter((m): m is ReceiptMatch & { itemId: string } => m.itemId !== null);
  const unclaimed = matches.filter(m => m.itemId === null);
  /**
   * What the checked rows add up to, matched or added as bought.
   *
   * Deliberately *not* reconciled against the receipt's own total — tax,
   * deposits and anything not on your list are all real parts of that number
   * and none of them become rows, so a gap is the normal case rather than a
   * sign the read went wrong. It's stated so a large gap is visible to someone
   * who knows what they bought, which is the only reader who can judge it.
   */
  const recordedMinor =
    matches.reduce(
      (sum, m) =>
        m.itemId && accepted.has(m.itemId) && m.line.priceMinor !== null
          ? sum + m.line.priceMinor
          : sum,
      0
    ) +
    unclaimed.reduce(
      (sum, m, i) => (addAsBought.has(i) && m.line.priceMinor !== null ? sum + m.line.priceMinor : sum),
      0
    );
  // In pair mode a pairing *is* the assertion that a row came home and cost
  // this, so it stands in for the checkbox the itemized flow uses.
  const acceptedCount = opaque
    ? Object.keys(pairing).length
    : accepted.size + addAsBought.size;

  /**
   * Why a row is worth a second look, in the app's own words.
   *
   * A price caution is orange and a quantity one is quiet, matching what each
   * actually does: the first takes the row's tick away, the second is a note
   * about a purchase that still happened.
   */
  const describeCaution = (caution: ReceiptCaution): { text: string; warn: boolean } => {
    if (caution.kind === 'quantity') {
      return { text: `Your list asked for ${caution.wanted}.`, warn: false };
    }
    const paid = formatPrice(caution.baselineMinor, currencySymbol);
    return {
      text: caution.baselineQuantity
        ? `You last paid ${paid} for ${caution.baselineQuantity}. Check this is the right row.`
        : `You last paid ${paid} for this. Check this is the right row.`,
      warn: true,
    };
  };

  const renderMatch = (match: ReceiptMatch & { itemId: string }, index: number) => {
    const on = accepted.has(match.itemId);
    const weak = match.confidence === 'weak';
    const name = nameFor(match.itemId);
    const cautions = receiptCautionsFor(match, items, shopId, itemShops);
    return (
      <TouchableOpacity
        key={`${match.itemId}-${index}`}
        style={[styles.row, index > 0 && styles.rowDivided]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggle(match.itemId)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`${name}, from receipt line ${match.line.label}`}
      >
        <View style={[styles.check, on && styles.checkOn]}>
          {on && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
          {/* The printed line, always — it is the only way anyone can check
              the reading that put this row here. */}
          <Text style={styles.rowLabel} numberOfLines={1}>
            {match.line.label}
            {!!match.line.quantity && ` · ${match.line.quantity}`}
          </Text>
          {weak && (
            <Text style={styles.rowWeak}>
              Not sure this is the same thing. Check before you accept it.
            </Text>
          )}
          {/* Says why a line nothing could have matched by name is sitting on a
              row anyway. Without it a remembered alias reads as the app having
              guessed something inexplicable. */}
          {match.confidence === 'remembered' && (
            <Text style={styles.rowRemembered}>You matched this line before</Text>
          )}
          {cautions.map((caution, i) => {
            const { text, warn } = describeCaution(caution);
            return (
              <Text key={i} style={warn ? styles.rowWeak : styles.rowLabel}>
                {text}
              </Text>
            );
          })}
        </View>
        {match.line.priceMinor !== null && (
          <Text style={styles.rowPrice}>{formatPrice(match.line.priceMinor, currencySymbol)}</Text>
        )}
      </TouchableOpacity>
    );
  };

  /**
   * Extracted so pair mode can reuse them verbatim. Both questions are about
   * the trip rather than about the lines, so they are asked identically
   * whichever kind of receipt this is — and an opaque store *especially* needs
   * the store picker, since that is the control that put the sheet in this mode
   * and the only way back out of it.
   */
  const storePicker = () => (
    <>
      <Text style={styles.label}>WHERE DID YOU SHOP?</Text>
      <Text style={styles.hint}>
        {receipt?.storeName
          ? `The receipt says “${receipt.storeName}”.`
          : 'The receipt doesn’t name a store.'}{' '}
        Naming a store is what lets you see which store has which items later.
      </Text>

      <View style={styles.pills}>
        <PillGroup
          key={String(visible)}
          noun="store"
          surface="page"
          createMaxLength={SHOP_NAME_MAX_LENGTH}
          onCreate={handleAddShop}
          options={[
            {
              key: '__none__',
              label: 'No store',
              pinned: true,
              selected: shopId === null,
              onPress: () => { haptics.tap(); setShopId(null); },
            },
            ...shops.map(shop => ({
              key: shop.id,
              label: shop.name,
              selected: shop.id === shopId,
              onPress: () => { haptics.tap(); setShopId(shop.id); },
            })),
          ]}
        />
      </View>

      {/* Asked here rather than in a settings screen, and only once a store is
          named, on the same reasoning ItemShopLink.unavailableAt is captured in
          the finish sheet: this is the only moment anyone knows the answer. You
          have just photographed the thing and are looking at what came back. */}
      {!!shopId && (
        <View style={styles.styleSection}>
          <Text style={styles.label}>WHAT THIS STORE'S RECEIPTS SHOW</Text>
          <SegmentedControl
            options={RECEIPT_STYLE_OPTIONS}
            value={receiptStyleOf(shopId)}
            onChange={value => {
              haptics.tap();
              setShopReceiptStyle(shopId, value);
            }}
            label="What this store's receipts show"
            surface="page"
          />
        </View>
      )}
    </>
  );

  const datePicker = () => (
    <>
      <Text style={styles.label}>WHEN DID YOU SHOP?</Text>
      <Text style={styles.hint}>
        Everything checked gets dated when the trip actually happened, and any use-by day it
        starts is worked out from there.
      </Text>
      <View style={styles.dateSection}>
        <TouchableOpacity
          style={styles.dateRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => setDatePickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Purchased ${formatScheduledDate(purchasedDate.toISOString())}`}
        >
          <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={styles.dateValue}>{formatScheduledDate(purchasedDate.toISOString())}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </TouchableOpacity>
        {dateImplausible && (
          <Text style={styles.dateCaution}>
            The date on the receipt didn’t look right, so this defaulted to today. Check it.
          </Text>
        )}
      </View>
    </>
  );

  const body = () => {
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Reading the receipt…</Text>
        </View>
      );
    }

    if (!receipt) {
      return (
        <>
          <RecipeSourcePicker
            intro="Photograph your receipt and dundundun will check the items off your list, record what they cost, and file the trip against the store."
            photoOnly
            photoHint="Lay it flat and get the whole receipt in the frame. A long one is fine folded, as long as the item lines are readable."
            mode="photo"
            onChangeMode={() => {}}
            text=""
            onChangeText={() => {}}
            url=""
            onChangeUrl={() => {}}
            photo={photo}
            onPickPhoto={input.pick}
            onClearPhoto={input.clearPhoto}
            picking={input.picking}
            ctaLabel="Read the receipt"
            onRun={run}
          />
          {!!input.photoError && <Text style={styles.error}>{input.photoError}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </>
      );
    }

    if (receipt.lines.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={iconSize.lg} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Nothing readable on that one</Text>
          <Text style={styles.emptyText}>
            Try again with the whole receipt in frame and more light on it. Nothing has been
            changed on your list.
          </Text>
          <TouchableOpacity
            style={styles.retry}
            activeOpacity={interaction.activeOpacity}
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Try another photo"
          >
            <Text style={styles.retryText}>Try another photo</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Contradictory, and worth saying so rather than reading the paper anyway:
    // the store picker above is the control that got here, so the way out is
    // in front of the user.
    if (receiptStyleOf(shopId ?? '') === 'none') {
      return (
        <>
          {storePicker()}
          <Text style={styles.hint}>
            You've said this store doesn't give a receipt, so there's nothing here to read. Pick a
            different store above, or change what its receipts show.
          </Text>
        </>
      );
    }

    if (opaque) {
      return (
        <>
          {storePicker()}
          {datePicker()}
          <ReceiptPricePairing
            rows={pairRows}
            prices={pairPrices}
            pairing={pairing}
            onChangePairing={setPairing}
            selectedId={pairSelectedId}
            onSelect={setPairSelectedId}
            currencySymbol={currencySymbol}
          />
        </>
      );
    }

    return (
      <>
        <Text style={styles.intro}>
          {receipt.lines.length} {receipt.lines.length === 1 ? 'line' : 'lines'} read
          {receipt.totalMinor !== null
            ? `, totalling ${formatPrice(receipt.totalMinor, currencySymbol)}`
            : ''}
          . Nothing is recorded until you finish shopping.
        </Text>

        {storePicker()}
        {datePicker()}

        {claimed.length > 0 && (
          <>
            <Text style={styles.label}>ON YOUR LIST</Text>
            <Text style={styles.hint}>
              Checked rows come off the list when you finish, with the receipt’s price on each.
            </Text>
            <View style={styles.card}>{claimed.map(renderMatch)}</View>
            {recordedMinor > 0 && (
              <Text style={styles.tally}>
                Recording {formatPrice(recordedMinor, currencySymbol)}
                {receipt.totalMinor !== null
                  ? ` of the ${formatPrice(receipt.totalMinor, currencySymbol)} on this receipt`
                  : ''}
                .
              </Text>
            )}
          </>
        )}

        {unclaimed.length > 0 && (
          <>
            {/* Covers two different reasons on purpose. "Not on your list"
                would be a lie about a duplicate, which is on the list — the
                list just doesn't have two of them. What both share is that
                nothing happens to them unless checked, which is what the
                heading says. */}
            <Text style={styles.label}>LEFT ALONE</Text>
            <Text style={styles.hint}>
              {claimed.length > 0
                ? 'These didn’t match anything on your list, or your list only asked for one. Check one to add it as bought.'
                : 'None of these matched anything on your list. Check one to add it as bought.'}
            </Text>
            <View style={styles.card}>
              {unclaimed.map((match, i) => {
                const on = addAsBought.has(i);
                const catalogName = match.offListMatchId ? nameFor(match.offListMatchId) : null;
                return (
                  <TouchableOpacity
                    key={`u-${i}`}
                    style={[styles.row, i > 0 && styles.rowDivided]}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => toggleAddAsBought(i)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Add ${match.line.label} as bought`}
                  >
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowSkipped} numberOfLines={1}>{match.line.label}</Text>
                      {match.duplicateOf !== null && (
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          A second {nameFor(match.duplicateOf)} — the first one is above.
                        </Text>
                      )}
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {catalogName
                          ? `Matches “${catalogName}” already in your catalog.`
                          : 'Adds it as a new item.'}
                      </Text>
                    </View>
                    {match.line.priceMinor !== null && (
                      <Text style={styles.rowPriceOff}>
                        {formatPrice(match.line.priceMinor, currencySymbol)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </>
    );
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.root}>
          <View style={styles.header}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
            <Text style={styles.headerTitle}>Scan a receipt</Text>
            {receipt && receipt.lines.length > 0 ? (
              <SheetHeaderButton
                label="Apply"
                onPress={handleApply}
                disabled={acceptedCount === 0}
                minWidth={64}
              />
            ) : (
              <View style={styles.headerSpacer} />
            )}
          </View>

          <ScrollView
            ref={keyboardScroll.ref}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
          >
            {body()}
          </ScrollView>
        </View>
      </Modal>
      <WhenPicker
        visible={datePickerOpen}
        value={purchasedDate}
        title="Purchased"
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => {
          if (date) setPurchasedDate(date);
          setDatePickerOpen(false);
        }}
        onCancel={() => setDatePickerOpen(false)}
      />
    </>
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
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    headerSpacer: { minWidth: 64 },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    intro: {
      color: colors.textSecondary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      marginBottom: spacing.lg,
    },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
    },
    hint: {
      color: colors.textTertiary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      marginBottom: spacing.sm,
    },
    pills: { marginBottom: spacing.lg },
    dateSection: { marginBottom: spacing.lg },
    styleSection: { marginBottom: spacing.lg },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
    },
    dateValue: { flex: 1, color: colors.text, fontSize: font.md },
    dateCaution: { color: colors.orange, fontSize: font.xs, marginTop: spacing.xs },
    tally: {
      color: colors.textTertiary,
      fontSize: font.sm,
      // Pulled back toward the card it sums — the card carries a full
      // `spacing.lg` beneath it, which reads as a detached statement rather
      // than as this list's own total.
      marginTop: -spacing.sm,
      marginBottom: spacing.lg,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    rowBody: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowLabel: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    rowWeak: { color: colors.orange, fontSize: font.xs, marginTop: 2 },
    rowRemembered: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
    rowSkipped: { color: colors.textSecondary, fontSize: font.sm },
    rowPrice: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
    rowPriceOff: {
      color: colors.textTertiary,
      fontSize: font.sm,
      fontVariant: ['tabular-nums'],
    },
    // The app's checkbox shape (`checkboxRadius`, same as GroceryRow's).
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: checkboxRadius(CHECK_SIZE),
      borderWidth: 1.5,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    loadingText: { color: colors.textSecondary, fontSize: font.sm },
    error: { color: colors.red, fontSize: font.sm, marginTop: spacing.md },
    empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    emptyTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    emptyText: {
      color: colors.textTertiary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      textAlign: 'center',
    },
    retry: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.accentSubtle,
    },
    retryText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  });
}
