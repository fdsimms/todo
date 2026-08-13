import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContextRow } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, lineHeight, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  row: ContextRow;
  /** Opens the day's events, or the meal plan. Omit for a row with nowhere to go. */
  onPress?: () => void;
}

/**
 * A row on Today that isn't a task — a calendar event, or a meal with no cook
 * task behind it (#1571).
 *
 * **The absence of the card is the whole treatment.** Every task on this screen
 * is an inset-grouped card with a checkbox at its leading edge; this is neither,
 * so a glance down the list separates what you can act on from what's merely
 * true about the day, with no dimming, no second surface and no badge. Two
 * alternatives were drawn and both failed for the same reason — a *quiet card*
 * (card surface, no checkbox, reduced opacity) reads as a disabled or
 * already-completed task, which is worse than reading as a different thing, and
 * a *time-led* layout put the caption in a left-hand column that no task row
 * shares, so the list grew a second ragged left edge.
 *
 * It carries no `SelectionDot` for the same reason it carries no checkbox, and
 * that is what makes it inert during a bulk edit: `SelectionDot`'s design is
 * that every *eligible* row grows an empty ring the moment selection starts, so
 * a row without one is already saying it isn't part of this. Nothing else had
 * to learn about these rows — `useTaskSelection` is keyed by task id, and
 * `PaintSelection`'s registry only ever holds rows that registered themselves.
 *
 * The icon sits *in* the checkbox column rather than beside it (hence the
 * left padding matching a card's own), so titles line up down the list. Getting
 * that wrong is what made the first mock read as two lists interleaved.
 */
export function DayContextRow({ row, onPress }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const body = (
    <>
      <View style={styles.slot}>
        <Ionicons
          name={row.kind === 'event' ? 'calendar-outline' : 'restaurant-outline'}
          size={iconSize.sm}
          color={colors.textTertiary}
        />
      </View>
      <Text style={[styles.title, row.now && styles.titleNow]} numberOfLines={1}>
        {row.title}
      </Text>
      <Text style={[styles.caption, row.now && styles.captionNow]}>{row.caption}</Text>
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${row.title}, ${row.caption}`}>
        {body}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => { haptics.tap(); onPress(); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.caption}`}
      accessibilityHint={row.kind === 'event' ? "Opens the day's events" : 'Opens Meal plan'}
    >
      {body}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // No background of its own: it sits on the page, between cards that have one.
  // The vertical padding is a little under a task row's, so a run of these
  // reads as lighter than the rows around them without going ragged.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingVertical: 9,
    paddingRight: spacing.md,
  },
  // Matches a task row's checkbox column exactly — spacing.md of card padding
  // plus the 24pt box — so every title on the list starts at the same x.
  slot: {
    width: 24,
    marginLeft: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  // The one emphasis in the treatment, and only while an event is actually
  // running — see ContextRow.now.
  titleNow: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  caption: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  captionNow: {
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
});
