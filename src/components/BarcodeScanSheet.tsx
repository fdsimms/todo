// Scanning groceries one barcode at a time, with a typed code or name as the
// fallback: each scan is looked up, matched to the catalog and committed through
// `onApply`. The same sheet unpacks shopping, stocks the pantry and logs food;
// only the words differ (CONTEXT_COPY). One component of ~1,250 lines, so grep a
// landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   StatusChip, FieldInput  small parts, above the component
//   makeStyles              styles, at the bottom
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SheetModal } from './SheetModal';
import { labelSubjectNamed, type LabelSubject } from './LabelSubjectSheet';
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
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { InlineAction } from './InlineAction';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { ProductPicker } from './ProductPicker';
import { EmptyState } from './EmptyState';
import { ActionRow } from './ActionRow';
import type { ReceiptAddDraft } from './ReceiptImportSheet';
import type { ReceiptMatch } from '../utils/receiptMatch';
import { lookupGtin, describeLookupError } from '../services/productLookup';
import { formatGtin, normalizeGtin } from '../utils/gtin';
import { describeProduct, productsForItem } from '../utils/groceryProduct';
import { describeFoodPanel, nutritionFor, panelLooksWrongFor } from '../utils/foodNutrition';
import { priceNearBarcode } from '../utils/shelfLabel';
import { formatPrice } from '../utils/groceryPrice';
import { pluNameFor } from '../utils/plu';
import {
  classifyTypedEntry,
  matchScans,
  scanBoxChoice,
  scanLinkTarget,
  pluScannedItem,
  nameFromScanFor,
  newItemBox,
  scannedItemFor,
  sourceLineFor,
  unknownScannedItem,
  type ScannedGtinLink,
  type ScannedItem,
} from '../utils/scanResolve';
import { generateId } from '../utils/id';
import { haptics } from '../utils/haptics';
import {
  GROCERY_BRAND_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_VARIANT_MAX_LENGTH,
  type FoodNutrition,
  type GroceryItem,
} from '../types';
import type { ReceiptMatchConfidence } from '../utils/receiptMatch';
import { confirmDiscard } from '../utils/confirmDiscard';
import { TextField } from './TextField';
import { BUTTON_LABEL } from '../copy/shared';

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
   * nothing is written until Add. A row this sheet mints or promotes carries it
   * on `ReceiptAddDraft.priceMinor`; a row that matched an item already on the
   * list has no draft, so its price travels in `onApply`'s `priceById`. Both
   * halves have to be read by the caller, or the price is shown and then lost
   * (#2934): `GroceryScreen` seeds the finish sheet's price fields with them,
   * and `KitchenScreen` hands them to `addManyToPantry`.
   */
  priceMinor: number | null;
  /**
   * Whether the barcode lookup stated a nutrition panel. Only the answer, not
   * the figures: `linkScannedGtins` carries the panel off the barcode cache
   * when the scan is applied, and the row only needs to say it is there so the
   * Nutrition line doesn't offer to photograph a label the database already read.
   */
  hasNutrition?: boolean;
  /**
   * What was typed into the Brand / Variant fields of a row that mints a new
   * item. `undefined` means untouched, so the barcode's own words answer; an
   * empty string is an answer too ("no variant"). Kept apart from `brand` so
   * editing the field never moves the baseline `nameFromScanFor` and
   * `variantFor` read the source's words against. Resolved by `newItemBox`.
   */
  brandEdit?: string;
  variantEdit?: string;
  /**
   * The panel the lookup stated, kept so a match can be checked against what
   * the catalog already holds for that item. See `panelLooksWrongFor`.
   */
  scanPanel?: FoodNutrition | null;
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
  /**
   * Whether the typed field takes a name or a produce sticker as well as a
   * barcode. A log records a food with figures, which a typed name never has,
   * so there the field is for a barcode that won't scan and nothing else.
   */
  typedNames: boolean;
  manualPlaceholder: string;
  matched: (name: string) => string;
  /** A row the user filed by hand. One sentence per context, same as the rest. */
  picked: (name: string) => string;
  offList: (name: string) => string;
}> = {
  shopping: {
    // The confirm is named for what it does: the scanned rows go in the cart
    // and the finish sheet opens, which records them as bought. "Add" (and the
    // menu's old "Scan barcodes", among the add verbs) read as a way to put
    // something on the list. The title stays short so the header's longer
    // confirm doesn't crowd it.
    title: 'Scan groceries',
    emptySubtitle: 'Scan barcodes as you unpack, then mark everything as bought. Type anything without a barcode below.',
    confirmLabel: 'Mark as bought',
    freezer: true,
    typedNames: true,
    manualPlaceholder: 'e.g. bananas, or a barcode number',
    matched: name => `On your list as ${name}`,
    picked: name => `Filed as ${name} on your list`,
    offList: name => `Back on the list as ${name}`,
  },
  pantry: {
    title: 'Scan into pantry',
    emptySubtitle: 'Scan a barcode to add it to the pantry. Type anything without a barcode below.',
    confirmLabel: 'Add',
    freezer: true,
    typedNames: true,
    manualPlaceholder: 'e.g. bananas, or a barcode number',
    matched: name => `Matches \u201C${name}\u201D in your pantry`,
    picked: name => `Filed as \u201C${name}\u201D in your pantry`,
    offList: name => `Matches \u201C${name}\u201D`,
  },
  log: {
    title: 'Scan to log',
    emptySubtitle: 'Scan a barcode to log what you ate. If it won\u2019t scan, type the number below.',
    confirmLabel: 'Next',
    // A log has no fridge and no freezer: it records that something was eaten,
    // which is the opposite of where a thing is being kept.
    freezer: false,
    typedNames: false,
    manualPlaceholder: 'Type a barcode number',
    matched: name => `Matches \u201C${name}\u201D`,
    picked: name => `Filed as \u201C${name}\u201D`,
    offList: name => `Matches \u201C${name}\u201D`,
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
   * The same two arguments `ReceiptImportSheet` hands over, minus the store
   * and the date — a barcode carries neither, and the finish sheet is where
   * they get answered anyway. **Nothing is written from here**, for the reason
   * that sheet gives: the thing on the other side of the confirm takes a whole
   * list off in one pass.
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
   *
   * `priceById` is the shelf price read beside the barcode (`ScanRow.priceMinor`)
   * for rows in the first array, keyed by item id: the last split of the same
   * kind, since a draft in `toAdd` carries its own on `priceMinor`. A row the
   * user cleared the price off, or one nothing near the code read as a price,
   * has no entry.
   */
  onApply: (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[],
    priceById: Readonly<Record<string, number>>
  ) => void;
  /**
   * A row's name, handed up when the person asks to photograph its label
   * instead of picking a catalog match. `'log'` context only (see the
   * button's own render condition) — `FoodLogScreen`'s barcode-not-found row
   * is where a person is holding the packet with nothing else to do with it.
   *
   * This sheet stays open behind whatever the caller does with it: the row
   * itself is untouched, so a name typed here is still there, and still
   * included, if the person cancels the photo and scans on. `ScanToLogFlow`
   * mints the catalog row only once the label photo is actually saved — see
   * its own `panelFor`.
   */
  onPhotographLabel?: (subject: LabelSubject) => void;
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
/** What a collapsed row says about itself, which is also its colour. */
type ChipTone = 'neutral' | 'new' | 'warn';

/**
 * The one short word at the end of a collapsed row: what state it is in. A fixed,
 * short label so the name keeps the row (see CLAUDE.md on text sharing a row
 * with a control).
 */
function StatusChip({
  styles, colors, tone, label,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  tone: ChipTone;
  label: string;
}) {
  const palette =
    tone === 'warn'
      ? { backgroundColor: colors.warningBg, color: colors.warningText }
      : tone === 'new'
        ? { backgroundColor: colors.accentSubtle, color: colors.accentText }
        : { backgroundColor: colors.bgTertiary, color: colors.textSecondary };
  return (
    <View style={[styles.chip, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.chipText, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

/**
 * One text field in an open row's editor, its label above it. The label sits
 * over the field instead of in a column beside it so that two fields can share
 * a line (Brand and Flavor) and so a long answer gets the whole width.
 */
function FieldInput({
  styles, label, half, style, ...input
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  /** Shares a line with its neighbour, each taking half. */
  half?: boolean;
} & React.ComponentProps<typeof TextField>) {
  return (
    <View style={half ? styles.fieldHalf : undefined}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextField
        style={[styles.fieldInput, style]}
        // Shelf words, not prose: see the name field below.
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={label}
        {...input}
      />
    </View>
  );
}

export function BarcodeScanSheet({ visible, onClose, onApply, context, onPhotographLabel }: Props) {
  // ==== store bindings and environment (scanner module, keyboard scroll) ====
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
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const addProduct = useGroceryStore(s => s.addProduct);
  const aliasItemFor = useGroceryStore(s => s.aliasItemFor);
  const gtinItemFor = useGroceryStore(s => s.gtinItemFor);
  const gtinProductFor = useGroceryStore(s => s.gtinProductFor);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  // ==== local state (camera permission, rows, typed entry, picker, editor) ====
  const [permission, requestPermission] = useCameraPermissions();
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [manual, setManual] = useState('');
  /** Why the last typed entry was refused, shown under the field until it is edited. */
  const [manualError, setManualError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  /**
   * The row whose catalog picker is open, or null. One at a time: the picker
   * is a list of its own, and two of them open down the sheet would bury the
   * rows still waiting to be read.
   */
  const [picking, setPicking] = useState<{ key: string; mode: 'item' | 'box' } | null>(null);
  /**
   * The row whose editor is open, or null. One at a time, for the reason
   * `picking` is: an open editor is a form, and several down the sheet would bury
   * the rows still waiting to be read. A row that comes back from the lookup
   * with nothing in it opens itself, since it is waiting on the person.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /**
   * The scanner folds to a strip while the keyboard is up. The form is what is
   * being used then, and a 200pt camera above a keyboard left a few lines of it
   * between the two. The scanner is unmounted rather than just shrunk, so it is
   * not reading codes the person has no way to aim at.
   */
  const keyboardHeight = useKeyboardHeight(visible);
  const keyboardUp = keyboardHeight > 0;
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

  // ==== resetting the session on close ====
  const reset = useCallback(() => {
    setRows([]);
    setManual('');
    setManualError(null);
    setPicking(null);
    setOpenKey(null);
    scannedGtinsRef.current = new Set();
  }, []);

  // Reset on close rather than on open, same rule the receipt sheet follows: a
  // sheet that stays mounted must not hand yesterday's unpack to today's.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  // ==== scan intake and lookup (camera and data scanner handlers, retry) ====
  const patchRow = useCallback((key: string, patch: Partial<ScanRow>) => {
    setRows(current => current.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  /**
   * Asks for the row's barcode and patches the answer in. Shared by the first
   * scan and by Retry, which is why it takes the key rather than creating a row.
   */
  const runLookup = useCallback(
    async (key: string, gtin: string) => {
      // A code this app has already been told about answers for itself when
      // the database can't: lookups switched off, no signal in the store, or a
      // cached miss. The row is named after the catalog row the code was
      // linked to, and the matcher then captions it "as you scanned it
      // before". It used to read "Not found. Type what it is." over a barcode
      // the app knew perfectly well.
      const remembered = () => {
        const itemId = gtinItemFor(gtin);
        return itemId ? useGroceryStore.getState().items.find(i => i.id === itemId) ?? null : null;
      };
      try {
        const record = await lookupGtin(gtin);
        const known = record ? null : remembered();
        if (record) {
          patchRow(key, {
            ...scannedItemFor(record),
            hasNutrition: !!record.nutrition,
            scanPanel: record.nutrition,
            pending: false,
            included: true,
          });
        } else if (known) {
          patchRow(key, { pending: false, name: known.name, included: true, error: null });
        } else {
          patchRow(key, { pending: false });
          setOpenKey(key);
        }
      } catch (e) {
        const known = remembered();
        if (known) patchRow(key, { pending: false, name: known.name, included: true, error: null });
        else {
          patchRow(key, { pending: false, error: describeLookupError(e) });
          setOpenKey(key);
        }
      }
    },
    [patchRow, gtinItemFor]
  );

  /**
   * Retry on a row whose lookup failed (no signal, a timeout, a bad minute at
   * the service). A miss the databases confirmed is a different state and is
   * not offered this: `lookupGtin` caches it, so asking again would only repeat it.
   */
  const retryLookup = useCallback(
    (key: string, gtin: string) => {
      setOpenKey(current => (current === key ? null : current));
      patchRow(key, { pending: true, error: null });
      void runLookup(key, gtin);
    },
    [patchRow, runLookup]
  );

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
      // Newest first, so the read that just landed is the one under the
      // camera. Appended, it sat below the fold once a few were scanned.
      setRows(current => [
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
        ...current,
      ]);
      keyboardScroll.ref.current?.scrollTo({ y: 0, animated: true });
      void runLookup(key, gtin);
    },
    [runLookup, keyboardScroll.ref]
  );

  /**
   * Every frame the camera resolves a code fires this, so the dedupe is what
   * makes it usable at all rather than a refinement — see `scannedGtinsRef`.
   */
  const handleBarcodeScanned = useCallback(
    // The type is what tells a UPC-E from an EAN-8; see normalizeGtin.
    ({ data, type }: { data: string; type?: string }) => {
      const gtin = normalizeGtin(data, type);
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

  // ==== typed entry ====
  /**
   * The typed field takes either half of what the camera can't do: a barcode
   * whose bars won't read (crushed box, freezer frost), or a name for something
   * that has no barcode at all.
   */
  const handleManualAdd = useCallback(() => {
    const entry = classifyTypedEntry(manual, CONTEXT_COPY[context].typedNames);
    if (!entry) return;
    // Refused out loud and left in the field to fix: digits that aren't a
    // barcode used to become a food named after them.
    if (entry.kind === 'invalid') {
      setManualError(
        entry.reason === 'digits'
          ? 'That isn\u2019t a valid barcode. Check the digits.'
          : 'Barcodes only here. To log a food by name, close this and add it from the food log.'
      );
      haptics.error();
      return;
    }
    if (entry.kind === 'gtin') {
      if (scannedGtinsRef.current.has(entry.gtin)) {
        setManualError('That barcode is already in the list.');
        haptics.warning();
        return;
      }
      scannedGtinsRef.current.add(entry.gtin);
      void addScan(entry.gtin);
    } else if (entry.kind === 'plu') {
      // A produce sticker. It goes in as a row keyed on the code rather than
      // named after it, so the alias table can answer for it now and learn it
      // if it can't — see `pluScannedItem`. A seeded name is a suggestion and
      // deliberately arrives unchecked: the built-in list is tiny and unverified,
      // so a wrong one has to be visible rather than silently accepted.
      //
      // A sticker this app has already been told about, though, is known: it
      // arrives named after the row it was filed under and ticked, the same
      // as a remembered barcode above.
      const suggested = pluNameFor(entry.plu);
      const scanned = pluScannedItem(entry.plu, suggested);
      const knownId = aliasItemFor(null, scanned.label);
      const known = knownId ? useGroceryStore.getState().items.find(i => i.id === knownId) : undefined;
      const pluKey = generateId();
      if (!known) setOpenKey(pluKey);
      setRows(current => [
        {
          ...scanned,
          ...(known ? { name: known.name } : {}),
          key: pluKey,
          included: !!known,
          pending: false,
          error: null,
          frozen: false,
          confirmedMatchId: null,
          pickedItemId: null,
          pickedProductId: null,
          priceMinor: null,
        },
        ...current,
      ]);
    } else {
      setRows(current => [
        {
          gtin: null,
          label: '',
          name: entry.name.slice(0, GROCERY_NAME_MAX_LENGTH),
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
        ...current,
      ]);
    }
    setManual('');
    setManualError(null);
    keyboardScroll.ref.current?.scrollTo({ y: 0, animated: true });
    haptics.tap();
  }, [manual, context, addScan, aliasItemFor, keyboardScroll.ref]);

  // ==== catalog matching and what each row resolved to ====
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

  /**
   * Whether a row is a food with no figures to log, in a log. Such a row isn't
   * ready: it is left out of Next's count and out of what Next hands on, so
   * nothing is minted for it and nothing is dropped without being said. It
   * becomes ready when its label is photographed or a match brings figures.
   */
  const needsNutritionFor = (row: ScanRow, match: ReceiptMatch | undefined): boolean => {
    if (context !== 'log' || row.pending || !row.name.trim() || pendingMatchId(row, match)) return false;
    const itemId = resolvedItemId(row, match);
    const item = itemId ? items.find(i => i.id === itemId) : null;
    if (item) {
      const box = productsForItem(item.id, itemProducts).find(
        b => b.id === (row.pickedProductId ?? gtinProductFor(row.gtin)?.id)
      );
      if (nutritionFor(item, box)) return false;
    }
    return !row.hasNutrition;
  };
  const includedCount = rows.filter(
    (r, i) => r.included && r.name.trim() && !needsNutritionFor(r, matches[i])
  ).length;
  const needNutritionCount = rows.filter((r, i) => needsNutritionFor(r, matches[i])).length;

  // ==== filing a row under a catalog item ====
  /**
   * Files a scanned row under a catalog item, from the picker's own results or
   * from a row it just minted. One path for both so a new item behaves exactly
   * like a picked one.
   */
  const pickItemFor = (row: ScanRow, item: GroceryItem) => {
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
  };

  // ==== applying the scans ====
  const applyNow = useCallback(() => {
    const itemIds: string[] = [];
    const toAdd: ReceiptAddDraft[] = [];
    const frozenItemIds = new Set<string>();
    const products: ScanProductDraft[] = [];
    const gtinLinks: ScannedGtinLink[] = [];
    const priceById: Record<string, number> = {};
    /**
     * The box, for a row that resolved to a catalog item that already exists.
     *
     * `variantFor` needs the item's own name to subtract, which is why this
     * lives here and not in the draft: only the sheet knows what each row
     * matched. A minted row gets no variant by the same logic — its item is
     * *named* after the residue, so there is nothing left over.
     */
    const recordProduct = (itemId: string, row: ScanRow) => {
      // The rule is `scanBoxChoice`, shared with the row's Product line so what
      // the sheet says it will file is what this writes. A pick that no longer
      // resolves falls through to the barcode's own words inside it.
      const choice = scanBoxChoice({
        itemId,
        itemName: items.find(i => i.id === itemId)?.name ?? null,
        picked: row.pickedProductId ? itemProducts.find(p => p.id === row.pickedProductId) : null,
        linked: gtinProductFor(row.gtin),
        label: row.label,
        brand: row.brand,
      });
      if (!choice) return;
      products.push({
        itemId,
        brand: choice.brand,
        variant: choice.variant,
        gtin: row.gtin,
        packSize: row.quantity,
      });
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
      if (needsNutritionFor(row, match)) return;
      const itemId = confidentItemId(row, match);
      if (itemId) {
        itemIds.push(itemId);
        if (row.frozen) frozenItemIds.add(itemId);
        // A matched row has no draft to carry the shelf price on, so it rides
        // a map of its own. See `Props.onApply`.
        if (row.priceMinor !== null) priceById[itemId] = row.priceMinor;
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
        // A looked-up row's brand, or the one typed over it. A row with neither
        // has none, and the screen skips the product write rather than storing
        // an empty box.
        brand: newItemBox(row).brand,
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
        // What was typed in the Variant field, else what shortening the name
        // left of the product's words: the item is the thing and this is which one.
        variant: newItemBox(row).variant,
      });
    });
    // Only rows whose label came off a lookup are worth remembering. A typed
    // row's "label" is the name the user just wrote, so an alias from it would
    // map a phrase to itself and teach nothing. A weak or unconfirmed likely
    // match is excluded for the same reason `confidentItemId` is: it's a
    // guess, not a confirmed reading worth teaching the alias table.
    rememberAliases([
      ...rows
        .map((row, index) => ({ row, itemId: confidentItemId(row, matches[index]), blocked: needsNutritionFor(row, matches[index]) }))
        .filter(({ row, itemId, blocked }) => row.included && !blocked && !!row.label && !!itemId)
        .map(({ row, itemId }) => ({
          shopId: null,
          rawText: row.label,
          itemId: itemId as string,
        })),
      ...toAdd
        .filter(d => d.existingItemId !== null && !!d.label)
        .map(d => ({ shopId: null, rawText: d.label, itemId: d.existingItemId as string })),
    ]);
    Keyboard.dismiss();
    onApply(itemIds, toAdd, frozenItemIds, products, gtinLinks, priceById);
  }, [rows, matches, items, itemProducts, onApply, rememberAliases, gtinProductFor, context]);

  /**
   * Whether the confirm is mid-flight. Applying is a run of synchronous
   * catalog and database writes followed by the next sheet opening, and the
   * button used to show nothing at all while that happened, so it was tapped
   * again and each tap ran the whole apply again (duplicate aliases and
   * boxes). Painting the pending state first, then doing the work, and
   * ignoring taps while it runs, is what makes the wait readable.
   */
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const handleApply = useCallback(() => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    haptics.tap();
    // Two frames: one to commit the pending label, one to paint it, before the
    // writes block the JS thread.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        applyNow();
      } finally {
        applyingRef.current = false;
        setApplying(false);
      }
    }));
  }, [applyNow]);

  // ==== row captions ====
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
    if (!row.name.trim()) return 'Not found. Tap to type what it is.';
    const match = matches[index];
    const itemId = confidentItemId(row, match);
    if (itemId) {
      const item = items.find(i => i.id === itemId);
      if (!item) return null;
      // Why it matched (barcode or name) is `captionNoteFor`'s line.
      return CONTEXT_COPY[context].matched(item.name);
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
    return null;
  };

  /**
   * The line under a row's item answer saying *why* it is that item, or what
   * happens when it isn't one yet. Split from `captionFor` so the answer stays
   * short and the reason is checkable: "scanned before" is a fact about the
   * barcode in your hand, "matched by name" is a guess you may want to correct.
   */
  const captionNoteFor = (row: ScanRow, index: number): string | null => {
    if (row.pending || row.error) return null;
    if (pickedTarget(row)) return 'Chosen by you';
    if (!row.name.trim()) return null;
    const match = matches[index];
    const matchedId = confidentItemId(row, match) ?? confidentOffListMatchId(row, match);
    if (matchedId) {
      if (row.gtin && gtinItemFor(row.gtin) === matchedId) return 'You scanned this barcode before';
      // Looks like a different food from everything filed under that item:
      // worth a second look before the barcode is remembered as this item.
      const matchedItem = items.find(i => i.id === matchedId);
      const known = matchedItem
        ? [matchedItem.nutrition, ...productsForItem(matchedId, itemProducts).map(p => p.nutrition)].filter(
            (n): n is FoodNutrition => !!n
          )
        : [];
      if (known.length > 0 && known.every(n => panelLooksWrongFor(row.scanPanel, n))) {
        return `Its nutrition is very different from your ${matchedItem?.name}. Check this is the same item`;
      }
      return match?.confidence === 'remembered'
        ? 'Matched by name, as you matched it before'
        : 'Matched by name';
    }
    if (pendingMatchId(row, match)) return 'Confirm it is the same item, or choose another';
    // Still wearing the barcode source's own words: say so, because the full
    // product name is what ends up as the item's name if nobody shortens it.
    if (nameFromScanFor(row)) {
      return 'Check the name, brand and flavor above, or match it to an item you already have';
    }
    return 'Saved as a new item when you continue';
  };

  // ==== the camera strip and cancel ====
  // An open editor is a form too: the 200pt camera over it left a few rows of
  // it between the camera and the bottom bar, so it folds the same way.
  const editing = openKey !== null && rows.some(r => r.key === openKey && !r.pending);

  const camera = () => {
    if (keyboardUp || editing) {
      return (
        <TouchableOpacity
          style={styles.cameraStrip}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { Keyboard.dismiss(); setPicking(null); setOpenKey(null); }}
          accessibilityRole="button"
          accessibilityLabel={`Scanner paused while you ${keyboardUp ? 'type' : 'edit'}. Tap to resume scanning`}
        >
          <Ionicons name="barcode-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={styles.cameraStripText}>
            {keyboardUp ? 'Scanner paused while you type. Tap to resume' : 'Scanner paused while you edit. Tap to resume'}
          </Text>
        </TouchableOpacity>
      );
    }
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
        <View style={styles.hint} pointerEvents="none">
          <View style={styles.hintPill}>
            <Text style={styles.hintText}>Hold a barcode inside the box</Text>
          </View>
        </View>
      </View>
    );
  };

  // A scan session — rows read off the camera, or a name/barcode typed by
  // hand — is nowhere until Add, so a swipe-down would otherwise drop it
  // with no dialog.
  const handleCancel = () => {
    const dirty = rows.length > 0 || manual.trim() !== '';
    if (!dirty) { Keyboard.dismiss(); onClose(); return; }
    confirmDiscard(() => { Keyboard.dismiss(); onClose(); });
  };

  return (
    <SheetModal name="Barcode scan" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title={CONTEXT_COPY[context].title}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={
            <SheetHeaderButton
              label={applying ? 'Working\u2026' : CONTEXT_COPY[context].confirmLabel}
              onPress={handleApply}
              disabled={includedCount === 0 || applying}
              minWidth={64}
            />
          }
        />

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
            <>
            <View style={styles.summary}>
              <Text style={styles.summaryText}>{rows.length} SCANNED</Text>
              {needNutritionCount > 0 && (
                <Text style={styles.summaryWarn}>{needNutritionCount} NEED NUTRITION</Text>
              )}
            </View>
            <View style={styles.card}>
              {rows.map((row, index) => {
                const match = matches[index];
                const caption = captionFor(row, index);
                const pendingId = pendingMatchId(row, match);
                const nameable = !row.pending;
                // The brand question, asked only once there is an item to ask it
                // about and brands to answer with.
                const rowItemId = resolvedItemId(row, match);
                const rowItem = rowItemId ? items.find(i => i.id === rowItemId) : null;
                const rowBoxes = rowItemId ? productsForItem(rowItemId, itemProducts) : [];
                const boxCount = rowBoxes.length;
                // A scanned code nothing in the catalog claimed will mint a new
                // item, so it is asked for the three things that make one: who
                // makes it, what it is, and which one. All three are plain
                // fields, because a barcode source's words are often a slogan
                // and no rule can pick the right split out of them.
                const mintsNew = nameable && !pickedTarget(row) && !rowItemId && !pendingId;
                // Every row gets the labelled Name field, and it stays mounted
                // whether or not the name has just matched an item: swapping it
                // for a plain one mid-keystroke would drop the keyboard. Brand
                // and Variant are the new item's alone, typed rows included.
                const showBox = mintsNew;
                const newBox = newItemBox(row);
                const onNameChange = (text: string) =>
                  patchRow(row.key, {
                    name: text.slice(0, GROCERY_NAME_MAX_LENGTH),
                    // Naming a row is the act that makes it recordable;
                    // clearing the name takes that back rather than
                    // leaving a checked row with nothing in it.
                    included: text.trim().length > 0,
                  });
                const resolvedName = rowItem?.name ?? null;
                const captionNote = captionNoteFor(row, index);
                // What Add will file this row's product as, from the same rule
                // that writes it, so the line is a statement and not a prompt.
                const boxChoice = rowItemId
                  ? scanBoxChoice({
                      itemId: rowItemId,
                      itemName: resolvedName,
                      picked: row.pickedProductId ? rowBoxes.find(b => b.id === row.pickedProductId) : null,
                      linked: gtinProductFor(row.gtin),
                      label: row.label,
                      brand: row.brand,
                    })
                  : null;
                const boxText = boxChoice ? describeProduct(boxChoice) : null;
                const boxNote =
                  boxChoice?.source === 'picked'
                    ? 'Chosen by you'
                    : boxChoice?.source === 'linked'
                      ? 'Linked to this barcode'
                      : boxChoice
                        ? 'Read from the barcode lookup'
                        : boxCount > 0
                          ? 'Optional. Tap to choose one'
                          : 'Optional. Tap to add one';
                // Whether figures already exist for what this row resolves to:
                // the product's or the catalog row's own, else the barcode
                // database's. Only then is "Add from label" a real next step.
                const nutritionSource: 'catalog' | 'database' | null =
                  rowItem && nutritionFor(
                    rowItem,
                    rowBoxes.find(b => b.id === (row.pickedProductId ?? gtinProductFor(row.gtin)?.id)),
                  )
                    ? 'catalog'
                    : row.hasNutrition
                      ? 'database'
                      : null;

                // ---- the collapsed line: name, one fact, one status ----
                const needsName = !row.name.trim() && !pickedTarget(row);
                // A food with no figures can't be logged, so in a log the row says
                // so before it is opened rather than only inside.
                const needsNutrition = needsNutritionFor(row, match);
                // What the checkbox shows: a row that can't be logged yet is
                // never drawn as going in, whatever its flag says.
                const ready = row.included && !needsNutrition;
                const title =
                  row.name.trim() || row.label || (row.gtin ? formatGtin(row.gtin) : 'Unnamed scan');
                const subtitle = row.pending
                  ? 'Looking it up…'
                  : row.error
                    ? row.error
                    : caption && (needsName || pendingId || rowItemId)
                      ? caption
                      : `${
                          [newBox.brand, newBox.variant].filter(Boolean).join(' · ') ||
                          (row.label ? 'New item' : row.gtin ? 'Barcode not found' : 'Typed by hand')
                        }${needsNutrition ? ' · No nutrition yet' : ''}`;
                const chip: { tone: ChipTone; label: string } | null = row.pending
                  ? null
                  : row.error
                    ? { tone: 'warn', label: 'Lookup failed' }
                    : needsName
                      ? { tone: 'warn', label: 'Needs a name' }
                      : pendingId
                        ? { tone: 'warn', label: 'Check match' }
                        : needsNutrition
                          ? { tone: 'warn', label: 'Add nutrition' }
                          : rowItemId
                            ? { tone: 'neutral', label: 'Matched' }
                            : { tone: 'new', label: 'New' };
                const open = openKey === row.key && !row.pending;
                const toggleOpen = () => {
                  setPicking(null);
                  setOpenKey(current => (current === row.key ? null : row.key));
                };
                const subject = row.name.trim() || row.label || 'this scan';
                // The match line's own answer. A row nobody has matched says what
                // the line is for instead of what it found.
                const matchSaysFound = !row.error && !!caption && !needsName;
                // The way out of a code nothing has heard of: the packet is in hand and
                // its figures are printed on it, so offer to read them off the label.
                // Log-only, and only once there's a name to attach the figures to and
                // nothing in the catalog has already answered for this row. When the
                // row can't be logged without it, it sits right under the name.
                // Outside a log nothing is asked of the figures, but a panel the
                // lookup read is still worth saying so: it is filed with the item
                // unseen otherwise.
                const foundPanelNote = describeFoodPanel(row.scanPanel ?? null);
                const nutritionBlock = !pendingId && !!row.name.trim() && (context !== 'log' ? (
                        nutritionSource === 'database' && foundPanelNote ? (
                          <ActionRow
                            icon="nutrition-outline"
                            title="Nutrition from the barcode lookup"
                            note={foundPanelNote}
                            tone="plain"
                            done
                            accessibilityLabel={`Nutrition facts for ${row.name.trim()} were found: ${foundPanelNote}`}
                          />
                        ) : null
                      ) : (
                        nutritionSource ? (
                          <ActionRow
                            icon="nutrition-outline"
                            title={nutritionSource === 'catalog' ? 'Nutrition on file' : 'Nutrition from the barcode lookup'}
                            note={nutritionSource === 'database' ? foundPanelNote : null}
                            tone="plain"
                            done
                            accessibilityLabel={`Nutrition facts for ${row.name.trim()} are already known`}
                          />
                        ) : !!onPhotographLabel && !row.pickedItemId ? (
                          <ActionRow
                            icon="nutrition-outline"
                            title="Add nutrition from the label"
                            note="Not found yet. Photograph the label to log it"
                            tone="action"
                            onPress={() => onPhotographLabel(labelSubjectNamed(row.name.trim()))}
                            accessibilityLabel={`Photograph the nutrition label for ${row.name.trim()}`}
                          />
                        ) : (
                          <ActionRow
                            icon="nutrition-outline"
                            title="No nutrition yet"
                            note="This item can’t be logged until it has nutrition facts"
                            tone="muted"
                            accessibilityLabel={`${row.name.trim()} has no nutrition facts yet`}
                          />
                        )
                      ));
                return (
                  <View key={row.key} style={index > 0 ? styles.rowDivided : undefined}>
                  <View style={styles.row}>
                    <TouchableOpacity hitSlop={11}
                      style={[
                        styles.check,
                        ready && { backgroundColor: colors.accentFill, borderColor: colors.accent },
                        needsNutrition && styles.checkBlocked,
                      ]}
                      activeOpacity={interaction.activeOpacity}
                      disabled={needsNutrition || (!row.name.trim() && !row.pickedItemId)}
                      onPress={() => patchRow(row.key, { included: !row.included })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: ready, disabled: needsNutrition }}
                      accessibilityLabel={`${row.name.trim() || 'Unnamed scan'}${needsNutrition ? '. Needs nutrition before it can be logged' : ''}`}
                    >
                      {ready && (
                        <Ionicons name="checkmark" size={iconSize.xs} color={colors.onAccent} />
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.rowMain}
                      activeOpacity={interaction.activeOpacity}
                      onPress={toggleOpen}
                      disabled={row.pending}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${title}. ${subtitle}. ${open ? 'Close' : 'Edit'}`}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
                        <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text>
                      </View>
                      {row.pending ? (
                        <ActivityIndicator size="small" color={colors.textTertiary} />
                      ) : (
                        <>
                          {chip && <StatusChip styles={styles} colors={colors} tone={chip.tone} label={chip.label} />}
                          <Ionicons
                            name={open ? 'chevron-up' : 'chevron-down'}
                            size={iconSize.xs}
                            color={colors.textTertiary}
                          />
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* ---- the editor: only the open row, so the sheet reads as a
                      short list with one form in it ---- */}
                  {open && (
                    <View style={styles.editor}>
                      <FieldInput
                        styles={styles}
                        label="NAME"
                        value={row.name}
                        placeholder="What is it?"
                        placeholderTextColor={colors.textTertiary}
                        onChangeText={onNameChange}
                        editable={nameable}
                        selectTextOnFocus
                      />
                      {needsNutrition && nutritionBlock}
                      {showBox && (
                        <View style={styles.fieldPair}>
                          <FieldInput
                            styles={styles}
                            label="BRAND"
                            half
                            value={row.brandEdit ?? newBox.brand ?? ''}
                            placeholder="e.g. Spindrift"
                            placeholderTextColor={colors.textTertiary}
                            onChangeText={text => patchRow(row.key, { brandEdit: text.slice(0, GROCERY_BRAND_MAX_LENGTH) })}
                          />
                          <FieldInput
                            styles={styles}
                            label="FLAVOR OR TYPE"
                            half
                            value={row.variantEdit ?? newBox.variant ?? ''}
                            placeholder="e.g. Lime"
                            placeholderTextColor={colors.textTertiary}
                            onChangeText={text => patchRow(row.key, { variantEdit: text.slice(0, GROCERY_VARIANT_MAX_LENGTH) })}
                          />
                        </View>
                      )}
                      {showBox && !!row.gtin && !!row.label ? (
                        <Text style={styles.rowLabel}>Barcode lookup: {row.label}</Text>
                      ) : (
                        !!sourceLineFor(row.name, row.label, row.brand) && (
                          <Text style={styles.rowLabel}>{sourceLineFor(row.name, row.label, row.brand)}</Text>
                        )
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

                      {/* Which item this is: a match to one you already have, or
                          the way to pick one. */}
                      <ActionRow
                        icon="link-outline"
                        title={matchSaysFound ? (caption as string) : row.error ?? 'Match to an item you already have'}
                        note={needsName ? 'Or type what it is above' : captionNote}
                        tone={row.error ? 'error' : matchSaysFound ? 'plain' : 'action'}
                        onPress={() => setPicking(p => (p?.key === row.key && p.mode === 'item' ? null : { key: row.key, mode: 'item' }))}
                        accessibilityLabel={
                          row.pickedItemId
                            ? `Change which item ${subject} is matched to`
                            : `Match ${subject} to an item you already have`
                        }
                        extra={
                          // The one decision worth a button: accepting the
                          // app's guess. A hand pick is undone here too.
                          !!pendingId ? (
                            <InlineAction
                              label="Confirm"
                              variant="neutral"
                              onPress={() => patchRow(row.key, { confirmedMatchId: pendingId })}
                              accessibilityLabel={`Confirm: ${caption}`}
                              style={styles.confirmPill}
                            />
                          ) : row.error && row.gtin ? (
                            <InlineAction
                              label="Retry"
                              icon="refresh"
                              variant="neutral"
                              onPress={() => retryLookup(row.key, row.gtin as string)}
                              accessibilityLabel={`Retry the barcode lookup for ${subject}`}
                              style={styles.confirmPill}
                            />
                          ) : row.pickedItemId ? (
                            <InlineAction
                              label="Undo"
                              variant="neutral"
                              onPress={() => { setPicking(null); patchRow(row.key, { pickedItemId: null, pickedProductId: null }); }}
                              accessibilityLabel={`Stop matching ${subject} by hand`}
                              style={styles.confirmPill}
                            />
                          ) : null
                        }
                      />
                      {/* Under the line it belongs to rather than at the foot of the
                          row: a result list sharing a line with its row would take
                          its width from whatever was left, and an item you cannot
                          read is one you cannot pick. Same `CatalogLinkPicker` a
                          recipe ingredient is tied to an item with. */}
                      {picking?.key === row.key && picking.mode === 'item' && (
                        <View style={styles.pickerWrap}>
                          <CatalogLinkPicker
                            items={items}
                            // The source's own words when the row has no name of its
                            // own, which is the miss this exists for.
                            initialQuery={row.name.trim() || row.label}
                            onPick={item => pickItemFor(row, item)}
                            onCreate={name => {
                              const item = ensureCatalogItem(name);
                              if (item) pickItemFor(row, item);
                            }}
                          />
                        </View>
                      )}

                      {/* Once the row is matched to an item. With brands on file it
                          is a choice among them; without, it is the way to add the
                          first one, so the brand and flavor can be recorded from
                          here rather than in the grocery screen afterwards. A row
                          that is new has these as the Brand and Flavor fields
                          above, which is why this line isn't shown for it. */}
                      {!!rowItemId && (
                        <ActionRow
                          icon="pricetag-outline"
                          title={boxText ?? 'No brand or flavor chosen'}
                          note={boxNote}
                          tone={boxText ? 'plain' : 'muted'}
                          onPress={() => setPicking(p => (p?.key === row.key && p.mode === 'box' ? null : { key: row.key, mode: 'box' }))}
                          accessibilityLabel={
                            boxText
                              ? `Filed as ${boxText}. Change which brand or flavor of ${resolvedName ?? 'this item'} this is`
                              : boxCount > 0
                                ? `Choose which brand or flavor of ${resolvedName ?? 'this item'} this is`
                                : `Add a brand or flavor to ${resolvedName ?? 'this item'}`
                          }
                        />
                      )}
                      {/* The second question, and deliberately its own control
                          rather than a step of the first: which item this is, then
                          which kind of it. Most scans never need it, because the
                          barcode's own words derive one perfectly well, so it sits
                          behind its own tap rather than lengthening every row. */}
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
                            onCreate={fields => {
                              if (!rowItemId) return false;
                              const made = addProduct(rowItemId, fields, { promote: false });
                              if (!made) return false;
                              setPicking(null);
                              patchRow(row.key, { pickedProductId: made.id });
                              return true;
                            }}
                            onPick={product => {
                              setPicking(null);
                              if (product) patchRow(row.key, { pickedProductId: product.id });
                            }}
                            label={resolvedName ? `WHICH KIND OF ${resolvedName.toUpperCase()}` : 'WHICH KIND'}
                          />
                        </View>
                      )}

                      {!needsNutrition && nutritionBlock}

                      {/* Where a thing is being kept, which a log has no
                          opinion about: it records that something was eaten. */}
                      {CONTEXT_COPY[context].freezer && (
                        <ActionRow
                          icon={row.frozen ? 'snow' : 'snow-outline'}
                          title="Going in the freezer"
                          note={row.frozen ? 'On' : 'Off. It goes in the fridge or pantry'}
                          tone="plain"
                          role="switch"
                          checked={row.frozen}
                          onPress={() => patchRow(row.key, { frozen: !row.frozen })}
                          accessibilityLabel={
                            row.frozen
                              ? 'Going in the freezer. Tap to change.'
                              : 'Add to the freezer instead of the fridge or pantry'
                          }
                        />
                      )}

                      <View style={styles.editorFoot}>
                        <Text style={styles.rowGtin}>{row.gtin ? formatGtin(row.gtin) : ''}</Text>
                        <TouchableOpacity
                          activeOpacity={interaction.activeOpacity}
                          style={styles.removeButton}
                          onPress={() => {
                            setRows(current => current.filter(r => r.key !== row.key));
                            // Removing a mistaken row un-claims its gtin, so
                            // holding the same box up again isn't a no-op.
                            if (row.gtin) scannedGtinsRef.current.delete(row.gtin);
                            setPicking(null);
                            setOpenKey(null);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${row.name.trim() || 'unnamed scan'}`}
                        >
                          <Text style={styles.removeText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  </View>
                );
              })}
            </View>
            </>
          )}

        </ScrollView>

        {/* Out of the scroll, so typing a code that won't scan never means
            finding the foot of a list. Lifted by the keyboard's own height:
            this sheet isn't one the system resizes for it. */}
        <View
          style={[
            styles.manualBar,
            { paddingBottom: keyboardHeight > 0 ? keyboardHeight + spacing.sm : Math.max(insets.bottom, spacing.md) },
          ]}
        >
          {!!manualError && <Text style={styles.manualError} accessibilityLiveRegion="polite">{manualError}</Text>}
          <View style={styles.manualRow}>
            <TextField
              style={styles.manualInput}
              value={manual}
              onChangeText={text => { setManual(text); if (manualError) setManualError(null); }}
              onSubmitEditing={handleManualAdd}
              returnKeyType="done"
              keyboardType={CONTEXT_COPY[context].typedNames ? 'default' : 'number-pad'}
              placeholder={CONTEXT_COPY[context].manualPlaceholder}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={CONTEXT_COPY[context].typedNames ? 'Add an item by name or barcode' : 'Add an item by barcode number'}
            />
            <InlineAction label="Add" icon="add" onPress={handleManualAdd} />
          </View>
        </View>
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
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
    // The folded scanner: one line, a step below the card's own surface, and the
    // whole strip is the way back to scanning.
    cameraStrip: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.bgSunken,
    },
    cameraStripText: { color: colors.textSecondary, fontSize: font.sm },
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
      borderColor: colors.onFill,
      borderRadius: radius.md,
      opacity: 0.6,
    },
    hint: { position: 'absolute', left: 0, right: 0, bottom: spacing.smd, alignItems: 'center' },
    hintPill: {
      backgroundColor: colors.backdrop,
      borderRadius: radius.full,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xs,
    },
    hintText: { color: colors.onFill, fontSize: font.xs },
    summary: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xsm },
    summaryText: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    summaryWarn: {
      color: colors.warningText,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    manualBar: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.smd,
      gap: spacing.xs,
      backgroundColor: colors.bg,
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
    },
    manualError: { color: colors.redText, fontSize: font.xs },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    // Full-height content container so EmptyState's own `flex: 1` has room
    // to center above the manual-add row, instead of collapsing to its
    // natural height right under the camera.
    bodyEmpty: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    // One line per scanned thing: checkbox, then the name and what is known about
    // it, then its status. Centred, now that the row is a name over one fact and
    // nothing taller.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    rowText: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    rowSubtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    chip: { borderRadius: radius.full, paddingHorizontal: spacing.smd, paddingVertical: spacing.xxs },
    chipText: { fontSize: font.xs, fontWeight: fontWeight.semibold },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    rowLabel: { color: colors.textTertiary, fontSize: font.xs },
    // Wraps, because the caption now shares its line with up to three pills
    // and a long "Filed as …" sentence would otherwise squeeze them off the
    // right edge — see CLAUDE.md on text losing a row to its buttons.
    captionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xxs,
    },
    rowCaption: { color: colors.textSecondary, fontSize: font.xs, flexShrink: 1 },
    // Sits directly under the line that opened it, inside the editor's own padding.
    pickerWrap: { paddingTop: spacing.xs },
    rowError: { color: colors.orangeText, fontSize: font.xs },
    // Tighter than `InlineAction`'s own default so a "Confirm" pill sitting
    // beside a caption reads as part of the line, not a control from a denser
    // grid of chips.
    confirmPill: { paddingVertical: 3, minHeight: 0 },
    editor: { paddingHorizontal: spacing.md, paddingBottom: spacing.smd, gap: spacing.sm },
    editorFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    removeButton: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
    removeText: { color: colors.redText, fontSize: font.sm, fontWeight: fontWeight.medium },
    rowGtin: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontVariant: ['tabular-nums'],
    },
    // The input sits on `bgSunken`, a step down from the card it is in, because a
    // bare field on a card reads as a line of text. The label is over it, so two
    // fields can share a line.
    fieldHalf: { flex: 1 },
    fieldPair: { flexDirection: 'row', gap: spacing.sm },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
    },
    fieldInput: {
      color: colors.text,
      fontSize: font.md,
      paddingHorizontal: spacing.smd,
      minHeight: 44,
      backgroundColor: colors.bgSunken,
      borderRadius: radius.md,
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
    // A row that can't be logged yet: the box is drawn, but empty and dashed.
    checkBlocked: { borderStyle: 'dashed', opacity: 0.7 },
    // The app's checkbox shape, same as the receipt sheet's.
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: checkboxRadius(CHECK_SIZE),
      borderWidth: 1.5,
      borderColor: colors.controlBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
