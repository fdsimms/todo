import React from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { SheetHeaderButton } from './SheetHeaderButton';

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
 * Android's numeric keyboard already ships a dismiss affordance, and
 * `InputAccessoryView` is iOS-only (it warns and renders null elsewhere), so
 * this is a no-op there.
 */
export function NumberPadAccessory() {
  const colors = useColors();

  if (Platform.OS !== 'ios') return null;

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
