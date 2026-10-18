import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import type { WeightUnit } from '../utils/weightLog';
import { describePlateLoad, platesOnSide, type PlateLoad } from '../utils/plateMath';
import { formatWeightNumber } from '../utils/workoutData';

/**
 * The plates for a set's weight: "Each side [20] [10] [1.25] on a 20 kg bar",
 * as in docs/arch/workouts-mocks/workout-mode.png. A small bar is drawn for
 * each plate, taller and wider the heavier it is, with its number beside it.
 * The bars are decoration (their size is by weight, not to scale), so the
 * numbers carry the load.
 *
 * Says so when the weight can't be made: the load the plates do make, in text,
 * under the line. It never shows plates for a weight they don't add up to
 * without that line.
 *
 * One accessibility element, labelled by `describePlateLoad`, since the
 * pieces read separately ("20", "10", "1.25") say nothing about sides or a bar.
 */

/** The weight the biggest drawn plate stands for, in kg. */
const BIG_PLATE_KG = 25;

function plateSize(kg: number): { width: number; height: number } {
  const f = Math.min(1, kg / BIG_PLATE_KG);
  return { width: Math.round(4 + 5 * f), height: Math.round(14 + 16 * f) };
}

export function PlateLine({ load, unit }: { load: PlateLoad; unit: WeightUnit }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const plates = platesOnSide(load);
  const bar = `${formatWeightNumber(load.barKg, unit)} ${unit} bar`;

  return (
    <View style={styles.wrap} accessible accessibilityLabel={describePlateLoad(load, unit)}>
      {load.barOnly ? (
        <Text style={styles.text}>{load.targetKg < load.barKg ? `Lighter than the ${bar}` : `Just the ${bar}`}</Text>
      ) : (
        <View style={styles.line}>
          <Text style={styles.text}>Each side</Text>
          {plates.map((kg, i) => {
            const size = plateSize(kg);
            return (
              <View key={`${kg}-${i}`} style={styles.plate}>
                <View style={[styles.bar, { width: size.width, height: size.height }]} />
                <Text style={styles.number}>{formatWeightNumber(kg, unit)}</Text>
              </View>
            );
          })}
          <Text style={styles.muted}>{`on a ${bar}`}</Text>
        </View>
      )}
      {!load.exact && (
        <Text style={styles.closest}>
          {`Closest load: ${formatWeightNumber(load.loadedKg, unit)} ${unit}`}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { gap: spacing.xs },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xsm },
  text: { color: colors.textSecondary, fontSize: font.sm },
  plate: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
  bar: { borderRadius: 3, backgroundColor: colors.textTertiary },
  number: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textTertiary, fontSize: font.sm },
  closest: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
});
