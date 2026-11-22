import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import type { DayHour } from '../utils/todayGlance';
import { HelpText } from './HelpText';
import { ProgressBar } from './ProgressBar';

interface Props {
  /** Tasks finished on this logical day, and tasks still on the day. */
  done: number;
  left: number;
  /** The line under the figure: time done, planned and of events left. */
  summary?: string;
  /** The rest of the day, an hour a row (`dayTimeline`). */
  hours: DayHour[];
  /** All-day events still on the calendar today, by title. */
  allDay: string[];
  /** How a clock time is written (`formatTimeOfDay`, which knows the 24-hour setting). */
  formatTime: (at: Date) => string;
}

/**
 * The pane beside Today as a list on a wide window (`todayWideLayout: 'list'`)
 * while no task is open in it: the day's figures, then the rest of the day an
 * hour at a time, with each event and each task that surfaces later today in
 * the hour it starts. It reads what the list beside it already worked out (the
 * same events, the same Later Today tasks, the same summary line) and offers
 * nothing to tap: the list is where you act.
 */
export function TodayDayPane({ done, left, summary, hours, allDay, formatTime }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = done + left;
  const headline = `${done} of ${total} done`;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.card} accessible accessibilityLabel={summary ? `${headline}. ${summary}` : headline}>
        <Text style={styles.headline}>{headline}</Text>
        <ProgressBar progress={total > 0 ? done / total : 0} style={styles.bar} decorative />
        {!!summary && <Text style={styles.summary}>{summary}</Text>}
      </View>

      <Text style={styles.sectionTitle}>REST OF TODAY</Text>
      <View style={styles.card}>
        {allDay.length > 0 && (
          <View style={styles.allDay}>
            {allDay.map((title, i) => (
              <View key={`${title}-${i}`} style={styles.allDayChip}>
                <Text style={styles.allDayText} numberOfLines={1}>{title}</Text>
              </View>
            ))}
          </View>
        )}
        {hours.map((hour, i) => (
          <View key={hour.start.getTime()} style={[styles.hour, i > 0 && styles.hourNext]}>
            <Text style={styles.hourLabel}>{formatTime(hour.start)}</Text>
            <View style={styles.hourEntries}>
              {hour.entries.map(entry => (
                <View
                  key={entry.key}
                  style={[styles.entry, entry.kind === 'event' ? styles.entryEvent : styles.entryTask]}
                  accessible
                  accessibilityLabel={`${entry.title}, ${entry.kind === 'event' ? 'starts' : 'shows on Today'} at ${formatTime(entry.at)}`}
                >
                  <Ionicons
                    name={entry.kind === 'event' ? 'calendar-outline' : 'time-outline'}
                    size={iconSize.xs}
                    color={entry.kind === 'event' ? colors.accent : colors.orangeText}
                  />
                  <Text style={styles.entryTitle} numberOfLines={1}>{entry.title}</Text>
                  <Text style={styles.entryTime}>{formatTime(entry.at)}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
      <HelpText style={styles.hint}>Select a task in the list to open its details here.</HelpText>
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.xl },
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
  allDay: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm, marginBottom: spacing.smd },
  allDayChip: { backgroundColor: colors.accentSubtle, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, maxWidth: '100%' },
  allDayText: { color: colors.text, fontSize: font.sm },
  hour: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 36, gap: spacing.smd },
  hourNext: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  hourLabel: { width: 72, paddingTop: spacing.xsm, color: colors.textSecondary, fontSize: font.xs, fontVariant: ['tabular-nums'] },
  hourEntries: { flex: 1, minWidth: 0, gap: spacing.xs, paddingVertical: spacing.xs },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsm,
    borderLeftWidth: 3,
  },
  entryEvent: { backgroundColor: colors.accentSubtle, borderLeftColor: colors.accent },
  entryTask: { backgroundColor: colors.bgTertiary, borderLeftColor: colors.orange },
  entryTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: font.sm },
  entryTime: { color: colors.textSecondary, fontSize: font.xs, fontVariant: ['tabular-nums'] },
  hint: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center' },
});
