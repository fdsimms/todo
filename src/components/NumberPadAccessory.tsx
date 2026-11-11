import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { InputAccessoryView, Platform, StyleSheet, Text } from 'react-native';
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
import { AccessoryBar, AccessoryCapsule, AccessoryDoneButton, accessoryFill } from './AccessoryBar';
import { glassSupported } from './GlassLayer';
import {
  NUMBER_PAD_ACCESSORY_ID,
  numberPadBarFloats,
  publishNumberPadBar,
  withdrawNumberPadBar,
} from '../utils/floatingNumberPad';

/**
 * Every number-pad TextInput in the app points its `inputAccessoryViewID` at
 * this one nativeID. "Done" always means the same thing — dismiss the
 * keyboard — regardless of which field is focused, so one bar per screen is
 * enough even when several number-pad fields share it.
 */
export { NUMBER_PAD_ACCESSORY_ID };

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
 *
 * Where the bar floats (glass on a phone, `numberPadBarFloats`) this draws
 * nothing itself: it publishes what the bar should carry and the window-level
 * host (`FloatingNumberPadBar`, mounted by `KeyboardDoneAccessory`) draws it, so
 * the transparent gaps between the capsules pass taps through.
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

  const floats = numberPadBarFloats(glassSupported(), Platform.OS, Platform.OS === 'ios' && Platform.isPad);
  // After every render, since `onNext` and `onOperator` are closures over the
  // host's current state and the floating bar has to call the latest ones.
  useEffect(() => {
    if (!ios || !floats) return;
    publishNumberPadBar(instanceId, { onNext, onOperator });
  });
  useEffect(() => {
    if (!ios || !floats) return;
    return () => withdrawNumberPadBar(instanceId);
  }, [ios, floats, instanceId]);

  if (!ios || !isTop || floats) return null;

  return (
    <InputAccessoryView nativeID={NUMBER_PAD_ACCESSORY_ID} backgroundColor={accessoryFill(colors)}>
      <NumberPadBar onNext={onNext} onOperator={onOperator} />
    </InputAccessoryView>
  );
}

/**
 * The bar's content, drawn inside the native view or, where it floats, by
 * `FloatingNumberPadBar` with `passThrough`.
 */
export function NumberPadBar({ onNext, onOperator, passThrough }: {
  onNext?: () => void;
  onOperator?: (op: AmountOperator) => void;
  passThrough?: boolean;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const glass = glassSupported();
  const textCapsule = glass ? styles.textCapsule : undefined;
  return (
    <AccessoryBar passThrough={passThrough} style={[styles.bar, onNext && styles.barWithNext]}>
      {onNext && (
        <AccessoryCapsule style={textCapsule}>
          <SheetHeaderButton label="Next" role="cancel" onPress={onNext} />
        </AccessoryCapsule>
      )}
      {onOperator && (
        <AccessoryCapsule style={styles.operators}>
          {AMOUNT_OPERATORS.map(({ op, glyph, label }) => (
            <PressableScale
              key={op}
              style={[styles.operator, glass && styles.operatorOnGlass]}
              haptic
              onPress={() => onOperator(op)}
              accessibilityLabel={label}
            >
              <Text style={styles.operatorGlyph}>{glyph}</Text>
            </PressableScale>
          ))}
        </AccessoryCapsule>
      )}
      <AccessoryDoneButton />
    </AccessoryBar>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    // Same height as the shared Done bar and the set tables' bar.
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xsm,
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
  // The capsule is the surface, so the operator keys lose their own fill.
  operatorOnGlass: { backgroundColor: 'transparent', height: 40 },
  textCapsule: { paddingHorizontal: spacing.smd },
  operatorGlyph: { fontSize: font.lg, fontWeight: fontWeight.medium, color: colors.text },
});
