import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import type { ReceiptAddDraft } from './ReceiptImportSheet';
import type { ReceiptMatch } from '../utils/receiptMatch';
import { lookupGtin, describeLookupError } from '../services/productLookup';
import { formatGtin, normalizeGtin } from '../utils/gtin';
import { normalizePlu, pluNameFor } from '../utils/plu';
import {
  matchScans,
  pluScannedItem,
  scannedItemFor,
  sourceLabelFor,
  unknownScannedItem,
  type ScannedItem,
} from '../utils/scanResolve';
import { generateId } from '../utils/id';
import { haptics } from '../utils/haptics';
import { GROCERY_NAME_MAX_LENGTH } from '../types';

/** Matches the shopping list's own checkbox, same as the receipt sheet's. */
const CHECK_SIZE = 22;

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
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Which screen is scanning, and so what a matched row means to say.
   *
   * The session itself — camera, lookup, matching against the catalog — is
   * identical either way; only the words are different. `'shopping'` (from
   * `GroceryScreen`, mid-unpack) frames a match in terms of the list;
   * `'pantry'` (from `KitchenScreen`) frames it in terms of the catalog,
   * since scanning there never touches `onList` at all — see `onApply`.
   */
  context: 'shopping' | 'pantry';
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
   */
  onApply: (itemIds: string[], toAdd: ReceiptAddDraft[]) => void;
}

/**
 * Scanning groceries one barcode at a time — mid-unpack from `GroceryScreen`
 * (`context="shopping"`), or straight into the catalog from `KitchenScreen`'s
 * Pantry screen (`context="pantry"`). The session is one flow either way;
 * only the row captions and the header title read differently, since a
 * pantry scan never puts anything on the shopping list at all.
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
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const rememberAliases = useGroceryStore(s => s.rememberAliases);
  const aliasItemFor = useGroceryStore(s => s.aliasItemFor);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [permission, requestPermission] = useCameraPermissions();
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [manual, setManual] = useState('');
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
    async (gtin: string) => {
      const key = generateId();
      setRows(current => [
        ...current,
        { ...unknownScannedItem(gtin), key, included: false, pending: true, error: null },
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
          quantity: '',
          key: generateId(),
          included: true,
          pending: false,
          error: null,
        },
      ]);
    }
    setManual('');
    haptics.tap();
  }, [manual, addScan]);

  // No store: at unpack time nobody has said where the bag came from, and a
  // product name off a barcode database reads the same whichever shop it was.
  const matches = useMemo(
    () => matchScans(rows, items, line => aliasItemFor(null, line.label)),
    [rows, items, aliasItemFor]
  );
  const includedCount = rows.filter(r => r.included && r.name.trim()).length;

  /**
   * A weak match is a single coincidental word in common ("cream" in both
   * "Boston Cream Pie" and "Heavy Cream") and nothing more — not confirmation
   * this scan is that row. `acceptedByDefault` already refuses to pre-check
   * one for a receipt; a scan gets no separate confirmation step at all, so
   * it must refuse even harder and treat a weak read as no match.
   */
  const confidentItemId = (match: ReceiptMatch | undefined): string | null =>
    match?.itemId && match.confidence !== 'weak' ? match.itemId : null;
  const confidentOffListMatchId = (match: ReceiptMatch | undefined): string | null =>
    match?.offListMatchId && match.offListConfidence !== 'weak' ? match.offListMatchId : null;

  const handleApply = useCallback(() => {
    const itemIds: string[] = [];
    const toAdd: ReceiptAddDraft[] = [];
    rows.forEach((row, index) => {
      if (!row.included || !row.name.trim()) return;
      const match = matches[index];
      const itemId = confidentItemId(match);
      if (itemId) {
        itemIds.push(itemId);
        return;
      }
      toAdd.push({
        existingItemId: confidentOffListMatchId(match),
        name: row.name.trim(),
        // The product's own full name is the raw text a new row is parsed from,
        // exactly as a receipt hands over its printed line. Falls back to the
        // shopper name for a typed row, which has no other words to offer.
        label: row.label || row.name.trim(),
        // Only a looked-up row has one; a typed row's brand is null, and the
        // screen skips the product write rather than storing an empty box.
        brand: row.brand,
        quantity: row.quantity,
        priceMinor: null,
      });
    });
    // Only rows whose label came off a lookup are worth remembering. A typed
    // row's "label" is the name the user just wrote, so an alias from it would
    // map a phrase to itself and teach nothing. A weak match is excluded for
    // the same reason `confidentItemId` is: it's a coincidence, not a
    // confirmed reading worth teaching the alias table.
    rememberAliases([
      ...rows
        .map((row, index) => ({ row, itemId: confidentItemId(matches[index]) }))
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
    onApply(itemIds, toAdd);
  }, [rows, matches, onApply, rememberAliases]);

  /** What a row resolved to, or null when it has nothing to say yet. */
  const captionFor = (row: ScanRow, index: number): string | null => {
    if (row.pending) return 'Looking it up…';
    if (row.error) return row.error;
    if (!row.name.trim()) return 'Not found. Type what it is.';
    const match = matches[index];
    const itemId = confidentItemId(match);
    if (itemId) {
      const item = items.find(i => i.id === itemId);
      if (!item) return null;
      if (context === 'pantry') {
        return match?.confidence === 'remembered'
          ? `Matches “${item.name}”, as you matched it before`
          : `Matches “${item.name}” in your pantry`;
      }
      return match?.confidence === 'remembered'
        ? `On your list as ${item.name}, as you matched it before`
        : `On your list as ${item.name}`;
    }
    const offListMatchId = confidentOffListMatchId(match);
    if (offListMatchId) {
      const item = items.find(i => i.id === offListMatchId);
      if (!item) return null;
      return context === 'pantry' ? `Matches “${item.name}”` : `Back on the list as ${item.name}`;
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
        <View style={styles.reticle} pointerEvents="none" />
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>
            {context === 'pantry' ? 'Scan into pantry' : 'Scan groceries'}
          </Text>
          <SheetHeaderButton
            label="Add"
            onPress={handleApply}
            disabled={includedCount === 0}
            minWidth={64}
          />
        </View>

        {camera()}

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {rows.length === 0 ? (
            <EmptyState
              icon="barcode-outline"
              title="Nothing scanned yet"
              subtitle={
                context === 'pantry'
                  ? 'Point the camera at a barcode to add it to the pantry. Anything without one, type below.'
                  : 'Point the camera at a barcode as you unpack. Anything without one, type below.'
              }
            />
          ) : (
            <View style={styles.card}>
              {rows.map((row, index) => {
                const caption = captionFor(row, index);
                const nameable = !row.pending;
                return (
                  <View key={row.key} style={[styles.row, index > 0 && styles.rowDivided]}>
                    <TouchableOpacity
                      style={[
                        styles.check,
                        styles.rowControl,
                        row.included && { backgroundColor: colors.accent, borderColor: colors.accent },
                      ]}
                      activeOpacity={interaction.activeOpacity}
                      disabled={!row.name.trim()}
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
                        accessibilityLabel="Item name"
                      />
                      {/* The words the lookup used, kept verbatim: the only way
                          to check the name above is against the box in hand.
                          The maker leads it when the name doesn't already say
                          who it is — see `sourceLabelFor`. */}
                      {!!row.label && (
                        <Text style={styles.rowLabel}>{sourceLabelFor(row.label, row.brand)}</Text>
                      )}
                      {!!caption && (
                        <Text style={row.error ? styles.rowError : styles.rowCaption}>{caption}</Text>
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
      paddingVertical: spacing.sm,
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
    rowCaption: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
    rowError: { color: colors.orange, fontSize: font.xs, marginTop: 2 },
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
