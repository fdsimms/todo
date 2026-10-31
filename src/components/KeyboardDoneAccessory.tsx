import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { fontWeight, font, iconSize, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';
import { PressableScale } from './PressableScale';
import { AccessoryBar } from './AccessoryBar';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import {
  isTopAccessory,
  registerAccessory,
  subscribeAccessories,
  unregisterAccessory,
} from '../utils/accessoryStack';
import { DONE_ACCESSORY_ID, floatingDoneWanted, subscribeFloatingDone } from '../utils/keyboardDone';

const FLOATING_STACK_ID = 'keyboardDoneFloating';

/**
 * The Done that every text keyboard carries (`src/utils/keyboardDone.ts` has
 * the rule). Mounted once in the app root and once inside every `SheetModal`,
 * because each Modal is its own window and a bar mounted underneath can't reach
 * a field in a sheet. Mount it freely: only the newest renders
 * (`accessoryStack`), and a sheet closing hands the bar back to what was under it.
 *
 * Two forms, one per kind of field: an `InputAccessoryView` for a single-line
 * field, and a small floating button for a multiline one, which an accessory
 * view never attaches to.
 *
 * The button is not a `SheetHeaderButton`: that registers itself as the form's
 * commit (⌘Return), and a Done mounted in every sheet would take the shortcut
 * from the sheet's own Save.
 */
export function KeyboardDoneAccessory() {
  const instanceId = useId();
  const ios = Platform.OS === 'ios';

  useEffect(() => {
    if (!ios) return;
    registerAccessory(DONE_ACCESSORY_ID, instanceId);
    registerAccessory(FLOATING_STACK_ID, instanceId);
    return () => {
      unregisterAccessory(DONE_ACCESSORY_ID, instanceId);
      unregisterAccessory(FLOATING_STACK_ID, instanceId);
    };
  }, [ios, instanceId]);

  const isTop = useSyncExternalStore(
    subscribeAccessories,
    () => isTopAccessory(DONE_ACCESSORY_ID, instanceId),
    () => false,
  );
  if (!ios || !isTop) return null;
  return (
    <>
      <DoneBar />
      <FloatingDone />
    </>
  );
}

function DoneBar() {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <InputAccessoryView nativeID={DONE_ACCESSORY_ID} backgroundColor={colors.bgSecondary}>
      <AccessoryBar style={styles.bar}>
        <PressableScale
          onPress={() => Keyboard.dismiss()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={BUTTON_LABEL.done}
        >
          <Text style={styles.label}>{BUTTON_LABEL.done}</Text>
        </PressableScale>
      </AccessoryBar>
    </InputAccessoryView>
  );
}

function FloatingDone() {
  const { colors, shadows } = useTheme();
  const wanted = useSyncExternalStore(subscribeFloatingDone, floatingDoneWanted, () => false);
  const keyboardHeight = useKeyboardHeight(wanted);
  if (!wanted || keyboardHeight <= 0) return null;
  const styles = makeStyles(colors);
  return (
    <View pointerEvents="box-none" style={[styles.floatingHost, { bottom: keyboardHeight + spacing.sm }]}>
      <PressableScale
        onPress={() => Keyboard.dismiss()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={BUTTON_LABEL.done}
        style={[styles.chip, shadows.card]}
      >
        <Ionicons name="chevron-down" size={iconSize.sm} color={colors.accentText} />
        <Text style={styles.label}>{BUTTON_LABEL.done}</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xsm,
  },
  label: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
  floatingHost: { position: 'absolute', right: spacing.md, alignItems: 'flex-end' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
});
