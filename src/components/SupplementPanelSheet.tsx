import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';
import { NutrientFieldsCard } from './NutrientFieldsCard';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import type { NutrientKey } from '../types';
import { PANEL_UNITS, type SupplementPanel } from '../utils/medicationSettings';
import {
  buildSupplementPanel,
  invalidSupplementFields,
  supplementFormDirty,
  supplementFormFrom,
  type SupplementForm,
} from '../utils/supplementDose';
import { haptics } from '../utils/haptics';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';

/**
 * What one serving of a supplement contains, typed in from its label.
 *
 * Every dose of the medication recorded after this adds these figures to the
 * day, as a food log entry (`supplementDose.ts`), and writes them to Apple
 * Health with the rest of a day's nutrients. Past doses are left as they were.
 *
 * Same posture as `NutritionPanelSheet`, and the same fields (`NutrientFieldsCard`):
 * a blank field is unknown, a typed 0 is stated, and a field that can't be
 * read blocks the save rather than being dropped. Nothing is stored until
 * Save, so the swipe-down is guarded.
 */

interface Props {
  visible: boolean;
  /** The medication's name, for the header. */
  name: string;
  /** The panel being corrected, or null to type a new one. */
  panel: SupplementPanel | null;
  onClose: () => void;
  /** Null clears the panel. */
  onSave: (panel: SupplementPanel | null) => void;
}

const UNIT_OPTIONS = PANEL_UNITS.map(unit => ({ value: unit, label: unit }));

export function SupplementPanelSheet({ visible, name, panel, onClose, onSave }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [form, setForm] = useState<SupplementForm>(() => supplementFormFrom(panel));
  const [bad, setBad] = useState<readonly string[]>([]);
  const [empty, setEmpty] = useState(false);
  // What the sheet opened saying, so the discard guard compares against the
  // panel as it was rather than against a blank form.
  const baseline = useRef<SupplementPanel | null>(panel);

  useEffect(() => {
    if (!visible) return;
    setForm(supplementFormFrom(panel));
    baseline.current = panel;
    setBad([]);
    setEmpty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const setAmount = (key: NutrientKey, text: string) => {
    setForm(f => ({ ...f, amounts: { ...f.amounts, [key]: text } }));
    setBad(b => (b.includes(key) ? b.filter(k => k !== key) : b));
    setEmpty(false);
  };

  const handleSave = () => {
    const invalid = invalidSupplementFields(form);
    if (invalid.length > 0) {
      haptics.error();
      setBad(invalid);
      return;
    }
    const built = buildSupplementPanel(form);
    if (!built) {
      // Nothing typed. Saving would mean "remove it", and that is its own
      // button, so this says what is missing instead of guessing.
      haptics.error();
      setEmpty(true);
      return;
    }
    haptics.success();
    Keyboard.dismiss();
    onSave(built);
    onClose();
  };

  const handleRemove = () => {
    Alert.alert(
      `Remove the nutrients for ${name}?`,
      'Doses you record from now on will not add anything to the day. Doses already recorded keep what they added.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => { Keyboard.dismiss(); onSave(null); onClose(); },
        },
      ],
    );
  };

  const handleCancel = () => {
    if (!supplementFormDirty(form, baseline.current)) { Keyboard.dismiss(); onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { Keyboard.dismiss(); onClose(); } },
      ],
    );
  };

  return (
    <SheetModal name="Supplement nutrients" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title={name}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Save" onPress={handleSave} minWidth={64} />}
        />
        <View style={styles.flex}>
          <ScrollView
            ref={keyboardScroll.ref}
            style={styles.flex}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            {...keyboardScroll.props}
          >
            <Text style={styles.intro}>
              Copy the figures from the supplement facts on the label. Leave a field blank if
              the label doesn't list it. Blank means unknown, which is not the same as zero.
            </Text>

            <Text style={styles.groupLabel}>SERVING</Text>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>The figures below are for</Text>
              <View style={styles.numberRow}>
                <TextField
                  style={[styles.numberInput, bad.includes('servingAmount') && styles.inputBad]}
                  value={form.servingAmount}
                  onChangeText={t => {
                    setForm(f => ({ ...f, servingAmount: t }));
                    setBad(b => b.filter(k => k !== 'servingAmount'));
                  }}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                  accessibilityLabel="Serving size on the label"
                />
              </View>
              <SegmentedControl
                label="Serving unit"
                options={UNIT_OPTIONS}
                value={form.servingUnit}
                columns={3}
                onChange={unit => { haptics.tap(); setForm(f => ({ ...f, servingUnit: unit })); }}
                surface="card"
              />
              <Text style={styles.hint}>
                Use the serving size the label states, such as 2 tablets. A dose recorded in
                this unit adds that many servings. Any other dose adds one serving.
              </Text>
            </View>

            <Text style={styles.groupLabel}>NUTRIENTS</Text>
            <NutrientFieldsCard amounts={form.amounts} bad={bad} onChange={setAmount} primary="micro" />

            {empty && (
              <Text style={styles.error}>
                Enter at least one figure from the label, or cancel to leave this as it was.
              </Text>
            )}
            {bad.length > 0 && (
              <Text style={styles.error}>
                {bad.length === 1 ? 'One field' : `${bad.length} fields`} couldn't be read as a
                number. Fix or clear {bad.length === 1 ? 'it' : 'them'}, so nothing is stored
                that the label didn't say.
              </Text>
            )}
            <Text style={styles.hint}>
              Applies to doses you record from now on. Past doses keep what they added.
            </Text>
            {!!panel && (
              <View style={styles.removeRow}>
                <InlineAction label="Remove nutrients" icon="trash-outline" variant="neutral" onPress={handleRemove} />
              </View>
            )}
          </ScrollView>
        </View>
        <NumberPadAccessory />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
    intro: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, marginBottom: spacing.sm },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.md,
    },
    fieldLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    numberInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: border.thin,
      borderColor: colors.separator,
    },
    inputBad: { borderColor: colors.red },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
    error: { color: colors.redText, fontSize: font.sm, lineHeight: 18, marginTop: spacing.md },
    removeRow: { marginTop: spacing.md, alignItems: 'flex-start' },
  });
}
