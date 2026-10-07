import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { isNutrientUnitOption, type FoodUnitOption } from '../utils/foodLog';
import { CardSheet, type CardAnchor } from './CardSheet';

/** The key a caller stores for "type the amount as free text". */
export const OTHER_UNIT_KEY = 'other';

interface Props {
  options: FoodUnitOption[];
  /** The chosen option's key, `OTHER_UNIT_KEY`, or null while nothing is. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** For `SheetModal`'s development warnings. */
  name: string;
  /** The chip's fill, one step off the field it sits in. Defaults to a card's `bgSecondary`. */
  chipBackground?: string;
}

/**
 * The unit beside an amount field: a chip showing the current unit, which opens
 * a short menu of every unit the food's panel can measure.
 *
 * A row of pills made the units, the amounts-by-nutrient (cal, g protein) and
 * the free-text escape one block of ten equal choices, when nearly every
 * amount is a serving or grams. The chip keeps the common case to the field
 * itself and puts the rest one tap away, grouped: units, then amounts stated as
 * a quantity of one nutrient (`isNutrientUnitOption`), then "Something else".
 *
 * The menu is a popover `CardSheet`, so a caller renders this inside its own
 * sheet's children, which is what lets one Modal present from the other.
 */
export function UnitMenuChip({ options, selectedKey, onSelect, name, chipBackground }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);

  const selected = options.find(o => o.key === selectedKey);
  const label = selectedKey === OTHER_UNIT_KEY ? 'Other' : selected?.label ?? 'Unit';
  const units = options.filter(o => !isNutrientUnitOption(o));
  const nutrients = options.filter(isNutrientUnitOption);

  return (
    <>
      <TouchableOpacity
        style={[styles.chip, chipBackground ? { backgroundColor: chipBackground } : null]}
        activeOpacity={interaction.activeOpacity}
        onPress={e => {
          haptics.tap();
          setAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Unit: ${label}. Change unit`}
      >
        <Text style={styles.chipText}>{label}</Text>
        <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} />
      </TouchableOpacity>
      <CardSheet
        name={name}
        visible={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        popoverWidth={220}
        scrimLabel="Close unit menu"
      >
        {close => {
          const row = (key: string, text: string) => {
            const on = selectedKey === key;
            return (
              <TouchableOpacity
                key={key}
                style={styles.row}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  close(() => onSelect(key));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={text}
              >
                <Text style={[styles.rowText, on && styles.rowTextOn]}>{text}</Text>
                {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accentText} />}
              </TouchableOpacity>
            );
          };
          return (
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              <View style={styles.menu}>
                {units.map(o => row(o.key, o.label))}
                {nutrients.length > 0 && <Text style={styles.header}>BY NUTRIENT</Text>}
                {nutrients.map(o => row(o.key, o.label))}
                <Text style={styles.header}>OTHER</Text>
                {row(OTHER_UNIT_KEY, 'Something else')}
              </View>
            </ScrollView>
          );
        }}
      </CardSheet>
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
      backgroundColor: colors.bgSecondary,
    },
    chipText: { color: colors.text, fontSize: font.sm },
    menu: { paddingVertical: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    rowText: { color: colors.text, fontSize: font.md },
    rowTextOn: { color: colors.accentText, fontWeight: fontWeight.semibold },
    header: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.smd,
      paddingBottom: spacing.xs,
    },
  });
}
