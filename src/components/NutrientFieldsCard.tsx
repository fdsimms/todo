import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { EXTERNAL_NUTRIENT_KEYS, MINERAL_KEYS, VITAMIN_KEYS, type NutrientKey } from '../types';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { TextField } from './TextField';

/**
 * One text box per nutrient, for a panel typed in by hand. Shared by the food
 * panel sheet and the supplement panel sheet so the two can't drift apart.
 *
 * **One group leads and the other sits behind a disclosure.** A food's panel
 * mostly states the label's own rows, so the vitamins and minerals are folded
 * under them; a supplement's is the reverse (`primary="micro"`). Twenty-odd
 * blank boxes under the ones being filled in would bury them. The folded
 * section opens by itself when it already holds a figure or a field in it
 * failed to read, so a stored value is never hidden behind a closed row and a
 * refused save never points at a field that isn't on screen.
 */

const MAIN_KEYS: readonly NutrientKey[] = EXTERNAL_NUTRIENT_KEYS;

/**
 * A plausible figure for each nutrient, so the example reads as an example.
 *
 * One number per field rather than a repeated "e.g. 0": a greyed 0 in every
 * box is indistinguishable from a form full of saved zeroes at a glance, which
 * is the exact confusion this form exists to avoid. The first group is roughly
 * a slice of bread, which is a food most people can sanity-check against; the
 * vitamins and minerals are roughly one multivitamin tablet.
 */
const PLACEHOLDER: Record<NutrientKey, string> = {
  calorieKcal: 'e.g. 265',
  fatG: 'e.g. 3.2',
  satFatG: 'e.g. 0.6',
  transFatG: 'e.g. 0.1',
  cholesterolMg: 'e.g. 1',
  carbsG: 'e.g. 49',
  fiberG: 'e.g. 2.7',
  sugarG: 'e.g. 5',
  addedSugarG: 'e.g. 4',
  proteinG: 'e.g. 9',
  sodiumMg: 'e.g. 490',
  calciumMg: 'e.g. 150',
  ironMg: 'e.g. 3.6',
  potassiumMg: 'e.g. 115',
  caffeineMg: 'e.g. 0',
  waterMl: 'e.g. 36',
  vitaminAMcg: 'e.g. 900',
  vitaminCMg: 'e.g. 90',
  vitaminDMcg: 'e.g. 25',
  vitaminEMg: 'e.g. 15',
  vitaminKMcg: 'e.g. 80',
  thiaminMg: 'e.g. 1.5',
  riboflavinMg: 'e.g. 1.7',
  niacinMg: 'e.g. 20',
  vitaminB6Mg: 'e.g. 2',
  folateMcg: 'e.g. 400',
  vitaminB12Mcg: 'e.g. 6',
  biotinMcg: 'e.g. 30',
  pantothenicAcidMg: 'e.g. 10',
  magnesiumMg: 'e.g. 100',
  zincMg: 'e.g. 11',
  phosphorusMg: 'e.g. 50',
  seleniumMcg: 'e.g. 55',
  copperMg: 'e.g. 0.9',
  manganeseMg: 'e.g. 2.3',
  chromiumMcg: 'e.g. 35',
  molybdenumMcg: 'e.g. 45',
  iodineMcg: 'e.g. 150',
  chlorideMg: 'e.g. 72',
};

interface Props {
  amounts: Record<NutrientKey, string>;
  /** Fields that failed to read, so they can be marked. */
  bad: readonly string[];
  onChange: (key: NutrientKey, text: string) => void;
  /**
   * Which group is always shown. A food's panel leads with the label's own
   * rows (`'main'`); a supplement's leads with its vitamins and minerals
   * (`'micro'`) and keeps calories, fat and the rest behind the disclosure.
   */
  primary?: 'main' | 'micro';
}

export function NutrientFieldsCard({ amounts, bad, onChange, primary = 'main' }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [opened, setOpened] = useState(false);

  const secondaryKeys = primary === 'main' ? [...VITAMIN_KEYS, ...MINERAL_KEYS] : MAIN_KEYS;
  const filled = secondaryKeys.filter(key => amounts[key].trim() !== '').length;
  const badSecondary = bad.some(key => (secondaryKeys as readonly string[]).includes(key));
  // Opens when a figure appears (a stored panel, a photo read, a divide) and
  // never closes by itself, so clearing the last box doesn't fold the section
  // away under the finger that just cleared it.
  useEffect(() => {
    if (filled > 0) setOpened(true);
  }, [filled]);
  const open = opened || badSecondary;

  const renderField = (key: NutrientKey) => (
    <View key={key} style={styles.field}>
      <Text style={styles.fieldLabel}>{NUTRIENT_LABEL[key].label}</Text>
      <View style={styles.numberRow}>
        <TextField
          style={[styles.numberInput, bad.includes(key) && styles.inputBad]}
          value={amounts[key]}
          onChangeText={t => onChange(key, t)}
          placeholder={PLACEHOLDER[key]}
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
          accessibilityLabel={`${NUTRIENT_LABEL[key].label} in ${NUTRIENT_LABEL[key].unit}`}
        />
        <Text style={styles.unit}>{NUTRIENT_LABEL[key].unit}</Text>
      </View>
    </View>
  );

  const microCard = (
    <View style={styles.card}>
      <Text style={styles.subheading}>VITAMINS</Text>
      {VITAMIN_KEYS.map(renderField)}
      <Text style={styles.subheading}>MINERALS</Text>
      {MINERAL_KEYS.map(renderField)}
    </View>
  );
  const mainCard = <View style={styles.card}>{MAIN_KEYS.map(renderField)}</View>;

  const secondaryLabel = primary === 'main' ? 'Vitamins and minerals' : 'Calories, fat, protein and others';

  return (
    <View style={styles.wrap}>
      {primary === 'main' ? mainCard : microCard}
      <TouchableOpacity
        style={styles.disclosure}
        activeOpacity={interaction.activeOpacity}
        onPress={() => setOpened(v => !v)}
        // Held open while a field inside failed to read, so the refused save
        // never points at a field that is folded away.
        disabled={badSecondary}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={secondaryLabel}
      >
        <Text style={styles.disclosureLabel}>{secondaryLabel}</Text>
        <Text style={styles.disclosureValue}>{filled > 0 ? `${filled} entered` : ''}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={iconSize.sm}
          color={colors.textTertiary}
        />
      </TouchableOpacity>
      {open && (primary === 'main' ? microCard : mainCard)}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { gap: spacing.sm },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.md,
    },
    subheading: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    field: { gap: spacing.xs },
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
    unit: { color: colors.textSecondary, fontSize: font.sm, minWidth: 36 },
    disclosure: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      minHeight: 44,
    },
    disclosureLabel: { flex: 1, color: colors.text, fontSize: font.md },
    disclosureValue: { color: colors.textSecondary, fontSize: font.sm },
  });
}
