import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { contrastBarPercent } from '../utils/moodInsights';

/**
 * One "with it against without it" comparison, drawn as a pair of bars on one
 * scale.
 *
 * **Every contrast on the Mood screen and the symptom page is this**, which is
 * the point: five lists render one of these per row (mood by kind of work, by
 * repeating task, by symptom, by context tag, by what you ate) and the symptom
 * page adds a sixth for a symptom against each food. They were five copies of
 * the same twelve lines before, which is the drift `SheetHeaderButton` and
 * `InlineAction` exist to undo. A seventh contrast uses this rather than
 * copying one of them.
 *
 * **Why bars rather than "4.1 vs 2.0" on a line.** Two numbers on one scale are
 * readable; four are not. The symptom-against-food read reports a rate on each
 * side, so its row said "3 of 6 vs 1 of 9" — and working out whether 1-in-11
 * beats 3-in-4 takes a moment, with another moment to compare that against the
 * row above. A pair of bars answers both at a glance, and the rest of the
 * contrasts moved to it so every comparison in the feature reads the same way.
 *
 * **The figures stay in text, and they are the record.** The bar is an aid to
 * comparison and never the number itself, which is what keeps a rate built on
 * three days from reading as a finding — the same reason `moodInsights.ts`
 * prints a sample size beside everything it claims.
 *
 * **One colour for both bars.** Length is the whole of the data. A second
 * colour would rank the two groups, and none of these cards is entitled to say
 * which side is the good one — least of all the symptom read, where that would
 * be a medical claim drawn on a self-reported diary.
 *
 * The caller supplies each side's fraction (0..1) and its own text, so this
 * knows nothing about mood scales or day counts and needs no mode flag: a mood
 * row passes `moodBarFraction(row.moodWith)` with "4.1", and a rate row passes
 * the rate with "3 of 6 days".
 */
export interface ContrastBarsProps {
  /** The thing being compared: a food, a category, a repeating task, a symptom. */
  label: string;
  /** What each side is called. Kept short; the column is a fixed width. */
  withLabel: string;
  withoutLabel: string;
  /** How full each bar draws, 0..1, on whatever scale the caller is using. */
  withFraction: number;
  withoutFraction: number;
  /** The figure itself, rendered beside its bar. */
  withText: string;
  withoutText: string;
  /**
   * The whole comparison in one sentence. Required rather than derived, because
   * what the two sides *mean* differs per card and a generic "with and without"
   * is exactly the thing a screen reader user cannot see the caption for.
   */
  accessibilityLabel: string;
  /** Skips the separating margin. Set on the first row of a card. */
  first?: boolean;
  /** Widens the figure column, for a caller whose text is longer than "4.1". */
  wide?: boolean;
  onPress?: () => void;
}

export function ContrastBars({
  label,
  withLabel,
  withoutLabel,
  withFraction,
  withoutFraction,
  withText,
  withoutText,
  accessibilityLabel,
  first,
  wide,
  onPress,
}: ContrastBarsProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const sides = [
    { key: withLabel, fraction: withFraction, text: withText, muted: false },
    { key: withoutLabel, fraction: withoutFraction, text: withoutText, muted: true },
  ];

  const body = (
    <>
      <View style={styles.head}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {onPress && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
      </View>
      {sides.map(side => (
        <View key={side.key} style={styles.line}>
          <Text style={[styles.key, side.muted && styles.muted]} numberOfLines={1}>
            {side.key}
          </Text>
          {/* Decoration: the row above carries the whole comparison for
              VoiceOver, so a bar announcing itself would read the same figures
              a second time. */}
          <View style={styles.track} accessible={false} importantForAccessibility="no">
            <View style={[styles.fill, { width: `${contrastBarPercent(side.fraction)}%` }]} />
          </View>
          <Text style={[styles.value, wide && styles.valueWide, side.muted && styles.muted]}>
            {side.text}
          </Text>
        </View>
      ))}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.row, !first && styles.rowGap]}
        activeOpacity={interaction.activeOpacity}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return (
    <View style={[styles.row, !first && styles.rowGap]} accessible accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // 3px between the two lines, which belong together, against `spacing.md`
  // between one comparison and the next. Without that difference a card reads
  // as one block of eight bars rather than as four things being compared, and
  // the pairing is what the whole comparison rests on.
  row: { gap: 3 },
  rowGap: { marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 3 },
  label: { flex: 1, fontSize: font.sm, color: colors.text },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Fixed widths on both ends so every track starts and finishes on the same x.
  // That alignment is what lets one row's bars be compared against another's,
  // which is most of why this is a component rather than a per-card layout.
  key: { width: 56, fontSize: font.xs, color: colors.textSecondary },
  value: {
    width: 34,
    textAlign: 'right',
    fontSize: font.xs,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  valueWide: { width: 88 },
  muted: { color: colors.textTertiary },
  track: {
    flex: 1,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.separator,
    overflow: 'hidden',
  },
  fill: { height: 7, borderRadius: radius.full, backgroundColor: colors.accent },
});
