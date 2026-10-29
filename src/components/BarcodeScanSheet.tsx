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
import { EmptyState } from './EmptyState';
import { ActionRow } from './ActionRow';
import type { ReceiptAddDraft } from './ReceiptImportSheet';
import type { ReceiptMatch } from '../utils/receiptMatch';
import { lookupGtin, describeLookupError } from '../services/productLookup';
import { suggestItemType } from '../services/aiSuggestions';
import { formatGtin, normalizeGtin } from '../utils/gtin';
import { productsForItem } from '../utils/groceryProduct';
import { nutritionFor, panelLooksWrongFor } from '../utils/foodNutrition';
import { priceNearBarcode } from '../utils/shelfLabel';
import { formatPrice } from '../utils/groceryPrice';
import { pluNameFor } from '../utils/plu';
import {
  classifyTypedEntry,
  matchScans,
  scanBoxChoice,
  itemSourceLabel,
  pluScannedItem,
  nameFromScanFor,
  newItemBox,
  scannedItemFor,
  unknownScannedItem,
  type ScannedGtinLink,
  type ScannedItem,
} from '../utils/scanResolve';
import { probablyHaveReason, rankGrocerySuggestions } from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import { catalogSpellingOf, itemTypeFromCategory, itemTypeMoveFor } from '../utils/scanItemType';
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
import { RotatingChevron } from './RotatingChevron';

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
   * The person typed in the Item field. Until then the field shows what the app
   * resolved the scan to (a catalog row's own name, or the lookup's words); once
   * set it shows exactly what was typed, and the barcode's linked row stops
   * answering for the row, since a different name is a different thing.
   */
  nameTyped?: boolean;
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
   * What kind of item the barcode's own words leave unsaid ("Ice cream" for a
   * flavor name), offered as a chip under Name. `undefined` is not asked yet or
   * still being asked, `null` is asked and nothing usable. Never applied until
   * tapped; see `scanItemType.ts` for the rules on when it is offered.
   */
  typeSuggestion?: { name: string; source: 'category' | 'model' } | null;
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
  },
  pantry: {
    title: 'Scan into pantry',
    emptySubtitle: 'Scan a barcode to add it to the pantry. Type anything without a barcode below.',
    confirmLabel: 'Add',
    freezer: true,
    typedNames: true,
    manualPlaceholder: 'e.g. bananas, or a barcode number',
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
   * The row whose editor is open, or null. One at a time: an open editor is a
   * form, and several down the sheet would bury the rows still waiting to be read. A row that comes back from the lookup
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
          const catalogNames = useGroceryStore.getState().items.map(i => i.name);
          const fromCategory = itemTypeFromCategory(record.category);
          patchRow(key, {
            ...scannedItemFor(record),
            hasNutrition: !!record.nutrition,
            scanPanel: record.nutrition,
            pending: false,
            included: true,
            typeSuggestion: fromCategory
              ? { name: catalogSpellingOf(fromCategory, catalogNames), source: 'category' }
              : undefined,
          });
          // Only when the source's category had no usable noun, and after the
          // row is on screen: the person is holding the next item, so the
          // model fills a chip in later and never holds the row up.
          if (!fromCategory) {
            void suggestItemType(
              { name: record.name, brand: record.brand, category: record.category },
              catalogNames,
            ).then(answer => {
              const name = answer ? catalogSpellingOf(answer, catalogNames) : null;
              setRows(current =>
                current.map(r =>
                  r.key === key && r.typeSuggestion === undefined
                    ? { ...r, typeSuggestion: name ? { name, source: 'model' } : null }
                    : r
                )
              );
            });
          }
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
        // A name the person typed is a different answer from the barcode's: the
        // code's linked row and remembered phrase stop speaking for the row.
        scan => ((scan as ScanRow).nameTyped ? null : gtinItemFor(scan.gtin) ?? aliasItemFor(null, scan.label))
      ),
    [rows, items, aliasItemFor, gtinItemFor]
  );

  /**
   * Only a match that is not a guess is applied: an exact name, or a barcode or
   * phrase the person linked before. A `'likely'` or `'weak'` read ("cream" in
   * both "Boston Cream Pie" and "Heavy Cream") is only a shared word, so it
   * never files a scan under a row on its own. Such a row is a new thing, and the
   * existing rows that resemble it are offered under the Item field to tap.
   */
  const sure = (confidence: ReceiptMatchConfidence | null) =>
    confidence === 'exact' || confidence === 'remembered';
  const confidentItemId = (_row: ScanRow, match: ReceiptMatch | undefined): string | null =>
    match?.itemId && sure(match.confidence) ? match.itemId : null;
  const confidentOffListMatchId = (_row: ScanRow, match: ReceiptMatch | undefined): string | null =>
    !match?.itemId && match?.offListMatchId && sure(match.offListConfidence) ? match.offListMatchId : null;
  /** The row's item, on the list or off it, or null for a new thing. */
  const resolvedItemId = (row: ScanRow, match: ReceiptMatch | undefined): string | null =>
    confidentItemId(row, match) ?? confidentOffListMatchId(row, match);

  /** Whether the pantry would say it has this, by the same rule the Pantry screen uses. */
  const inPantry = (item: GroceryItem): boolean => probablyHaveReason(item, new Date(), itemProducts) !== null;

  /**
   * Whether a row is a food with no figures to log, in a log. Such a row isn't
   * ready: it is left out of Next's count and out of what Next hands on, so
   * nothing is minted for it and nothing is dropped without being said. It
   * becomes ready when its label is photographed or a match brings figures.
   */
  const needsNutritionFor = (row: ScanRow, match: ReceiptMatch | undefined): boolean => {
    if (context !== 'log' || row.pending || !row.name.trim()) return false;
    const itemId = resolvedItemId(row, match);
    const item = itemId ? items.find(i => i.id === itemId) : null;
    if (item) {
      const box = productsForItem(item.id, itemProducts).find(
        b => b.id === gtinProductFor(row.gtin)?.id
      );
      if (nutritionFor(item, box)) return false;
    }
    return !row.hasNutrition;
  };
  const includedCount = rows.filter(
    (r, i) => r.included && r.name.trim() && !needsNutritionFor(r, matches[i])
  ).length;
  const needNutritionCount = rows.filter((r, i) => needsNutritionFor(r, matches[i])).length;

  /**
   * The rename a row's type suggestion would make, or null. Only for a row that
   * would mint a new item and whose name nobody has typed: one that matched
   * something already has a name the catalog chose.
   */
  const typeMoveOf = (row: ScanRow, match: ReceiptMatch | undefined) =>
    !row.pending && !row.nameTyped && !resolvedItemId(row, match)
      ? itemTypeMoveFor(row, row.typeSuggestion?.name)
      : null;
  const typeMoves = rows.map((row, i) => typeMoveOf(row, matches[i]));
  /**
   * Pre-fills Item and Flavor from the suggestion ("Edamame" and "Chili Lime" for
   * a product named "Chili Lime Flavored Edamame") as soon as it arrives, rather
   * than offering it as a button. It is only a starting point in two editable
   * fields, and a name the person has typed is never touched.
   */
  useEffect(() => {
    rows.forEach((row, i) => {
      const move = typeMoves[i];
      if (move) patchRow(row.key, { name: move.name, variantEdit: move.variant, typeSuggestion: null });
    });
    // `typeMoves` is derived from the two below; listing it would re-run this on
    // every render, and a row whose move was applied has none left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, matches]);

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
        picked: null,
        linked: gtinProductFor(row.gtin),
        label: row.label,
        brand: row.brand,
        variantEdit: row.variantEdit,
        brandEdit: row.brandEdit,
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
      if (!row.included) return;
      const match = matches[index];
      // A row filed under an existing item needs no name of its own.
      if (!row.name.trim() && !resolvedItemId(row, match)) return;
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

  // ==== row warnings ====
  /**
   * A reason to doubt a match, when what the barcode says is very different from
   * everything already filed under it: worth a second look before the code is
   * remembered as this. Null when there is nothing to say.
   */
  const matchWarningFor = (row: ScanRow, matchedId: string | null): string | null => {
    if (!matchedId) return null;
    const matchedItem = items.find(i => i.id === matchedId);
    const known = matchedItem
      ? [matchedItem.nutrition, ...productsForItem(matchedId, itemProducts).map(p => p.nutrition)].filter(
          (n): n is FoodNutrition => !!n
        )
      : [];
    return known.length > 0 && known.every(n => panelLooksWrongFor(row.scanPanel, n))
      ? `Its nutrition is very different from your ${matchedItem?.name}. Check this is the same thing.`
      : null;
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
          onPress={() => { Keyboard.dismiss(); setOpenKey(null); }}
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
              {/* nothing else: the rows say what they need */}
            </View>
            <View style={styles.card}>
              {rows.map((row, index) => {
                const match = matches[index];
                const nameable = !row.pending;
                // What the scan resolved to. A row the app already knows is shown
                // by that row's own name and brand, pre-filled; anything else is
                // the lookup's words, split into the same three fields.
                const rowItemId = resolvedItemId(row, match);
                const rowItem = rowItemId ? items.find(i => i.id === rowItemId) ?? null : null;
                const newBox = newItemBox(row);
                const boxChoice = rowItem
                  ? scanBoxChoice({
                      itemId: rowItem.id,
                      itemName: rowItem.name,
                      picked: null,
                      linked: gtinProductFor(row.gtin),
                      label: row.label,
                      brand: row.brand,
                      variantEdit: row.variantEdit,
                      brandEdit: row.brandEdit,
                    })
                  : null;
                const shownName = rowItem && !row.nameTyped ? rowItem.name : row.name;
                const shownBrand = rowItem ? row.brandEdit ?? boxChoice?.brand ?? '' : newBox.brand ?? '';
                const shownVariant = rowItem ? row.variantEdit ?? boxChoice?.variant ?? '' : newBox.variant ?? '';

                const needsName = !rowItem && !row.name.trim();
                // A food with no figures can't be logged, so in a log the row says
                // so before it is opened rather than only inside.
                const needsNutrition = needsNutritionFor(row, match);
                // What the checkbox shows: a row that can't be logged yet is
                // never drawn as going in, whatever its flag says.
                const ready = row.included && !needsNutrition;
                const title = shownName.trim() || row.label || (row.gtin ? formatGtin(row.gtin) : 'Unnamed scan');
                const brandFlavor = [shownBrand, shownVariant].filter(Boolean).join(' · ');
                const subtitle = row.pending
                  ? 'Looking it up…'
                  : row.error
                    ? row.error
                    : needsName
                      ? 'Not found. Tap to type what it is.'
                      : `${brandFlavor || (row.gtin ? (row.label ? '' : 'Barcode not found') : 'Typed by hand')}${
                          needsNutrition ? `${brandFlavor ? ' · ' : ''}No nutrition yet` : ''
                        }`;
                // Only a row that needs something says so. "New" and "Known" were
                // chips on every row and told nobody anything they could act on.
                const chip: { tone: ChipTone; label: string } | null = row.pending
                  ? null
                  : row.error
                    ? { tone: 'warn', label: 'Lookup failed' }
                    : needsName
                      ? { tone: 'warn', label: 'Needs a name' }
                      : needsNutrition
                        ? { tone: 'warn', label: 'Add nutrition' }
                        : null;
                const open = openKey === row.key && !row.pending;
                const toggleOpen = () => setOpenKey(current => (current === row.key ? null : row.key));
                const subject = shownName.trim() || row.label || 'this scan';

                // The three fields. Editing Item says it is a different thing than
                // the app resolved; a name that is exactly an existing item's
                // resolves to it by the same rule a scan does.
                const onItemChange = (text: string) =>
                  patchRow(row.key, {
                    name: text.slice(0, GROCERY_NAME_MAX_LENGTH),
                    nameTyped: true,
                    // Naming a row is the act that makes it recordable;
                    // clearing the name takes that back rather than
                    // leaving a checked row with nothing in it.
                    included: text.trim().length > 0,
                  });
                // Existing things that resemble what is typed, to tap instead of
                // typing the rest. Not for a row already resolved: that one is known.
                const nameKey = groceryNameKey(shownName);
                const suggestions =
                  open && nameable && !rowItem && shownName.trim().length >= 2
                    ? rankGrocerySuggestions(shownName, items, new Date(), 4)
                        .filter(entry => entry.item.nameKey !== nameKey)
                        .slice(0, 3)
                    : [];
                const matchWarning = matchWarningFor(row, rowItemId);
                const foundLabel = !!rowItem && itemSourceLabel(rowItem, inPantry(rowItem));

                // The way out of a code nothing has heard of: the packet is in hand and
                // its figures are printed on it, so offer to read them off the label.
                // Only in a log, where a food with no figures can't be recorded.
                const nutritionBlock = needsNutrition ? (
                  !!onPhotographLabel ? (
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
                ) : null;
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
                      disabled={needsNutrition || !title.trim() || needsName}
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
                        {!!subtitle && <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text>}
                      </View>
                      {row.pending ? (
                        <ActivityIndicator size="small" color={colors.textTertiary} />
                      ) : (
                        <>
                          {chip && <StatusChip styles={styles} colors={colors} tone={chip.tone} label={chip.label} />}
                          <RotatingChevron open={open} size={iconSize.xs} color={colors.textTertiary} />
                        </>
                      )}
                    </TouchableOpacity>
                    {/* Beside the row rather than inside its touchable, so it is its
                        own control. Where a thing is kept, which a log has no
                        opinion about: it records that something was eaten. */}
                    {CONTEXT_COPY[context].freezer && !row.pending && (
                      <TouchableOpacity
                        style={styles.freezerButton}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { haptics.tap(); patchRow(row.key, { frozen: !row.frozen }); }}
                        hitSlop={{ top: spacing.xs, bottom: spacing.xs }}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: row.frozen }}
                        accessibilityLabel={
                          row.frozen ? `${title}, going in the freezer. Tap to change.` : `Put ${title} in the freezer`
                        }
                      >
                        <Ionicons
                          name={row.frozen ? 'snow' : 'snow-outline'}
                          size={iconSize.sm}
                          color={row.frozen ? colors.accent : colors.textTertiary}
                        />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* The editor: only the open row, so the sheet reads as a short list
                      with one form in it. Item, Brand and Flavor, pre-filled. */}
                  {open && (
                    <View style={styles.editor}>
                      {!!row.error && !!row.gtin && (
                        <ActionRow
                          icon="alert-circle-outline"
                          title={row.error}
                          tone="error"
                          accessibilityLabel={row.error}
                          extra={
                            <InlineAction
                              label="Retry"
                              icon="refresh"
                              variant="neutral"
                              onPress={() => retryLookup(row.key, row.gtin as string)}
                              accessibilityLabel={`Retry the barcode lookup for ${subject}`}
                              style={styles.confirmPill}
                            />
                          }
                        />
                      )}
                      <View style={styles.itemField}>
                        <FieldInput
                          styles={styles}
                          label="ITEM"
                          value={shownName}
                          placeholder="e.g. Edamame"
                          placeholderTextColor={colors.textTertiary}
                          onChangeText={onItemChange}
                          editable={nameable}
                          selectTextOnFocus
                        />
                        {!!rowItem && (
                          <Text style={styles.rowLabel}>{`Same as ${rowItem.name}. ${foundLabel}.`}</Text>
                        )}
                        {!!matchWarning && <Text style={styles.rowCaption}>{matchWarning}</Text>}
                        {suggestions.length > 0 && (
                          <View style={styles.suggestions}>
                            <Text style={styles.rowLabel}>Same as one of these?</Text>
                            <View style={styles.suggestionPills}>
                              {suggestions.map(entry => (
                                <InlineAction
                                  key={entry.item.id}
                                  label={entry.item.name}
                                  variant="neutral"
                                  onPress={() => {
                                    patchRow(row.key, { name: entry.item.name, nameTyped: true, included: true });
                                  }}
                                  accessibilityLabel={`Use ${entry.item.name}, ${itemSourceLabel(entry.item, inPantry(entry.item))}`}
                                />
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                      {nutritionBlock}
                      <View style={styles.fieldPair}>
                        <FieldInput
                          styles={styles}
                          label="BRAND"
                          half
                          value={shownBrand}
                          placeholder="e.g. Biena"
                          placeholderTextColor={colors.textTertiary}
                          onChangeText={text => patchRow(row.key, { brandEdit: text.slice(0, GROCERY_BRAND_MAX_LENGTH) })}
                          editable={nameable}
                        />
                        <FieldInput
                          styles={styles}
                          label="FLAVOR"
                          half
                          value={shownVariant}
                          placeholder="e.g. Chili lime"
                          placeholderTextColor={colors.textTertiary}
                          onChangeText={text => patchRow(row.key, { variantEdit: text.slice(0, GROCERY_VARIANT_MAX_LENGTH) })}
                          editable={nameable}
                        />
                      </View>

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
    summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xsm },
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
    rowError: { color: colors.orangeText, fontSize: font.xs },
    // Tighter than `InlineAction`'s own default so a "Confirm" pill sitting
    // beside a caption reads as part of the line, not a control from a denser
    // grid of chips.
    confirmPill: { paddingVertical: 3, minHeight: 0 },
    editor: { paddingHorizontal: spacing.md, paddingBottom: spacing.smd, gap: spacing.smd },
    // The Item field and, under it, what the app knows about the name typed.
    itemField: { gap: spacing.xs },
    suggestions: { gap: spacing.xs, marginTop: spacing.xs },
    suggestionPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    // Beside a row's own touchable, so it is its own control for VoiceOver.
    freezerButton: { justifyContent: 'center', alignSelf: 'stretch', paddingLeft: spacing.xs },
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
