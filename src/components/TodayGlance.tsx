import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { ProgressBar } from './ProgressBar';

interface Props {
  /** Tasks finished on this logical day, and tasks still on the day. */
  done: number;
  left: number;
  /** The line beside the figure: time done, planned and of events left. Absent when that is hidden or there is nothing to say. */
  summary?: string;
}

/**
 * The day's figure as one line under Today's header, for the board
 * (`todayWideLayout: 'board'`), which has no idle pane to hold it: done of the
 * day's total beside a short bar, then the header's own summary line (time done,
 * planned and events left), which it replaces there rather than repeats.
 */
export function TodayGlanceLine({ done, left, summary }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = done + left;
  const headline = `${done} of ${total} done`;
  return (
    <View style={styles.line} accessible accessibilityLabel={summary ? `${headline}. ${summary}` : headline}>
      <Text style={styles.lineHeadline}>{headline}</Text>
      <ProgressBar progress={total > 0 ? done / total : 0} style={styles.lineBar} decorative />
      {!!summary && <Text style={styles.lineSummary} numberOfLines={1}>{summary}</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minWidth: 0 },
  lineHeadline: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  lineBar: { width: 140 },
  lineSummary: { flexShrink: 1, color: colors.textSecondary, fontSize: font.sm },
});
