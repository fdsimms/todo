import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import {
  isTopAccessory,
  registerAccessory,
  subscribeAccessories,
  unregisterAccessory,
} from '../utils/accessoryStack';
import { getApplyOffer, subscribeApplyOffer } from '../utils/applyToAllOffer';
import { BUTTON_LABEL } from '../copy/shared';
import { AccessoryBar } from './AccessoryBar';

/** What a weight or reps cell in a set table points `inputAccessoryViewID` at. */
export const APPLY_TO_ALL_ACCESSORY_ID = 'applyToAllAccessory';

/**
 * The keyboard bar for a set table's number cells: the usual Done, plus an
 * "Apply 95 to all sets" pill while the focused cell has a value the other
 * sets don't (`applyToAll.ts`). The pill is absent otherwise, so the bar is
 * the plain Done bar nearly all the time.
 *
 * Always mounted while its table is, even with nothing on offer: an accessory
 * view that mounts after a field is already focused isn't picked up by that
 * field, so it can't wait for the offer to appear. Mount it once per table;
 * like `NumberPadAccessory`, only the newest mounted copy renders.
 */
export function ApplyToAllAccessory() {
  const colors = useColors();
  const instanceId = useId();
  const ios = Platform.OS === 'ios';

  useEffect(() => {
    if (!ios) return;
    registerAccessory(APPLY_TO_ALL_ACCESSORY_ID, instanceId);
    return () => unregisterAccessory(APPLY_TO_ALL_ACCESSORY_ID, instanceId);
  }, [ios, instanceId]);

  const isTop = useSyncExternalStore(
    subscribeAccessories,
    () => isTopAccessory(APPLY_TO_ALL_ACCESSORY_ID, instanceId),
    () => false,
  );
  const offer = useSyncExternalStore(subscribeApplyOffer, getApplyOffer, () => null);

  if (!ios || !isTop) return null;

  const styles = makeStyles(colors);
  return (
    <InputAccessoryView nativeID={APPLY_TO_ALL_ACCESSORY_ID} backgroundColor={colors.bgSecondary}>
      <AccessoryBar style={styles.bar}>
        {offer && <InlineAction label={offer.label} onPress={offer.apply} haptic />}
        <View style={styles.done}>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={() => Keyboard.dismiss()} />
        </View>
      </AccessoryBar>
    </InputAccessoryView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xsm,
  },
  done: { marginLeft: 'auto' },
});
