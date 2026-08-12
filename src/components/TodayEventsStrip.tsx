import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BusyEvent } from '../utils/calendarBusy';
import { nextEventAfter } from '../utils/calendarBusy';
import { formatTimeOfDay } from '../utils/dateUtils';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  /** Today's live events, in start order — see eventsIn. */
  events: BusyEvent[];
  /** End of today's logical day, for finding what's next. */
  dayEnd: Date;
  onOpen: () => void;
}

/**
 * The day's calendar in one line (#1489).
 *
 * Same shape as `TodayMealStrip` (#1402), for the same reason: Today has no
 * business rendering anything that reads as a calendar of its own, so this
 * says only what's on the day and how much — `3 events · next: Standup 10:00`
 * — and gets out of the way. Tapping it opens `TodayEventsSheet`, a plain list
 * with the time and any other detail EventKit has (location) for whoever wants
 * more than the headline.
 *
 * Silent by construction: the caller only renders this once `calendarReadEnabled`
 * is on, the read has succeeded, and there's at least one event today — the
 * same discipline `tripMarkerFor` uses. There is no empty or loading state here
 * because there is nothing to say about either.
 */
export function TodayEventsStrip({ events, dayEnd, onOpen }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (events.length === 0) return null;

  const count = events.length;
  const countLabel = `${count} event${count === 1 ? '' : 's'}`;
  const next = nextEventAfter(events, new Date(), dayEnd);
  const nextLabel = next
    ? `next: ${next.title || 'Event'} ${formatTimeOfDay(new Date(next.start))}`
    : null;

  return (
    <TouchableOpacity
      style={styles.strip}
      onPress={() => { haptics.tap(); onOpen(); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`Today's calendar: ${countLabel}${nextLabel ? `, ${nextLabel}` : ''}`}
      accessibilityHint="Opens the day's events"
    >
      <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={styles.text} numberOfLines={1}>
        <Text style={styles.count}>{countLabel}</Text>
        {nextLabel && ` · ${nextLabel}`}
      </Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // bgSunken, matching the meal strip's tray — a recessed region rather than a
  // card, so it doesn't read as one more (selected-looking) row above the list.
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
  },
  text: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.md,
  },
  count: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
});
