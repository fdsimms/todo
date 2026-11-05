import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Platform, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { AccessoryBar, AccessoryDoneButton, accessoryFill } from './AccessoryBar';
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
    <InputAccessoryView nativeID={DONE_ACCESSORY_ID} backgroundColor={accessoryFill(colors)}>
      <AccessoryBar style={styles.bar}>
        <AccessoryDoneButton />
      </AccessoryBar>
    </InputAccessoryView>
  );
}

function FloatingDone() {
  const wanted = useSyncExternalStore(subscribeFloatingDone, floatingDoneWanted, () => false);
  const keyboardHeight = useKeyboardHeight(wanted);
  if (!wanted || keyboardHeight <= 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.floatingHost, { bottom: keyboardHeight + spacing.sm }]}>
      <AccessoryDoneButton floating />
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
});

const styles = StyleSheet.create({
  floatingHost: { position: 'absolute', right: spacing.md, alignItems: 'flex-end' },
});
