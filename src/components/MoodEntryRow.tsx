import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format } from 'date-fns/format';
import type { MoodLog } from '../types';
import { useColors } from '../theme/ThemeContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import { moodEmoji, moodLabel, severityLabel } from '../utils/moodLog';
import { symptomOnLog } from '../utils/moodHistory';

/** Enough for a few sentences; the sheet still holds the whole note. */
const NOTE_LINES = 6;

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
export function MoodEntryRow({ log, onPress, highlightSymptomKey, showDate = true }: {
  log: MoodLog;
  onPress?: () => void;
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
  const textScaleFactor = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScaleFactor), [colors, textScaleFactor]);

  const highlighted = highlightSymptomKey ? symptomOnLog(log, highlightSymptomKey) : null;
  const when = format(
    new Date(log.loggedAt),
    showDate ? 'EEE d MMM, h:mm a' : 'h:mm a',
  );
  const spoken = [
    showDate ? format(new Date(log.loggedAt), 'EEEE, MMMM d') : null,
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
      disabled={!onPress}
      accessibilityLabel={spoken}
    >
      {log.mood === null ? (
        // An entry with no rating gets a neutral glyph, never a face: any face
        // would claim a mood nobody recorded.
        <View style={styles.noMood} accessible={false}>
          <Ionicons name="document-text-outline" size={iconSize.lg} color={colors.textTertiary} />
        </View>
      ) : (
        <Text style={styles.emoji}>{moodEmoji(log.mood)}</Text>
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {log.mood === null ? 'Logged' : moodLabel(log.mood)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>{when}</Text>
        {!!log.note && <Text style={styles.note} numberOfLines={NOTE_LINES}>{log.note}</Text>}
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
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors, textScaleFactor = 1) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  emoji: { fontSize: font.lg, width: Math.round(28 * textScaleFactor), textAlign: 'center' },
  // Same column as the emoji, so a rated and an unrated entry line up.
  noMood: { width: Math.round(28 * textScaleFactor), alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  meta: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  highlight: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.medium, marginTop: spacing.xs },
  symptoms: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
  contextTags: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
  // What was written is the entry, so it reads in the primary text colour at body
  // size, not as a dim footnote under the faces.
  note: { fontSize: font.md, color: colors.text, marginTop: spacing.xs },
});
