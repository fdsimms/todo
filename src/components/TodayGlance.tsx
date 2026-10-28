import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import type { GlanceEvent } from '../utils/todayGlance';
import { HelpText } from './HelpText';
import { ProgressBar } from './ProgressBar';

interface Props {
  /** Tasks finished on this logical day, and tasks still on the day. */
  done: number;
  left: number;
  /** The line under the figure: time done, planned and of events left. Absent when that is hidden or there is nothing to say. */
  summary?: string;
  events: GlanceEvent[];
}

/**
 * The right-hand pane of Today while no task is open in it: the day's figures
 * where a Mac or a wide iPad window would otherwise show only an icon and a
 * hint. It reads what the list beside it already works out (so it can't
 * disagree with it) and offers nothing to tap, since the list is the place to
 * act and the pane is for the task that gets opened.
 */
export function TodayGlance({ done, left, summary, events }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = done + left;
  const headline = `${done} of ${total} done`;
  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>TODAY AT A GLANCE</Text>
      <View style={styles.card} accessible accessibilityLabel={summary ? `${headline}. ${summary}` : headline}>
        <Text style={styles.headline}>{headline}</Text>
        <ProgressBar progress={total > 0 ? done / total : 0} style={styles.bar} decorative />
        {!!summary && <Text style={styles.summary}>{summary}</Text>}
      </View>
      {events.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>CALENDAR</Text>
          <View style={styles.card}>
            {events.map((event, i) => (
              <View key={event.key} style={[styles.eventRow, i > 0 && styles.eventRowNext]}>
                <Text style={styles.eventTime}>{event.time}</Text>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      <HelpText style={styles.hint}>Select a task in the list to open its details here.</HelpText>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { width: '100%', maxWidth: 440, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  headline: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold },
  bar: { marginTop: spacing.smd },
  summary: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.smd },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  eventRowNext: { marginTop: spacing.smd },
  eventTime: { width: 64, color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
  eventTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: font.md },
  hint: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center' },
});
