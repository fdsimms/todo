import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { SheetHeaderButton } from './SheetHeaderButton';
import {
  isTopAccessory,
  registerAccessory,
  subscribeAccessories,
  unregisterAccessory,
} from '../utils/accessoryStack';

/**
 * Every number-pad TextInput in the app points its `inputAccessoryViewID` at
 * this one nativeID. "Done" always means the same thing — dismiss the
 * keyboard — regardless of which field is focused, so one bar per screen is
 * enough even when several number-pad fields share it.
 */
export const NUMBER_PAD_ACCESSORY_ID = 'numberPadAccessory';

/**
 * iOS's number-pad keyboard has no return key, so there's otherwise no way
 * to dismiss it short of tapping outside the field. Render this once per
 * screen or sheet that has a number-pad TextInput.
 *
 * Mount it freely: several copies can be mounted at once (a screen and the
 * sheet open over it), and only the newest renders — see accessoryStack for
 * why two live views sharing a nativeID is the thing to avoid, and why newest
 * is the right one to keep. So a host doesn't have to know what else is on
 * screen; it only has to say that it has a field.
 *
 * Android's numeric keyboard already ships a dismiss affordance, and
 * `InputAccessoryView` is iOS-only (it warns and renders null elsewhere), so
 * this is a no-op there.
 */
export function NumberPadAccessory() {
  const colors = useColors();
  const instanceId = useId();
  const ios = Platform.OS === 'ios';

  // Registration happens in an effect so it runs child-first on mount and
  // parent-last on unmount — the same order the Modal subtrees themselves
  // mount in, which is what makes "newest" mean "topmost window".
  useEffect(() => {
    if (!ios) return;
    registerAccessory(NUMBER_PAD_ACCESSORY_ID, instanceId);
    return () => unregisterAccessory(NUMBER_PAD_ACCESSORY_ID, instanceId);
  }, [ios, instanceId]);

  const isTop = useSyncExternalStore(
    subscribeAccessories,
    () => isTopAccessory(NUMBER_PAD_ACCESSORY_ID, instanceId),
    () => false,
  );

  if (!ios || !isTop) return null;

  const styles = makeStyles(colors);
  return (
    <InputAccessoryView nativeID={NUMBER_PAD_ACCESSORY_ID}>
      <View style={styles.bar}>
        <SheetHeaderButton label="Done" onPress={() => Keyboard.dismiss()} />
      </View>
    </InputAccessoryView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
