import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
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
import { AccessoryBar, AccessoryCapsule, accessoryFill } from './AccessoryBar';
import { glassSupported } from './GlassLayer';
import { PressableScale } from './PressableScale';

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
  const glass = glassSupported();
  return (
    <InputAccessoryView nativeID={APPLY_TO_ALL_ACCESSORY_ID} backgroundColor={accessoryFill(colors)}>
      <AccessoryBar style={styles.bar}>
        {offer && (glass ? (
          // The capsule is the pill, so an `InlineAction`'s own tint would be a second surface.
          <AccessoryCapsule>
            <PressableScale haptic onPress={offer.apply} accessibilityLabel={offer.label} style={styles.offerOnGlass}>
              <Text style={styles.offerLabel}>{offer.label}</Text>
            </PressableScale>
          </AccessoryCapsule>
        ) : (
          <InlineAction label={offer.label} onPress={offer.apply} haptic />
        ))}
        <View style={styles.done}>
          <AccessoryCapsule style={glass ? styles.doneOnGlass : undefined}>
            <SheetHeaderButton label={BUTTON_LABEL.done} onPress={() => Keyboard.dismiss()} />
          </AccessoryCapsule>
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
  doneOnGlass: { paddingHorizontal: spacing.smd },
  offerOnGlass: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.smd },
  offerLabel: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
});
