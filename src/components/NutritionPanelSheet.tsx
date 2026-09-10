import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { NUTRIENT_KEYS, type FoodNutrition, type NutrientKey } from '../types';
import { NUTRIENT_LABEL, NUTRITION_BASIS_LABEL } from '../utils/foodNutrition';
import {
  buildPanelNutrition,
  invalidPanelFields,
  panelFormDirty,
  panelFormFrom,
  type PanelFieldKey,
  type PanelForm,
} from '../utils/nutritionPanelForm';
import { haptics } from '../utils/haptics';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * Typing in a label panel by hand, for the food no database has.
 *
 * **This is what makes the rest of the feature safe to ship.** Barcode lookup
 * and FoodData Central between them miss store brands, deli counters, bakeries,
 * food from another country, and every packet whose barcode scans to nothing.
 * Those foods would otherwise be permanently un-loggable.
 *
 * **The layout follows the label, because that is what somebody is copying
 * from.** Serving size first, since every figure below it depends on which
 * quantity they describe, then calories, then the rest in the order a panel
 * prints them (`NUTRIENT_KEYS`). Reading down the packet and down the screen
 * should be the same movement.
 *
 * **Every field is blank by default and stays blank if nothing is typed.** A
 * placeholder of "0" would read as a value already saved and would quietly
 * destroy the record's one load-bearing distinction: a blank field is "the
 * label didn't say", a typed 0 is "the label said zero". The placeholders start
 * with "e.g." for the same reason the copy rule in CLAUDE.md says so, and are
 * examples for that specific nutrient rather than a repeated stand-in.
 *
 * **A field it can't read blocks the save rather than being dropped.** The
 * alternative stores a panel the person believes has a figure in it and
 * doesn't. See `readPanelNumber`.
 *
 * **Nothing is written until Save, so the swipe-down is guarded.** Ten typed
 * fields behind a `pageSheet` is exactly the silent-data-loss case CLAUDE.md
 * documents, and the iOS pull-down calls `onRequestClose` rather than Cancel.
 */

interface Props {
  visible: boolean;
  /** What this food is called, for the header. */
  foodName: string;
  /** The panel being corrected, or null to type a new one. */
  nutrition: FoodNutrition | null;
  onClose: () => void;
  /** Called with the typed panel, or null when every figure was cleared. */
  onSave: (nutrition: FoodNutrition | null) => void;
}

const BASIS_OPTIONS = (['per100g', 'per100ml', 'perServing'] as const).map(value => ({
  value,
  label: NUTRITION_BASIS_LABEL[value],
}));

/**
 * A plausible figure for each nutrient, so the example reads as an example.
 *
 * One number per field rather than a repeated "e.g. 0": a greyed 0 in ten boxes
 * is indistinguishable from ten saved zeroes at a glance, which is the exact
 * confusion this form exists to avoid. These are roughly a slice of bread,
 * which is a food most people can sanity-check against.
 */
const PLACEHOLDER: Record<NutrientKey, string> = {
  calorieKcal: 'e.g. 265',
  fatG: 'e.g. 3.2',
  satFatG: 'e.g. 0.6',
  carbsG: 'e.g. 49',
  fiberG: 'e.g. 2.7',
  sugarG: 'e.g. 5',
  proteinG: 'e.g. 9',
  sodiumMg: 'e.g. 490',
  caffeineMg: 'e.g. 0',
  waterMl: 'e.g. 36',
};

export function NutritionPanelSheet({ visible, foodName, nutrition, onClose, onSave }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [form, setForm] = useState<PanelForm>(() => panelFormFrom(nutrition));
  // What the sheet opened saying, so the discard guard compares against the
  // panel as it was rather than against a blank form.
  const baseline = useRef<PanelForm>(panelFormFrom(nutrition));
  // Computed on a save attempt rather than as you type: a half-typed "2." is
  // not yet an error, and flagging it mid-keystroke would flicker red.
  const [bad, setBad] = useState<readonly PanelFieldKey[]>([]);

  useEffect(() => {
    if (!visible) return;
    const opened = panelFormFrom(nutrition);
    setForm(opened);
    baseline.current = opened;
    setBad([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const setAmount = (key: NutrientKey, text: string) => {
    setForm(f => ({ ...f, amounts: { ...f.amounts, [key]: text } }));
    setBad(b => (b.includes(key) ? b.filter(k => k !== key) : b));
  };

  const handleSave = () => {
    const invalid = invalidPanelFields(form);
    if (invalid.length > 0) {
      haptics.error();
      setBad(invalid);
      return;
    }
    haptics.success();
    onSave(buildPanelNutrition(form, nutrition));
    onClose();
  };

  const handleCancel = () => {
    if (!panelFormDirty(form, baseline.current)) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle} numberOfLines={1}>{foodName}</Text>
          <SheetHeaderButton label="Save" onPress={handleSave} minWidth={64} />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <Text style={styles.intro}>
              Copy the figures from the packet. Leave a field blank if the label doesn't
              state it. Blank means unknown, which is not the same as zero.
            </Text>

            <Text style={styles.groupLabel}>SERVING</Text>
            <View style={styles.card}>
              <SegmentedControl
                label="These figures are"
                options={BASIS_OPTIONS}
                value={form.basis}
                onChange={basis => setForm(f => ({ ...f, basis }))}
                surface="card"
              />
              <Text style={styles.hint}>
                Most labels outside the US print per 100g. Pick "per serving" only if the
                panel's own column says so.
              </Text>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Serving size</Text>
                <TextInput
                  style={styles.textInput}
                  value={form.servingText}
                  onChangeText={t => setForm(f => ({ ...f, servingText: t }))}
                  placeholder="e.g. 2 cookies (30g)"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Serving size as printed"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Serving weight</Text>
                <View style={styles.numberRow}>
                  <TextInput
                    style={[styles.numberInput, bad.includes('servingGrams') && styles.inputBad]}
                    value={form.servingGrams}
                    onChangeText={t => {
                      setForm(f => ({ ...f, servingGrams: t }));
                      setBad(b => b.filter(k => k !== 'servingGrams'));
                    }}
                    placeholder="e.g. 30"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Serving weight in grams"
                  />
                  <Text style={styles.unit}>g</Text>
                </View>
                <Text style={styles.hint}>
                  The number to compute with. A product sold by volume has none, and that
                  is fine.
                </Text>
              </View>
            </View>

            <Text style={styles.groupLabel}>NUTRIENTS</Text>
            <View style={styles.card}>
              {NUTRIENT_KEYS.map(key => (
                <View key={key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{NUTRIENT_LABEL[key].label}</Text>
                  <View style={styles.numberRow}>
                    <TextInput
                      style={[styles.numberInput, bad.includes(key) && styles.inputBad]}
                      value={form.amounts[key]}
                      onChangeText={t => setAmount(key, t)}
                      placeholder={PLACEHOLDER[key]}
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${NUTRIENT_LABEL[key].label} in ${NUTRIENT_LABEL[key].unit}`}
                    />
                    <Text style={styles.unit}>{NUTRIENT_LABEL[key].unit}</Text>
                  </View>
                </View>
              ))}
            </View>

            {bad.length > 0 && (
              <Text style={styles.error}>
                {bad.length === 1 ? 'One field' : `${bad.length} fields`} couldn't be read as a
                number. Fix or clear {bad.length === 1 ? 'it' : 'them'}, so nothing is stored
                that the label didn't say.
              </Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
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
    field: { gap: spacing.xs },
    fieldLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    textInput: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: border.thin,
      borderColor: colors.separator,
    },
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
    unit: { color: colors.textSecondary, fontSize: font.sm, minWidth: 26 },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
    error: { color: colors.red, fontSize: font.sm, lineHeight: 18, marginTop: spacing.md },
  });
}
