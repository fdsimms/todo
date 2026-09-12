import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  getDataScannerView, isDataScannerAvailable, type DataScannerScan,
} from 'todo-datascanner-bridge';
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
import { InlineAction } from './InlineAction';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { ProductPicker } from './ProductPicker';
import { EmptyState } from './EmptyState';
import type { ReceiptAddDraft } from './ReceiptImportSheet';
import type { ReceiptMatch } from '../utils/receiptMatch';
import { lookupGtin, describeLookupError } from '../services/productLookup';
import { formatGtin, normalizeGtin } from '../utils/gtin';
import { describeProduct, productsForItem } from '../utils/groceryProduct';
import { priceNearBarcode } from '../utils/shelfLabel';
import { formatPrice } from '../utils/groceryPrice';
import { normalizePlu, pluNameFor } from '../utils/plu';
import {
  matchScans,
  scanBoxFor,
  scanLinkTarget,
  pluScannedItem,
  nameFromScanFor,
  scannedItemFor,
  sourceLabelFor,
  variantFor,
  unknownScannedItem,
  type ScannedGtinLink,
  type ScannedItem,
} from '../utils/scanResolve';
import { generateId } from '../utils/id';
import { haptics } from '../utils/haptics';
import { GROCERY_NAME_MAX_LENGTH } from '../types';
import type { ReceiptMatchConfidence } from '../utils/receiptMatch';

/** Matches the shopping list's own checkbox, same as the receipt sheet's. */
const CHECK_SIZE = 22;

/**
 * A box to file against a catalog row this scan matched, rather than minted.
 *
 * Kept apart from `ReceiptAddDraft.brand`, which covers the rows that *do* get
 * minted, so between them every scanned row's product is accounted for exactly
 * once: minted rows carry it on the draft, matched ones travel here.
 */
export interface ScanProductDraft {
  itemId: string;
  brand: string | null;
  variant: string | null;
  /** The code this box was read from, or null for a row typed by hand. */
  gtin: string | null;
  /**
   * Pack size as the source printed it ("500 g"), empty when it stated none.
   *
   * Carried for `'log'` context, which is the one caller that has a use for it:
   * a package is an amount somebody can have eaten, and without its size the
   * whole-package option can't be offered at all — see `servingsPerPackage`.
   * Not written anywhere. A minted row carries the same field on its own
   * `ReceiptAddDraft`, which is the split every other field here already makes.
   */
  packSize: string;
}

/**
 * One row in the session: a scan plus the two things the user can change about
 * it before it is committed.
 *
 * `key` exists because a scan has no id until it becomes a catalog row, and
 * indices are not stable under a delete — the accepted-set-of-indices bug this
 * avoids is the one where removing the second row silently unchecks the third.
 */
interface ScanRow extends ScannedItem {
  key: string;
  /** Whether this is going to be recorded. Off for a row nobody has named yet. */
  included: boolean;
  /** True while the lookup for this row is in flight. */
  pending: boolean;
  /** Why the lookup produced nothing, when it failed rather than missed. */
  error: string | null;
  /**
   * Going in the freezer rather than the fridge or pantry shelf, in either
   * context. In `'shopping'` context this is only a flag the row carries out
   * of the sheet — see `Props.onApply`'s note on when it's actually written.
   */
  frozen: boolean;
  /**
   * The catalog row the user tapped "Confirm" on, for a match this session
   * only *guessed* at. Null until tapped, and compared against the match's own
   * id rather than treated as a bare yes/no — see `confidentItemId` — so
   * editing the name away from what was confirmed asks again rather than
   * carrying a stale yes onto a different row.
   */
  confirmedMatchId: string | null;
  /**
   * The catalog row the user chose by hand, which outranks whatever the
   * matcher read.
   *
   * **Separate from `confirmedMatchId` because it answers a different
   * question.** That one is a yes to a row the app offered, and is deliberately
   * compared against the offer so that editing the name asks again. This is the
   * app being *told*, and nothing about it is contingent on a guess: it stands
   * whether the matcher found anything, found the wrong thing, or found nothing
   * at all. That last case is the one it exists for — a barcode no database has
   * heard of used to leave "New item" and a name field, so scanning the tub of
   * yogurt already in the catalog minted a second row for it.
   *
   * Resolve-or-shrug, like every other cross-row pointer here: an id that no
   * longer names a row falls back to the matcher's own reading rather than
   * blocking the row. See `scanLinkTarget`.
   */
  pickedItemId: string | null;
  /**
   * The box of that item the user chose by hand, or null for the food itself.
   *
   * A second, independent question from `pickedItemId`: which food this is, and
   * then which box of it. The barcode's own words answer the second one well
   * enough most of the time — `variantFor` subtracts the item's name from the
   * product name and keeps the rest — and this is what says so when they don't.
   * The three ways they don't are all real and all documented where they
   * happen: a row this scan mints is named after the residue so there is no
   * variant left to derive, `variantFor` refuses outright when the item's name
   * doesn't appear in the product name, and a barcode nothing was found for has
   * no words at all.
   *
   * Carried as an id here and turned into brand and variant at apply time by
   * `scanBoxFor`, which is also where a box left behind by a changed item pick
   * is dropped.
   *
   * Null means nobody has said, and the barcode's own words answer. There is
   * deliberately no "just the food" state here: a code's claim on a box is only
   * released by another box claiming it, so a scan saying that would leave the
   * entry carrying the box it had just been told to drop. `ProductPicker`'s
   * `allowNone` note has the argument; the log's own relink is where that
   * answer is said, and means what it says.
   */
  pickedProductId: string | null;
  /**
   * The shelf price read off the same label as the barcode, in minor units, or
   * null when nothing near the code read as one.
   *
   * Only ever a proposal: it is shown on the row and cleared with a tap, and
   * nothing is written until Add. It rides `ReceiptAddDraft.priceMinor`, which
   * already existed for the receipt sheet, so the write on the other side needs
   * nothing new — this path simply stopped always passing null.
   */
  priceMinor: number | null;
}

/** Which screen is scanning. See `Props.context`. */
export type ScanContext = 'shopping' | 'pantry' | 'log';

/**
 * Everything that reads differently per context, in one place.
 *
 * Keyed by the union rather than branched at each sentence, so adding a
 * context is a compile error here instead of four silently wrong sentences on
 * screen. `matched`/`rematched`/`offList` take the row's name; the rest are
 * fixed.
 */
const CONTEXT_COPY: Record<ScanContext, {
  title: string;
  emptySubtitle: string;
  confirmLabel: string;
  /** Whether the freezer toggle means anything here. */
  freezer: boolean;
  matched: (name: string) => string;
  /** A row the user filed by hand. One sentence per context, same as the rest. */
  picked: (name: string) => string;
  scannedBefore: (name: string) => string;
  matchedBefore: (name: string) => string;
  offList: (name: string) => string;
}> = {
  shopping: {
    title: 'Scan groceries',
    emptySubtitle: 'Point the camera at a barcode as you unpack. Anything without one, type below.',
    confirmLabel: 'Add',
    freezer: true,
    matched: name => `On your list as ${name}`,
    picked: name => `Filed as ${name} on your list`,
    scannedBefore: name => `On your list as ${name}, as you scanned it before`,
    matchedBefore: name => `On your list as ${name}, as you matched it before`,
    offList: name => `Back on the list as ${name}`,
  },
  pantry: {
    title: 'Scan into pantry',
    emptySubtitle: 'Point the camera at a barcode to add it to the pantry. Anything without one, type below.',
    confirmLabel: 'Add',
    freezer: true,
    matched: name => `Matches \u201C${name}\u201D in your pantry`,
    picked: name => `Filed as \u201C${name}\u201D in your pantry`,
    scannedBefore: name => `Matches \u201C${name}\u201D, as you scanned it before`,
    matchedBefore: name => `Matches \u201C${name}\u201D, as you matched it before`,
    offList: name => `Matches \u201C${name}\u201D`,
  },
  log: {
    title: 'Scan to log',
    emptySubtitle: 'Point the camera at a barcode to log what you ate. Anything without one, type below.',
    confirmLabel: 'Next',
    // A log has no fridge and no freezer: it records that something was eaten,
    // which is the opposite of where a thing is being kept.
    freezer: false,
    matched: name => `Known as \u201C${name}\u201D`,
    picked: name => `Filed as \u201C${name}\u201D`,
    scannedBefore: name => `Known as \u201C${name}\u201D, as you scanned it before`,
    matchedBefore: name => `Known as \u201C${name}\u201D, as you matched it before`,
    offList: name => `Known as \u201C${name}\u201D`,
  },
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Which screen is scanning, and so what a matched row means to say.
   *
   * The session itself — camera, lookup, matching against the catalog — is
   * identical for all three; only the words are different. `'shopping'` (from
   * `GroceryScreen`, mid-unpack) frames a match in terms of the list;
   * `'pantry'` (from `KitchenScreen`) frames it in terms of the catalog,
   * since scanning there never touches `onList` at all — see `onApply`;
   * `'log'` (from `FoodLogScreen`) frames it in terms of what was eaten, and
   * likewise never touches the list.
   *
   * **The wording lives in `CONTEXT_COPY` rather than in a ternary per
   * sentence.** It was four `context === 'pantry' ? … : …` branches, which is
   * a shape that compiles clean when a third context is added and silently
   * hands it the shopping wording in all four places. A record keyed by the
   * union cannot: a missing context fails the build.
   */
  context: ScanContext;
  /**
   * Hands the confirmed session back to the screen: rows to check off, and
   * rows to create or promote first.
   *
   * The same two arguments `ReceiptImportSheet` hands over, minus the store,
   * the prices and the date — a barcode carries none of those, and the finish
   * sheet is where they get answered anyway. **Nothing is written from here**,
   * for the reason that sheet gives: the thing on the other side of the confirm
   * takes a whole list off in one pass.
   *
   * In `'pantry'` context the caller reads only the names off these — see
   * `KitchenScreen`'s `handleScanApply`, which resolves `itemIds` back to
   * names and routes everything through `addManyToPantry` instead of
   * checking anything off a list.
   *
   * `frozenItemIds` is the freezer toggle for rows in that first array —
   * `toAdd` carries its own per-draft `frozen` field instead, since each of
   * those is a fresh object anyway. The toggle renders in both contexts, but
   * what happens to it differs: `KitchenScreen` writes it immediately,
   * `GroceryScreen` holds it until the trip actually finishes — a scan only
   * checks an item onto the list, and `finishShopping` is where "bought" gets
   * decided, see its own doc comment on `frozenIds`.
   *
   * `products` is the same split one more time, for the box a scan names: rows
   * that resolved to an existing catalog item travel here, rows that mint one
   * carry it on their own draft. See `ScanProductDraft`.
   *
   * `gtinLinks` is the barcode of every row whose catalog id this sheet
   * already knows, matched on the list or off it. It is separate from
   * `products` because a row can be worth linking without being a box: an
   * unfound barcode the user just named has no brand and no variant, and it is
   * the code most worth remembering, since nothing else about it will ever
   * improve on its own. Rows this sheet *mints* aren't here at all, for the
   * reason `products` splits the same way — they have no id until the caller
   * creates them, so the caller links those from `ReceiptAddDraft.gtin`.
   */
  onApply: (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[]
  ) => void;
}

/**
 * Scanning groceries one barcode at a time — mid-unpack from `GroceryScreen`
 * (`context="shopping"`), straight into the catalog from `KitchenScreen`'s
 * Pantry screen (`context="pantry"`), or into the food log from
 * `FoodLogScreen` (`context="log"`). The session is one flow for all three;
 * only the wording differs, since neither of the last two puts anything on
 * the shopping list at all. Every difference is in `CONTEXT_COPY` — see
 * `Props.context` for why it is a record rather than a ternary per sentence.
 *
 * **Not one photo of a pile of shopping.** In a haul shot most barcodes are
 * angled, occluded or face-down, so a dozen items resolve to three, and the
 * nine misses are invisible — there is nothing on screen to tell you they were
 * ever there. One item at a time is slower per item and is the only version
 * where you can see what got read.
 *
 * **A barcode says what something is; it never says you bought it.** So this
 * sheet only ever produces a draft, exactly like the receipt sheet, and the
 * trip still ends in `FinishShoppingSheet` — which is also the one place that
 * asks what the store didn't have, a question no scan can answer. That routing
 * is deliberate and is why `finishShopping` is not called from here: it takes
 * the *whole* checked list off, and someone unpacking may well have other rows
 * ticked from earlier in the day.
 *
 * **A miss is a row, not an error.** A barcode nothing has heard of, and a
 * loose bunch of bananas with no barcode at all, both land as a row with an
 * empty name waiting to be typed into. Making those the same flow is what keeps
 * produce from being a second feature: the failure case and the no-barcode case
 * want the identical control.
 *
 * **Nothing arrives checked until it has a name.** A row the lookup filled in
 * is checked, because the user is looking straight at the name it found and the
 * box it came off; a row still saying nothing is not something to record. Same
 * rule `acceptedByDefault` applies to a weak receipt match, for the same
 * reason: an unchecked row is a question and a checked one is an assertion.
 */
export function BarcodeScanSheet({ visible, onClose, onApply, context }: Props) {
  const colors = useColors();
  /**
   * The one-pass scanner, or null where it isn't supported (anything but an
   * iOS 16+ device with the hardware for it). Resolved once: neither the module
   * nor the device's capability can change while the app is running.
   */
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const DataScanner = useMemo(
    () => (isDataScannerAvailable() ? getDataScannerView() : null),
    [],
  );
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const rememberAliases = useGroceryStore(s => s.rememberAliases);
  const aliasItemFor = useGroceryStore(s => s.aliasItemFor);
  const gtinItemFor = useGroceryStore(s => s.gtinItemFor);
  const gtinProductFor = useGroceryStore(s => s.gtinProductFor);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [permission, requestPermission] = useCameraPermissions();
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [manual, setManual] = useState('');
  /**
   * The row whose catalog picker is open, or null. One at a time: the picker
   * is a list of its own, and two of them open down the sheet would bury the
   * rows still waiting to be read.
   */
  const [picking, setPicking] = useState<{ key: string; mode: 'item' | 'box' } | null>(null);
  /**
   * GTINs already claimed in this session, checked and set synchronously in
   * the scan callback itself rather than read off `rows`.
   *
   * A ref mirroring `rows` (`someRef.current = rows`, updated on every
   * render) only catches up once React actually commits the render that
   * follows `addScan`'s `setRows` — and a barcode held in frame for even a
   * second fires several more scans before that commit lands, so every one
   * of them would read the same stale, gtin-less state and each would start
   * its own `addScan`. This set is mutated the instant a gtin is accepted,
   * so nothing racing behind it can slip through.
   */
  const scannedGtinsRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    setRows([]);
    setManual('');
    setPicking(null);
    scannedGtinsRef.current = new Set();
  }, []);

  // Reset on close rather than on open, same rule the receipt sheet follows: a
  // sheet that stays mounted must not hand yesterday's unpack to today's.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const patchRow = useCallback((key: string, patch: Partial<ScanRow>) => {
    setRows(current => current.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  /**
   * Adds a row for a barcode and fills it in when the lookup comes back.
   *
   * The row appears immediately, before the network is asked, because the
   * person is holding the next item and needs to see that this one landed. The
   * lookup patches it in place afterwards.
   */
  const addScan = useCallback(
    async (gtin: string, priceMinor: number | null = null) => {
      const key = generateId();
      setRows(current => [
        ...current,
        {
          ...unknownScannedItem(gtin),
          key,
          included: false,
          pending: true,
          error: null,
          frozen: false,
          confirmedMatchId: null,
          pickedItemId: null,
          pickedProductId: null,
          priceMinor,
        },
      ]);
      try {
        const record = await lookupGtin(gtin);
        if (record) {
          patchRow(key, { ...scannedItemFor(record), pending: false, included: true });
        } else {
          patchRow(key, { pending: false });
        }
      } catch (e) {
        patchRow(key, { pending: false, error: describeLookupError(e) });
      }
    },
    [patchRow]
  );

  /**
   * Every frame the camera resolves a code fires this, so the dedupe is what
   * makes it usable at all rather than a refinement — see `scannedGtinsRef`.
   */
  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      const gtin = normalizeGtin(data);
      // A code that fails its own check digit is a misread, and a misread that
      // reached the network would file somebody else's product in the pantry.
      if (!gtin) return;
      if (scannedGtinsRef.current.has(gtin)) return;
      scannedGtinsRef.current.add(gtin);
      haptics.tap();
      void addScan(gtin);
    },
    [addScan]
  );

  /**
   * The same dedupe and check-digit rules as the plain camera path, plus the
   * shelf price: `DataScannerViewController` hands over the text in frame
   * alongside the code, so the price two centimetres from the barcode arrives
   * with it instead of needing a second capture.
   */
  const handleDataScan = useCallback(
    ({ nativeEvent }: { nativeEvent: DataScannerScan }) => {
      const gtin = normalizeGtin(nativeEvent.value);
      if (!gtin) return;
      if (scannedGtinsRef.current.has(gtin)) return;
      scannedGtinsRef.current.add(gtin);
      haptics.tap();
      void addScan(gtin, priceNearBarcode(nativeEvent, nativeEvent.texts));
    },
    [addScan]
  );

  /**
   * The typed field takes either half of what the camera can't do: a barcode
   * whose bars won't read (crushed box, freezer frost), or a name for something
   * that has no barcode at all.
   */
  const handleManualAdd = useCallback(() => {
    const raw = manual.trim();
    if (!raw) return;
    const gtin = normalizeGtin(raw);
    const plu = gtin ? null : normalizePlu(raw);
    if (gtin) {
      if (!scannedGtinsRef.current.has(gtin)) {
        scannedGtinsRef.current.add(gtin);
        void addScan(gtin);
      }
    } else if (plu) {
      // A produce sticker. It goes in as a row keyed on the code rather than
      // named after it, so the alias table can answer for it now and learn it
      // if it can't — see `pluScannedItem`. A seeded name is a suggestion and
      // deliberately arrives unchecked: the built-in list is tiny and unverified,
      // so a wrong one has to be visible rather than silently accepted.
      const suggested = pluNameFor(plu);
      setRows(current => [
        ...current,
        {
          ...pluScannedItem(plu, suggested),
          key: generateId(),
          included: false,
          pending: false,
          error: null,
          frozen: false,
          confirmedMatchId: null,
          pickedItemId: null,
          pickedProductId: null,
          priceMinor: null,
        },
      ]);
    } else {
      setRows(current => [
        ...current,
        {
          gtin: null,
          label: '',
          name: raw.slice(0, GROCERY_NAME_MAX_LENGTH),
          brand: null,
        aisle: null,
          quantity: '',
          key: generateId(),
          included: true,
          pending: false,
          error: null,
          frozen: false,
          confirmedMatchId: null,
          pickedItemId: null,
          pickedProductId: null,
          priceMinor: null,
        },
      ]);
    }
    setManual('');
    haptics.tap();
  }, [manual, addScan]);

  // The barcode first, the source's words second. A code is the one thing on a
  // scan that can't drift: rename the row to "vegan sausage" and the product
  // name has nothing left to match on, while the digits underneath are the
  // same digits. Falls through to the label alias for a row with no code —
  // produce stickers, and anything typed by hand.
  //
  // No store either way: at unpack time nobody has said where the bag came
  // from, and a product name off a barcode database reads the same whichever
  // shop it was.
  const matches = useMemo(
    () =>
      matchScans(
        rows,
        items,
        scan => gtinItemFor(scan.gtin) ?? aliasItemFor(null, scan.label)
      ),
    [rows, items, aliasItemFor, gtinItemFor]
  );
  const includedCount = rows.filter(r => r.included && r.name.trim()).length;

  /**
   * A weak match is a single coincidental word in common ("cream" in both
   * "Boston Cream Pie" and "Heavy Cream") and nothing more — not confirmation
   * this scan is that row. `acceptedByDefault` already refuses to pre-check
   * one for a receipt; a scan gets no separate confirmation step at all, so
   * it must refuse even harder and treat a weak read as no match.
   *
   * A `'likely'` match is a real word in common and nothing more — a guess,
   * not the app being told. The receipt sheet's checkbox already asks the
   * user to confirm one of these before it's counted; a scan has no separate
   * checkbox for "is this the right row", so the row's own `confirmedMatchId`
   * stands in for it — see the confirm pill in the row's caption.
   */
  const needsConfirm = (confidence: ReceiptMatchConfidence | null): boolean =>
    confidence === 'likely';

  /**
   * The row a hand-pick names, or null when nothing was picked or the pick no
   * longer resolves. `scanLinkTarget` is what decides which of the two branches
   * below it belongs to, off the item's own `onList`.
   */
  const pickedTarget = (row: ScanRow) =>
    scanLinkTarget(row.pickedItemId ? items.find(i => i.id === row.pickedItemId) : null);

  const confidentItemId = (row: ScanRow, match: ReceiptMatch | undefined): string | null => {
    // A hand-pick outranks the matcher outright, and answers for exactly one of
    // the two branches: an off-list pick falls through to `confidentOffListMatchId`
    // rather than ticking a row nobody was shopping for.
    const picked = pickedTarget(row);
    if (picked) return picked.onList ? picked.itemId : null;
    if (!match?.itemId || match.confidence === 'weak') return null;
    if (needsConfirm(match.confidence) && row.confirmedMatchId !== match.itemId) return null;
    return match.itemId;
  };
  const confidentOffListMatchId = (row: ScanRow, match: ReceiptMatch | undefined): string | null => {
    const picked = pickedTarget(row);
    if (picked) return picked.onList ? null : picked.itemId;
    if (!match?.offListMatchId || match.offListConfidence === 'weak') return null;
    if (needsConfirm(match.offListConfidence) && row.confirmedMatchId !== match.offListMatchId) {
      return null;
    }
    return match.offListMatchId;
  };
  /**
   * The row's item, whichever of the readings answered — a hand-pick, a match
   * on the list, or one off it. What the box question is asked about, since a
   * box belongs to an item and there is nothing to choose among until one is
   * settled.
   */
  const resolvedItemId = (row: ScanRow, match: ReceiptMatch | undefined): string | null =>
    confidentItemId(row, match) ?? confidentOffListMatchId(row, match);

  /** The item a `'likely'` match is offering, while the row hasn't confirmed it yet. */
  const pendingMatchId = (row: ScanRow, match: ReceiptMatch | undefined): string | null => {
    // Nothing left to confirm: the user has already said which row this is, and
    // offering the matcher's guess beside their own answer reads as the app
    // second-guessing them.
    if (pickedTarget(row)) return null;
    const candidate =
      match?.itemId && needsConfirm(match.confidence)
        ? match.itemId
        : !match?.itemId && match?.offListMatchId && needsConfirm(match.offListConfidence)
          ? match.offListMatchId
          : null;
    return candidate && candidate !== row.confirmedMatchId ? candidate : null;
  };

  const handleApply = useCallback(() => {
    const itemIds: string[] = [];
    const toAdd: ReceiptAddDraft[] = [];
    const frozenItemIds = new Set<string>();
    const products: ScanProductDraft[] = [];
    const gtinLinks: ScannedGtinLink[] = [];
    /**
     * The box, for a row that resolved to a catalog item that already exists.
     *
     * `variantFor` needs the item's own name to subtract, which is why this
     * lives here and not in the draft: only the sheet knows what each row
     * matched. A minted row gets no variant by the same logic — its item is
     * *named* after the residue, so there is nothing left over.
     */
    const recordProduct = (itemId: string, row: ScanRow) => {
      // A box the user chose outranks everything below, including the one this
      // barcode already names: picking one is the act of correcting exactly
      // that. Expressed as its own words, which is what `addProduct` and
      // `linkScannedGtins` both find a box by, so this reuses the existing box
      // rather than minting a second with the same name.
      if (row.pickedProductId) {
        const picked = scanBoxFor(
          itemProducts.find(p => p.id === row.pickedProductId),
          itemId,
        );
        if (picked) {
          products.push({ itemId, ...picked, gtin: row.gtin, packSize: row.quantity });
          return;
        }
        // A pick that no longer resolves — the box was deleted, or the item
        // pick moved on and left it behind. Resolve-or-shrug: fall through to
        // the barcode's own words, which is the answer the row had before
        // anybody picked anything.
      }
      // A box this barcode already names is the answer, and re-deriving one
      // would produce a worse one: `variantFor` subtracts the item's own name
      // from the product name, so a row renamed away from the source's wording
      // ("vegan sausage" for "Beyond Plant Based Sausages Cajun") leaves
      // nothing to subtract and returns null — minting a brand-only second box
      // beside the real one every time it is scanned.
      const linked = gtinProductFor(row.gtin);
      if (linked && linked.itemId === itemId) {
        products.push({ itemId, brand: linked.brand, variant: linked.variant, gtin: row.gtin, packSize: row.quantity });
        return;
      }
      if (!row.label) return;
      const item = items.find(i => i.id === itemId);
      if (!item) return;
      const variant = variantFor(row.label, row.brand, item.name);
      if (!row.brand && !variant) return;
      products.push({ itemId, brand: row.brand, variant, gtin: row.gtin, packSize: row.quantity });
    };
    /**
     * The barcode of a row whose catalog id is already known.
     *
     * Read off the product draft `recordProduct` just pushed, so the words the
     * link is filed under are the same ones `addProduct` is about to create —
     * looking the box up by key is how `linkScannedGtins` finds it. A row with
     * no box still gets a link, carrying nulls: the item-level half is the
     * durable one and is exactly what an unfound barcode has instead of a box.
     */
    const recordGtinLink = (itemId: string, row: ScanRow) => {
      if (!row.gtin) return;
      const box = products.find(p => p.itemId === itemId && p.gtin === row.gtin);
      gtinLinks.push({
        gtin: row.gtin,
        itemId,
        brand: box?.brand ?? null,
        variant: box?.variant ?? null,
      });
    };
    rows.forEach((row, index) => {
      // A hand-picked row is exempt from the name test, and has to be: the row
      // it was picked for is the one a barcode lookup missed entirely, so there
      // is nothing in the field and nothing that needs to be. It is never minted
      // either — both branches below resolve it to a row that already exists —
      // so the name the drafts carry is not read for it.
      if (!row.included) return;
      if (!row.name.trim() && !pickedTarget(row)) return;
      const match = matches[index];
      const itemId = confidentItemId(row, match);
      if (itemId) {
        itemIds.push(itemId);
        if (row.frozen) frozenItemIds.add(itemId);
        recordProduct(itemId, row);
        recordGtinLink(itemId, row);
        return;
      }
      const offListId = confidentOffListMatchId(row, match);
      if (offListId) {
        recordProduct(offListId, row);
        recordGtinLink(offListId, row);
      }
      toAdd.push({
        existingItemId: offListId,
        name: row.name.trim(),
        // The product's own full name is the raw text a new row is parsed from,
        // exactly as a receipt hands over its printed line. Falls back to the
        // shopper name for a typed row, which has no other words to offer.
        label: row.label || row.name.trim(),
        // Only a looked-up row has one; a typed row's brand is null, and the
        // screen skips the product write rather than storing an empty box.
        brand: row.brand,
        aisle: row.aisle,
        quantity: row.quantity,
        priceMinor: row.priceMinor,
        frozen: row.frozen,
        // Only read for a row this mints — a promoted one was linked above,
        // where its id was already known. See `Props.onApply`.
        gtin: row.gtin,
        // Also only read for a row this mints. A name left exactly as the
        // lookup proposed it is the source's words, not the user's — see
        // `nameFromScanFor`, which is where that test lives.
        nameFromScan: nameFromScanFor(row),
      });
    });
    // Only rows whose label came off a lookup are worth remembering. A typed
    // row's "label" is the name the user just wrote, so an alias from it would
    // map a phrase to itself and teach nothing. A weak or unconfirmed likely
    // match is excluded for the same reason `confidentItemId` is: it's a
    // guess, not a confirmed reading worth teaching the alias table.
    rememberAliases([
      ...rows
        .map((row, index) => ({ row, itemId: confidentItemId(row, matches[index]) }))
        .filter(({ row, itemId }) => row.included && !!row.label && !!itemId)
        .map(({ row, itemId }) => ({
          shopId: null,
          rawText: row.label,
          itemId: itemId as string,
        })),
      ...toAdd
        .filter(d => d.existingItemId !== null && !!d.label)
        .map(d => ({ shopId: null, rawText: d.label, itemId: d.existingItemId as string })),
    ]);
    onApply(itemIds, toAdd, frozenItemIds, products, gtinLinks);
  }, [rows, matches, items, itemProducts, onApply, rememberAliases, gtinProductFor]);

  /** What a row resolved to, or null when it has nothing to say yet. */
  const captionFor = (row: ScanRow, index: number): string | null => {
    if (row.pending) return 'Looking it up…';
    if (row.error) return row.error;
    // Ahead of the empty-name branch: a barcode nothing was found for is
    // exactly the row somebody files by hand, and telling them to type what it
    // is after they have already said which row it is reads as the pick not
    // having landed.
    const picked = pickedTarget(row);
    if (picked) {
      const item = items.find(i => i.id === picked.itemId);
      if (item) return CONTEXT_COPY[context].picked(item.name);
    }
    if (!row.name.trim()) return 'Not found. Type what it is.';
    const match = matches[index];
    const itemId = confidentItemId(row, match);
    if (itemId) {
      const item = items.find(i => i.id === itemId);
      if (!item) return null;
      // Both arrive as `remembered`, since a barcode link resolves through the
      // same alias tier a phrase does. Naming which of the two it was is worth
      // the branch: "as you scanned it before" is checkable against the box in
      // your hand, where the generic wording sends someone looking for a name
      // they typed and never find, the row having been renamed since.
      const viaGtin = !!row.gtin && gtinItemFor(row.gtin) === itemId;
      const copy = CONTEXT_COPY[context];
      if (viaGtin) return copy.scannedBefore(item.name);
      return match?.confidence === 'remembered'
        ? copy.matchedBefore(item.name)
        : copy.matched(item.name);
    }
    const offListMatchId = confidentOffListMatchId(row, match);
    if (offListMatchId) {
      const item = items.find(i => i.id === offListMatchId);
      if (!item) return null;
      return CONTEXT_COPY[context].offList(item.name);
    }
    const pendingId = pendingMatchId(row, match);
    if (pendingId) {
      const item = items.find(i => i.id === pendingId);
      if (item) return `Might match “${item.name}”`;
    }
    return 'New item';
  };

  const camera = () => {
    if (!permission) return <View style={styles.cameraPlaceholder} />;
    if (!permission.granted) {
      return (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.permissionText}>
            Scanning needs the camera. Everything it reads stays on this device.
          </Text>
          <InlineAction label="Allow camera" icon="camera-outline" onPress={requestPermission} />
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        {/* The one-pass scanner where the device has it, so a shelf label's
            price is captured with its barcode rather than needing a second
            trip. Everywhere else this is exactly the view it always was —
            an upgrade to scanning, not a new requirement for it. */}
        {DataScanner ? (
          <DataScanner style={StyleSheet.absoluteFill} onScan={handleDataScan} />
        ) : (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{
              // iOS reports a 12-digit UPC-A as an EAN-13 with a leading zero;
              // normalizeGtin lands both on one key, so listing both is safe.
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        )}
        <View style={styles.reticle} pointerEvents="none" />
      </View>
    );
  };

  // A scan session — rows read off the camera, or a name/barcode typed by
  // hand — is nowhere until Add, so a swipe-down would otherwise drop it
  // with no dialog.
  const handleCancel = () => {
    const dirty = rows.length > 0 || manual.trim() !== '';
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle}>
            {CONTEXT_COPY[context].title}
          </Text>
          <SheetHeaderButton
            label={CONTEXT_COPY[context].confirmLabel}
            onPress={handleApply}
            disabled={includedCount === 0}
            minWidth={64}
          />
        </View>

        {camera()}

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={rows.length === 0 ? styles.bodyEmpty : styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {rows.length === 0 ? (
            <EmptyState
              icon="barcode-outline"
              title="Nothing scanned yet"
              subtitle={CONTEXT_COPY[context].emptySubtitle}
            />
          ) : (
            <View style={styles.card}>
              {rows.map((row, index) => {
                const match = matches[index];
                const caption = captionFor(row, index);
                const pendingId = pendingMatchId(row, match);
                const nameable = !row.pending;
                // The box question, asked only once there is an item to ask it
                // about and boxes to answer with.
                const rowItemId = resolvedItemId(row, match);
                const rowItem = rowItemId ? items.find(i => i.id === rowItemId) : null;
                const rowBoxes = rowItemId ? productsForItem(rowItemId, itemProducts) : [];
                const boxCount = rowBoxes.length;
                const resolvedName = rowItem?.name ?? null;
                const boxLabel = row.pickedProductId
                  ? describeProduct(rowBoxes.find(b => b.id === row.pickedProductId)) ?? 'Which box'
                  : 'Which box';
                return (
                  <View key={row.key} style={index > 0 ? styles.rowDivided : undefined}>
                  <View style={styles.row}>
                    <TouchableOpacity hitSlop={11}
                      style={[
                        styles.check,
                        styles.rowControl,
                        row.included && { backgroundColor: colors.accentFill, borderColor: colors.accent },
                      ]}
                      activeOpacity={interaction.activeOpacity}
                      disabled={!row.name.trim() && !row.pickedItemId}
                      onPress={() => patchRow(row.key, { included: !row.included })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: row.included }}
                      accessibilityLabel={row.name.trim() || 'Unnamed scan'}
                    >
                      {row.included && (
                        <Ionicons name="checkmark" size={iconSize.xs} color={colors.onAccent} />
                      )}
                    </TouchableOpacity>

                    <View style={styles.rowBody}>
                      <TextInput
                        style={styles.rowInput}
                        value={row.name}
                        editable={nameable}
                        onChangeText={text =>
                          patchRow(row.key, {
                            name: text.slice(0, GROCERY_NAME_MAX_LENGTH),
                            // Naming a row is the act that makes it recordable;
                            // clearing the name takes that back rather than
                            // leaving a checked row with nothing in it.
                            included: text.trim().length > 0,
                          })
                        }
                        placeholder="Name this item"
                        placeholderTextColor={colors.textTertiary}
                        // A shelf word, not prose — see GroceryRow's inline
                        // rename field for what autocorrect does to one.
                        autoCorrect={false}
                        spellCheck={false}
                        accessibilityLabel="Item name"
                      />
                      {/* The words the lookup used, kept verbatim: the only way
                          to check the name above is against the box in hand.
                          The maker leads it when the name doesn't already say
                          who it is — see `sourceLabelFor`. */}
                      {!!row.label && (
                        <Text style={styles.rowLabel}>{sourceLabelFor(row.label, row.brand)}</Text>
                      )}
                      {/* A price read off the shelf label the barcode was on.
                          Shown as its own line with a way out, because it is a
                          geometric guess about which price belongs to this
                          code: two labels overlapping in frame is the case
                          nothing offline can rule out, and this is where it
                          gets caught. */}
                      {row.priceMinor !== null && (
                        <View style={styles.captionRow}>
                          <Text style={styles.rowCaption}>
                            {formatPrice(row.priceMinor, currencySymbol)} on the shelf label
                          </Text>
                          <InlineAction
                            label="Clear"
                            icon="close-circle-outline"
                            variant="neutral"
                            onPress={() => patchRow(row.key, { priceMinor: null })}
                            accessibilityLabel={`Clear the shelf price for ${row.name || row.label}`}
                            style={styles.confirmPill}
                          />
                        </View>
                      )}
                      {!row.pending && (
                        <View style={styles.captionRow}>
                          {!!caption && (
                            <Text style={row.error ? styles.rowError : styles.rowCaption}>
                              {caption}
                            </Text>
                          )}
                          {!!pendingId && !!caption && (
                            <InlineAction
                              label="Confirm"
                              icon="checkmark-circle-outline"
                              variant="neutral"
                              onPress={() => patchRow(row.key, { confirmedMatchId: pendingId })}
                              accessibilityLabel={`Confirm: ${caption}`}
                              style={styles.confirmPill}
                            />
                          )}
                          {/* The way out of every reading above, including the
                              one that read nothing. Neutral rather than accent
                              for the reason `InlineAction` gives: it is the
                              quieter half of the pair whenever a Confirm is
                              sitting beside it. */}
                          <InlineAction
                            // Three states, three labels, because one word has
                            // to make sense in all three places this sits: next
                            // to a guess it is rejecting, next to a reading it
                            // is replacing, and under a row that read nothing
                            // at all.
                            label={row.pickedItemId ? 'Change' : pendingId ? 'Not it' : 'Pick an item'}
                            icon="albums-outline"
                            variant="neutral"
                            onPress={() => setPicking(p => (p?.key === row.key && p.mode === 'item' ? null : { key: row.key, mode: 'item' }))}
                            accessibilityLabel={
                              row.pickedItemId
                                ? `Change which item ${row.name.trim() || row.label || 'this scan'} is filed as`
                                : `Choose which item ${row.name.trim() || row.label || 'this scan'} is`
                            }
                            style={styles.confirmPill}
                          />
                          {!!row.pickedItemId && (
                            <InlineAction
                              label="Undo"
                              icon="close-circle-outline"
                              variant="neutral"
                              onPress={() => { setPicking(null); patchRow(row.key, { pickedItemId: null, pickedProductId: null }); }}
                              accessibilityLabel={`Stop filing ${row.name.trim() || row.label || 'this scan'} by hand`}
                              style={styles.confirmPill}
                            />
                          )}
                          {/* Only once the row has an item and that item has
                              boxes. Before either, there is nothing to choose
                              among and the barcode's own words are the answer. */}
                          {boxCount > 0 && (
                            <InlineAction
                              label={boxLabel}
                              icon="cube-outline"
                              variant="neutral"
                              onPress={() => setPicking(p => (p?.key === row.key && p.mode === 'box' ? null : { key: row.key, mode: 'box' }))}
                              accessibilityLabel={`Choose which box of ${resolvedName ?? 'this item'} this is`}
                              style={styles.confirmPill}
                            />
                          )}
                        </View>
                      )}
                      {/* Only when the label isn't there to identify the row.
                          Once a product name is showing, the digits are a
                          fourth line nobody reads: a scan is checked against
                          the box in your hand, and the box says "Tillamook
                          Sharp Cheddar", not 072830000123. On a miss they are
                          the only thing the row knows, so they stay. */}
                      {!!row.gtin && !row.label && (
                        <Text style={styles.rowGtin}>{formatGtin(row.gtin)}</Text>
                      )}
                    </View>

                    {/* Where a thing is being kept, which a log has no
                        opinion about: it records that something was eaten. */}
                    {CONTEXT_COPY[context].freezer && (
                    <TouchableOpacity
                      activeOpacity={interaction.activeOpacity}
                      style={styles.rowControl}
                      disabled={!row.name.trim() && !row.pickedItemId}
                      onPress={() => patchRow(row.key, { frozen: !row.frozen })}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: row.frozen }}
                      accessibilityLabel={
                        row.frozen
                          ? 'Going in the freezer. Tap to change.'
                          : 'Add to the freezer instead of the fridge or pantry'
                      }
                    >
                      <Ionicons
                        name={row.frozen ? 'snow' : 'snow-outline'}
                        size={iconSize.sm}
                        color={row.frozen ? colors.accent : colors.textTertiary}
                      />
                    </TouchableOpacity>
                    )}

                    {row.pending ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.textTertiary}
                        style={styles.rowControl}
                      />
                    ) : (
                      <TouchableOpacity
                        activeOpacity={interaction.activeOpacity}
                        style={styles.rowControl}
                        onPress={() => {
                          setRows(current => current.filter(r => r.key !== row.key));
                          // Removing a mistaken row un-claims its gtin, so
                          // holding the same box up again isn't a no-op.
                          if (row.gtin) scannedGtinsRef.current.delete(row.gtin);
                        }}
                        accessibilityLabel={`Remove ${row.name.trim() || 'unnamed scan'}`}
                      >
                        <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Under the row rather than beside it: a result list sharing
                      the row's flex line would take its width from whatever the
                      name field left over, and a catalog row you cannot read is
                      one you cannot pick. Same `CatalogLinkPicker` a recipe
                      ingredient is tied to an item with, asking the same
                      question of a different kind of line. */}
                  {picking?.key === row.key && picking.mode === 'item' && (
                    <View style={styles.pickerWrap}>
                      <CatalogLinkPicker
                        items={items}
                        // The source's own words when the row has no name of its
                        // own, which is the miss this exists for.
                        initialQuery={row.name.trim() || row.label}
                        onPick={item => {
                          setPicking(null);
                          patchRow(row.key, {
                            pickedItemId: item.id,
                            // The offer this replaces, dropped: leaving a yes to
                            // a row the user has just said no to would come back
                            // the moment the pick is undone.
                            confirmedMatchId: null,
                            // A box belongs to the item it hangs off, so a box
                            // chosen for the old item is not an answer about
                            // this one. `scanBoxFor` refuses it at apply time
                            // anyway; clearing here is what stops the row
                            // *saying* it while it does.
                            pickedProductId: null,
                            // Naming a row is what makes it recordable, and a
                            // pick is a stronger naming than typing one.
                            included: true,
                            // Only where there was nothing. A scan's own name is
                            // the words on the box being checked against the box,
                            // and overwriting them would take away the check.
                            name: row.name.trim() || item.name,
                          });
                        }}
                      />
                    </View>
                  )}

                  {/* The second question, and deliberately its own control
                      rather than a step of the first: which food this is, then
                      which box of it. Most scans never need it — the barcode's
                      own words derive a box perfectly well — so it sits behind
                      its own tap rather than lengthening every row. */}
                  {picking?.key === row.key && picking.mode === 'box' && (
                    <View style={styles.pickerWrap}>
                      <ProductPicker
                        itemId={rowItemId}
                        products={itemProducts}
                        // Before anybody picks, the row is already filed against
                        // whichever box its own barcode names, so that is what
                        // the list shows as current rather than nothing.
                        value={row.pickedProductId ?? gtinProductFor(row.gtin)?.id ?? null}
                        allowNone={false}
                        onPick={product => {
                          setPicking(null);
                          if (product) patchRow(row.key, { pickedProductId: product.id });
                        }}
                        label={resolvedName ? `WHICH ${resolvedName.toUpperCase()}` : 'WHICH BOX'}
                      />
                    </View>
                  )}
                  </View>
                );
              })}
            </View>
          )}

          <Text style={styles.label}>NO BARCODE</Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              value={manual}
              onChangeText={setManual}
              onSubmitEditing={handleManualAdd}
              returnKeyType="done"
              placeholder="e.g. bananas, or a barcode number"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Add an item by name or barcode"
            />
            <InlineAction label="Add" icon="add" onPress={handleManualAdd} />
          </View>
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
    // Tall enough to frame a box at arm's length, short enough to leave the
    // scanned rows on screen — seeing the last read land is the whole feedback
    // loop, and a full-bleed viewfinder puts it behind the camera.
    cameraWrap: {
      height: 200,
      backgroundColor: colors.bgSunken,
      overflow: 'hidden',
    },
    cameraPlaceholder: {
      height: 200,
      backgroundColor: colors.bgSunken,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    permissionText: {
      color: colors.textSecondary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      textAlign: 'center',
    },
    reticle: {
      position: 'absolute',
      left: '15%',
      right: '15%',
      top: '25%',
      bottom: '25%',
      borderWidth: 2,
      borderColor: colors.onAccent,
      borderRadius: radius.md,
      opacity: 0.6,
    },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    // Full-height content container so EmptyState's own `flex: 1` has room
    // to center above the manual-add row, instead of collapsing to its
    // natural height right under the camera.
    bodyEmpty: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    // Top-aligned, not centred: a row is one to three lines depending on what
    // the lookup found, and centring puts the checkbox level with the middle
    // line — which is the source's own words, the one line it isn't about. The
    // offset drops it onto the name's baseline rather than the row's top edge.
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowControl: { marginTop: spacing.xs },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    rowBody: { flex: 1 },
    // No lineHeight: RN maps it onto the iOS paragraph style with no baseline
    // compensation, which drops the glyphs below the caret. See CLAUDE.md.
    rowInput: { color: colors.text, fontSize: font.md, paddingVertical: 2 },
    rowLabel: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    // Wraps, because the caption now shares its line with up to three pills
    // and a long "Filed as …" sentence would otherwise squeeze them off the
    // right edge — see CLAUDE.md on text losing a row to its buttons.
    captionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: 2,
    },
    rowCaption: { color: colors.textSecondary, fontSize: font.xs, flexShrink: 1 },
    // Indented to the row body's own left edge so the results read as belonging
    // to the row above rather than to the card.
    pickerWrap: { paddingLeft: spacing.xl, paddingRight: spacing.md, paddingBottom: spacing.sm },
    rowError: { color: colors.orange, fontSize: font.xs },
    // Tighter than `InlineAction`'s own default so a "Confirm" pill sitting
    // beside a caption reads as part of the line, not a control from a denser
    // grid of chips.
    confirmPill: { paddingVertical: 3, minHeight: 0 },
    rowGtin: {
      color: colors.textTertiary,
      fontSize: font.xs,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    manualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    manualInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
    },
    // The app's checkbox shape, same as the receipt sheet's.
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: checkboxRadius(CHECK_SIZE),
      borderWidth: 1.5,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
