import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  getDataScannerView, isDataScannerAvailable, type DataScannerScan,
} from 'todo-datascanner-bridge';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import type { FoodNutrition } from '../types';
import { lookupGtin, describeLookupError } from '../services/productLookup';
import { normalizeGtin } from '../utils/gtin';
import { haptics } from '../utils/haptics';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * One barcode, scanned once, handed back as whatever nutrition its database
 * had — the camera-based sibling of `NutritionSearchSheet`'s by-name lookup,
 * opened from `NutritionPanelSheet` next to "Read from a photo".
 *
 * **It hands back a panel; it never saves one.** Same posture as the photo
 * path it sits beside: the caller lays the fetched figures into its own form,
 * where a person checks them against the packet before the sheet's own Save
 * commits anything. A barcode's figures are a manufacturer's declared label,
 * not a correction the person made, so this never stamps `source: 'manual'` —
 * `buildPanelNutrition` does that itself the moment Save is pressed, exactly
 * as it would for a typed or photographed figure.
 *
 * **A scan that finds no nutrition still says so**, rather than silently
 * reopening the camera for another try. A product with no label on file is a
 * different failure from a barcode neither database has heard of, and both
 * differ from lookups being switched off in Settings — `describeLookupError`
 * already gives that one its own sentence. "Try again" is what clears the
 * lock, not a timer, so a barcode still sitting in frame after a miss can't
 * refire the same lookup on every subsequent camera frame.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the found panel and the source's own name for it; the sheet closes itself right after. */
  onFound: (nutrition: FoodNutrition, sourceName: string) => void;
}

export function NutritionBarcodeScanSheet({ visible, onClose, onFound }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const DataScanner = useMemo(
    () => (isDataScannerAvailable() ? getDataScannerView() : null),
    [],
  );
  const [permission, requestPermission] = useCameraPermissions();

  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set the instant a code decodes, so a barcode still in frame after a miss
  // doesn't refire the same lookup on every subsequent frame. "Try again" is
  // what clears it, not a timer — see `handleTryAgain`.
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setLooking(false);
    setError(null);
    lockedRef.current = false;
  }, [visible]);

  const resolveGtin = useCallback(async (gtin: string) => {
    setLooking(true);
    setError(null);
    try {
      const record = await lookupGtin(gtin);
      if (record?.nutrition) {
        haptics.success();
        onFound(record.nutrition, record.name);
        onClose();
        return;
      }
      haptics.warning();
      setError(record
        ? `Found “${record.name}”, but it has no nutrition label on file. Try a photo, or type the figures in below.`
        : "That barcode isn't in either database. Try a photo, or type the figures in below.");
      setLooking(false);
    } catch (e) {
      haptics.warning();
      setError(describeLookupError(e));
      setLooking(false);
    }
  }, [onFound, onClose]);

  const handleScan = useCallback((raw: string) => {
    if (lockedRef.current) return;
    const gtin = normalizeGtin(raw);
    // A code that fails its own check digit is a misread, and a misread that
    // reached the network would offer somebody else's product's figures.
    if (!gtin) return;
    lockedRef.current = true;
    haptics.tap();
    void resolveGtin(gtin);
  }, [resolveGtin]);

  const handleDataScan = useCallback(
    ({ nativeEvent }: { nativeEvent: DataScannerScan }) => handleScan(nativeEvent.value),
    [handleScan],
  );
  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => handleScan(data),
    [handleScan],
  );

  const handleTryAgain = useCallback(() => {
    lockedRef.current = false;
    setError(null);
  }, []);

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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Scan a barcode</Text>
          <View style={styles.headerSpacer} />
        </View>

        {camera()}

        <View style={styles.body}>
          {looking && (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.hint}>Looking that up…</Text>
            </View>
          )}
          {!!error && (
            <>
              <Text style={styles.error}>{error}</Text>
              <View style={styles.tryAgainRow}>
                <InlineAction label="Try again" variant="neutral" onPress={handleTryAgain} />
              </View>
            </>
          )}
          {!looking && !error && (
            <Text style={styles.hint}>Line up the barcode on the package.</Text>
          )}
        </View>
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
    headerSpacer: { minWidth: 64 },
    cameraWrap: {
      height: 260,
      backgroundColor: colors.bgSunken,
      overflow: 'hidden',
    },
    cameraPlaceholder: {
      height: 260,
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
    body: { padding: spacing.md, gap: spacing.sm },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    hint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    error: { color: colors.red, fontSize: font.sm, lineHeight: 18 },
    tryAgainRow: { flexDirection: 'row' },
  });
}
