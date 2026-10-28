import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { AMOUNT_OPERATORS, type AmountOperator } from '../utils/amountMath';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PressableScale } from './PressableScale';
import {
  isTopAccessory,
  registerAccessory,
  subscribeAccessories,
  unregisterAccessory,
} from '../utils/accessoryStack';
import { BUTTON_LABEL } from '../copy/shared';
import { AccessoryBar } from './AccessoryBar';

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
 *
 * `onNext`, when given, adds a Next button at the leading edge for a form of
 * several number fields (a blood pressure reading), since the pad has no
 * return key to move on with either. The host says what Next does for the
 * field that is focused, and passes undefined on the last one.
 *
 * `onOperator`, when given, adds + − × buttons at the leading edge for an
 * amount that takes a sum (`resolveAmountMath`). The host passes it only while
 * that field is focused (`useAmountOperators`).
 */
export function NumberPadAccessory({ onNext, onOperator }: {
  onNext?: () => void;
  onOperator?: (op: AmountOperator) => void;
} = {}) {
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
    <InputAccessoryView nativeID={NUMBER_PAD_ACCESSORY_ID} backgroundColor={colors.bgSecondary}>
      <AccessoryBar style={[styles.bar, onNext && styles.barWithNext]}>
        {onNext && <SheetHeaderButton label="Next" role="cancel" onPress={onNext} />}
        {onOperator && (
          <View style={styles.operators}>
            {AMOUNT_OPERATORS.map(({ op, glyph, label }) => (
              <PressableScale
                key={op}
                style={styles.operator}
                haptic
                onPress={() => onOperator(op)}
                accessibilityLabel={label}
              >
                <Text style={styles.operatorGlyph}>{glyph}</Text>
              </PressableScale>
            ))}
          </View>
        )}
        <SheetHeaderButton label={BUTTON_LABEL.done} onPress={() => Keyboard.dismiss()} />
      </AccessoryBar>
    </InputAccessoryView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  barWithNext: { justifyContent: 'space-between' },
  operators: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginRight: 'auto' },
  operator: {
    width: 44,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operatorGlyph: { fontSize: font.lg, fontWeight: fontWeight.medium, color: colors.text },
});
