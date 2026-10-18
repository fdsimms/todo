import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import {
  heartRateSummary,
  zoneBasisLine,
  zoneRows,
  type MaxHeartRate,
  type WorkoutHeartRate,
} from '../utils/heartRateZones';

interface Props {
  /** What Health returned for the workout; the caller draws no card without it. */
  read: WorkoutHeartRate;
  /** What the zones are shares of, or null for no zones (`resolveMaxHeartRate`). */
  max: MaxHeartRate | null;
}

/**
 * The workout page's heart-rate card (docs/arch/workouts-mocks/heart-rate.png):
 * the average and the maximum, the minutes in each zone with its range in
 * beats, and the line saying what the zones are shares of.
 *
 * **Shown, never interpreted** (docs/arch/health-data.md): no zone has a name
 * or a color of its own, every bar is the one accent and one scale, and
 * nothing says a figure is high or low. The line under the card is a plain
 * `Text`, not `HelpText`, because it is the label that keeps an estimated
 * maximum from reading as a measurement, which Hide help text must not take
 * away. Without a maximum the card has the two figures and that line says how
 * to get zones; with only the two figures and no readings, there are no zones
 * to explain or to get, so there is no line (`zoneBasisLine`).
 */
export function WorkoutHeartRateCard({ read, max }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const textScale = useTextScale();
  const summary = heartRateSummary(read);
  const rows = zoneRows(read, max);
  const basis = zoneBasisLine(read, max);
  // Wide enough for "Zone 5 · 168–186" at the size text is drawn at.
  const labelWidth = Math.round(118 * textScale);
  const minutesWidth = Math.round(48 * textScale);

  const figure = (value: number | null, label: string, spoken: string) => (
    value === null ? null : (
      <View style={styles.figure} accessible accessibilityLabel={`${spoken} ${value} beats per minute`}>
        <Text style={styles.figureValue}>{value}</Text>
        <Text style={styles.figureLabel}>{label}</Text>
      </View>
    )
  );

  return (
    <>
      <View style={styles.card}>
        {(summary.average !== null || summary.max !== null) && (
          <View style={styles.figures}>
            {figure(summary.average, 'Average bpm', 'Average')}
            {figure(summary.max, 'Max bpm', 'Maximum')}
          </View>
        )}
        {rows && (
          <View style={styles.zones}>
            {rows.map(row => (
              <View
                key={row.zone}
                style={styles.zoneRow}
                accessible
                accessibilityLabel={row.spoken}
              >
                <Text style={[styles.zoneLabel, { width: labelWidth }]} numberOfLines={1}>{row.label}</Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(row.fraction * 100)}%` }]} />
                </View>
                <Text style={[styles.zoneMinutes, { minWidth: minutesWidth }]}>{row.minutes}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {basis !== null && <Text style={styles.basis}>{basis}</Text>}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, gap: spacing.smd,
  },
  figures: { flexDirection: 'row', gap: spacing.lg },
  figure: { minWidth: 72 },
  figureValue: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  figureLabel: { color: colors.textSecondary, fontSize: font.xs },
  zones: { gap: spacing.sm },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  zoneLabel: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  zoneMinutes: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'right', fontVariant: ['tabular-nums'] },
  basis: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
});
