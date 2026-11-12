import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { describeFrankiWeek, formatStudyMinutes, type FrankiWeek } from '../utils/frankiStudy';

/**
 * The card under Stats' FLASHCARDS heading (the screen draws the heading and
 * the cascade, as it does for every section): minutes studied in Franki on
 * each of the last study days, today in the accent, and the week in a line.
 * The bars are the screen's own completions chart. The figures come from the
 * last read of the person's Franki server (`frankiStudy.ts`), nothing stored.
 *
 * Minutes, never a score: nothing here grades how much anybody studied.
 */

const BAR_HEIGHT = 96;

export function FrankiStudyCard({ week }: { week: FrankiWeek }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const max = Math.max(1, ...week.bars.map(b => b.minutes));
  const line = describeFrankiWeek(week);
  return (
    <View style={styles.card}>
      <View
        style={styles.chartInner}
        accessible
        accessibilityLabel={`Minutes studied in Franki, ${week.bars.map(b => `${b.label}: ${formatStudyMinutes(b.minutes)}`).join(', ')}`}
      >
        {week.bars.map(b => (
          <View key={b.key} style={styles.chartCol}>
            <Text style={styles.barCount}>{b.minutes > 0 ? b.minutes : ' '}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { height: `${Math.max(3, Math.round((b.minutes / max) * 100))}%`, backgroundColor: b.today ? colors.accent : colors.bgQuaternary },
                ]}
              />
            </View>
            <Text style={[styles.barLabel, b.today && { color: colors.accent, fontWeight: fontWeight.semibold }]} numberOfLines={1}>
              {b.label}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>
        <Text style={styles.total}>{line.total}</Text>
        {line.rest}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  chartInner: { flexDirection: 'row', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  chartCol: { flex: 1, alignItems: 'center' },
  barCount: { minHeight: 16, color: colors.textTertiary, fontSize: font.xs, textAlign: 'center' },
  barTrack: { width: 20, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 20, borderRadius: 4 },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: font.xxs, fontWeight: fontWeight.medium, textAlign: 'center' },
  caption: { color: colors.textSecondary, fontSize: font.sm, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.smd },
  total: { color: colors.text, fontWeight: fontWeight.semibold },
});
