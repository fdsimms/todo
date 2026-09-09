import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format } from 'date-fns/format';
import type { MoodLog } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { moodEmoji, moodLabel, severityLabel } from '../utils/moodLog';
import { symptomOnLog } from '../utils/moodHistory';

/**
 * One mood entry as a list row, wherever entries are listed.
 *
 * Extracted rather than copied a third time: the Mood screen's recent list, the
 * full history and the symptom page all draw the same card, and three
 * hand-rolled copies of one row is the drift `SheetHeaderButton` and
 * `InlineAction` exist to undo. The row owns its own accessibility sentence for
 * the same reason — a card whose five `Text` nodes are announced separately is
 * five announcements, and getting that right once is the point of the
 * component.
 */
export function MoodEntryRow({ log, onPress, onLongPress, highlightSymptomKey, showDate = true }: {
  log: MoodLog;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * A symptom to report the severity of on this row, for the page that is
   * about one symptom. Its own line rather than a bolder entry in the symptom
   * list, so "Moderate" reads as this entry's answer about the thing you are
   * looking at rather than as one name among several.
   */
  highlightSymptomKey?: string;
  /**
   * Off inside a day-grouped list, where the date is already the section
   * header above the row and repeating it on every card is noise.
   */
  showDate?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const highlighted = highlightSymptomKey ? symptomOnLog(log, highlightSymptomKey) : null;
  const when = format(
    new Date(log.loggedAt),
    showDate ? 'EEE d MMM, h:mm a' : 'h:mm a',
  );
  const spoken = [
    showDate ? format(new Date(log.loggedAt), 'EEEE d MMMM') : null,
    format(new Date(log.loggedAt), 'h:mm a'),
    log.mood === null ? 'no mood recorded' : moodLabel(log.mood),
    highlighted ? `${highlighted.name}, ${severityLabel(highlighted.severity)}` : null,
    log.symptoms.length > 0 ? log.symptoms.map(s => s.name).join(', ') : null,
    log.contextTags.length > 0 ? log.contextTags.join(', ') : null,
    log.note || null,
  ].filter(Boolean).join('. ');

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={interaction.delayLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityLabel={spoken}
    >
      <Text style={styles.emoji}>{log.mood === null ? '·' : moodEmoji(log.mood)}</Text>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {log.mood === null ? 'Logged' : moodLabel(log.mood)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>{when}</Text>
        {highlighted && (
          <Text style={styles.highlight} numberOfLines={1}>
            {highlighted.name}: {severityLabel(highlighted.severity).toLowerCase()}
          </Text>
        )}
        {log.symptoms.length > 0 && (
          <Text style={styles.symptoms} numberOfLines={2}>
            {log.symptoms.map(s => `${s.name} (${severityLabel(s.severity).toLowerCase()})`).join(', ')}
          </Text>
        )}
        {log.contextTags.length > 0 && (
          <Text style={styles.contextTags} numberOfLines={2}>{log.contextTags.join(', ')}</Text>
        )}
        {!!log.note && <Text style={styles.note} numberOfLines={2}>{log.note}</Text>}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  emoji: { fontSize: font.lg, width: 28, textAlign: 'center' },
  body: { flex: 1 },
  title: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  meta: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
  highlight: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.medium, marginTop: spacing.xs },
  symptoms: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
  contextTags: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
  note: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
});
