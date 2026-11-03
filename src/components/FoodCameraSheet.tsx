import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSheetOpening } from '../hooks/useSheetOpening';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetModal } from './SheetModal';
import { PressableScale } from './PressableScale';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { normalizeGtin } from '../utils/gtin';
import { alertPermissionOff } from '../utils/permissionAlert';
import { pickRecipePhoto, recipePhotoFromFile, type RecipePhoto, type RecipePhotoResult } from '../utils/recipePhoto';
import {
  CAPTURE_MODE_LABEL, captureHint, resolveCaptureMode, type CaptureMode,
} from '../utils/foodCapture';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * The food log's one camera, opened by "Scan or photograph".
 *
 * **It takes a picture or reads a code and hands it on; it logs nothing.** A
 * barcode goes to `onBarcode`, a photo to `onPhoto` with the mode it was taken
 * in, and the caller decides what each one becomes (the scan session, the label
 * panel, the meal estimate). The flows those start are the ones the four
 * separate tiles used to open, unchanged.
 *
 * **Mode is the person's choice, not a guess**, for the cost reason in
 * `foodCapture.ts`: a label is read on the device for free and a meal photo is a
 * billed estimate. A barcode is read live in Package mode only, so a plate
 * photographed under a barcode can't be mistaken for a scan.
 *
 * The caller closes this sheet in its `onBarcode`/`onPhoto` handler, in the same
 * commit that opens whatever comes next, which `SheetModal` sequences.
 */
interface Props {
  visible: boolean;
  /** The modes the caller can honor, in switch order. Never empty. */
  modes: CaptureMode[];
  onClose: () => void;
  /** A barcode read in Package mode, already checked and normalized. Omitted where scanning is off. */
  onBarcode?: (gtin: string) => void;
  /** A photo, from the shutter or the library, and the mode it was taken in. */
  onPhoto: (mode: CaptureMode, photo: RecipePhoto) => void;
}

export function FoodCameraSheet({ visible, modes, onClose, onBarcode, onPhoto }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [chosen, setChosen] = useState<CaptureMode>(modes[0] ?? 'package');
  const mode = resolveCaptureMode(chosen, modes);
  const [busy, setBusy] = useState(false);
  // A code is frame-by-frame: the camera reports the same one every frame it is
  // in view, and the first valid one is the answer.
  const handledRef = useRef(false);
  // Which opening a photo belongs to. Encoding takes a moment, and the sheet can
  // be closed (or reopened) while it runs; the result must not land in the next
  // opening.
  const openings = useSheetOpening(visible);

  useEffect(() => {
    handledRef.current = false;
    setBusy(false);
    if (visible) setChosen(modes[0] ?? 'package');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const scanning = visible && mode === 'package' && !!onBarcode && !!permission?.granted;

  const handleCode = ({ data, type }: { data: string; type?: string }) => {
    if (handledRef.current || !onBarcode) return;
    // A code failing its own check digit is a misread; keep looking.
    const gtin = normalizeGtin(data, type);
    if (!gtin) return;
    handledRef.current = true;
    haptics.success();
    onBarcode(gtin);
  };

  const deliver = (result: RecipePhotoResult, takenIn: CaptureMode, source: 'camera' | 'library') => {
    if (result.status === 'canceled') return;
    if (result.status === 'denied') {
      alertPermissionOff(
        source === 'camera' ? 'Camera access is off' : 'Photo access is off',
        'Turn it on in Settings, or type what you ate.',
      );
      return;
    }
    if (result.status === 'failed') {
      Alert.alert(source === 'camera' ? 'Couldn’t take the photo' : 'Couldn’t open that photo', result.message);
      return;
    }
    onPhoto(takenIn, result.photo);
  };

  const shoot = async () => {
    const camera = cameraRef.current;
    if (busy || !camera) return;
    const opening = openings.begin();
    const takenIn = mode;
    haptics.tap();
    setBusy(true);
    try {
      const shot = await camera.takePictureAsync({ quality: 1, exif: false });
      if (!openings.isCurrent(opening)) return;
      const result = await recipePhotoFromFile(shot.uri, shot.width, shot.height);
      if (!openings.isCurrent(opening)) return;
      deliver(result, takenIn, 'camera');
    } catch (e) {
      if (!openings.isCurrent(opening)) return;
      Alert.alert('Couldn’t take the photo', e instanceof Error && e.message ? e.message : 'Try again.');
    } finally {
      if (openings.isCurrent(opening)) setBusy(false);
    }
  };

  const chooseFromLibrary = async () => {
    if (busy) return;
    const opening = openings.begin();
    const takenIn = mode;
    haptics.tap();
    setBusy(true);
    try {
      const result = await pickRecipePhoto('library');
      if (!openings.isCurrent(opening)) return;
      deliver(result, takenIn, 'library');
    } finally {
      if (openings.isCurrent(opening)) setBusy(false);
    }
  };

  const cameraBody = () => {
    if (!permission) return <View style={styles.fill} />;
    if (!permission.granted) {
      return (
        <View style={[styles.fill, styles.permission]}>
          <Text style={styles.permissionText}>
            {permission.canAskAgain === false
              ? 'Camera access is off. Turn it on in Settings to scan or photograph, or choose a photo you already have.'
              : 'The camera needs your permission to scan or photograph. You can also choose a photo you already have.'}
          </Text>
          {permission.canAskAgain === false ? (
            <InlineAction label="Open Settings" icon="open-outline" onPress={() => { void Linking.openSettings(); }} />
          ) : (
            <InlineAction label="Allow camera" icon="camera-outline" onPress={requestPermission} />
          )}
        </View>
      );
    }
    return (
      <>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{
            // Same list the scan session reads; normalizeGtin lands a UPC-A
            // reported as an EAN-13 on one key.
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'],
          }}
          onBarcodeScanned={scanning ? handleCode : undefined}
        />
        {mode === 'package' && <View style={styles.reticle} pointerEvents="none" />}
      </>
    );
  };

  return (
    <SheetModal
      name="Food camera"
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {cameraBody()}

        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={BUTTON_LABEL.cancel}
            hitSlop={spacing.sm}
          >
            <Text style={styles.cancel}>{BUTTON_LABEL.cancel}</Text>
          </TouchableOpacity>
          <Text style={styles.title} pointerEvents="none">Scan or photograph</Text>
        </View>

        <View style={[styles.hint, { top: insets.top + 56 }]} pointerEvents="none">
          <View style={styles.hintPill}>
            <Text style={styles.hintText}>{captureHint(mode)}</Text>
          </View>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
          {modes.length > 1 && (
            <View style={styles.switchTrack} accessibilityRole="tablist">
              {modes.map(m => (
                <PressableScale
                  key={m}
                  style={[styles.switchOption, m === mode && styles.switchOptionOn]}
                  onPress={() => { haptics.tap(); setChosen(m); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: m === mode }}
                  accessibilityLabel={CAPTURE_MODE_LABEL[m]}
                >
                  <Text style={[styles.switchText, m === mode && styles.switchTextOn]}>{CAPTURE_MODE_LABEL[m]}</Text>
                </PressableScale>
              ))}
            </View>
          )}
          <View style={styles.controls}>
            <View style={styles.side}>
              <PressableScale
                style={styles.library}
                onPress={chooseFromLibrary}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Choose a photo"
              >
                <Ionicons name="images-outline" size={iconSize.lg} color={colors.accentText} />
              </PressableScale>
              <Text style={styles.sideText}>Choose photo</Text>
            </View>
            <PressableScale
              style={[styles.shutter, (busy || !permission?.granted) && styles.shutterOff]}
              onPress={shoot}
              disabled={busy || !permission?.granted}
              accessibilityRole="button"
              accessibilityLabel={mode === 'meal' ? 'Photograph your meal' : 'Photograph the label'}
            >
              <View style={styles.shutterInner} />
            </PressableScale>
            <View style={styles.side} />
          </View>
        </View>
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgSunken },
    fill: { flex: 1 },
    permission: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    permissionText: {
      color: colors.textSecondary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      textAlign: 'center',
    },
    // Over the live picture, so every piece of text and every control sits on
    // the scrim or a pill rather than straight on whatever is in frame.
    top: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.smd,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.backdrop,
    },
    cancel: { color: colors.onFill, fontSize: font.md, zIndex: 1 },
    title: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: spacing.smd,
      textAlign: 'center',
      color: colors.onFill,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    hintPill: {
      backgroundColor: colors.backdrop,
      borderRadius: radius.full,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xsm,
    },
    hintText: { color: colors.onFill, fontSize: font.sm },
    reticle: {
      position: 'absolute',
      left: '12%',
      right: '12%',
      top: '24%',
      bottom: '36%',
      borderWidth: 2,
      borderColor: colors.onFill,
      borderRadius: radius.md,
      opacity: 0.7,
    },
    bottom: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingTop: spacing.md,
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.backdrop,
    },
    switchTrack: {
      flexDirection: 'row',
      padding: spacing.xxs,
      borderRadius: radius.md,
      backgroundColor: colors.backdrop,
    },
    switchOption: {
      minWidth: 96,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
    },
    switchOptionOn: { backgroundColor: colors.accentFill },
    switchText: { color: colors.onFill, fontSize: font.sm, fontWeight: fontWeight.semibold },
    switchTextOn: { color: colors.onAccent },
    controls: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
    },
    side: { width: 72, alignItems: 'center', gap: spacing.xs },
    library: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.backdrop,
    },
    sideText: { color: colors.onFill, fontSize: font.xxs },
    shutter: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 4,
      borderColor: colors.onFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterOff: { opacity: 0.4 },
    shutterInner: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.onFill,
    },
  });
}
