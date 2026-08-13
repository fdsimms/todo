import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContextRow } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, fontWeight, iconSize, interaction, type Colors } from '../theme';
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
 * **It is styled as an ordinary task row, and the glyph is the only tell.**
 * Card surface, card margins, card shadow, `TaskItem`'s own paddings, a
 * full-strength title, and the caption carried as a meta chip under it exactly
 * where a task reports its category or its time. The one substitution is at the
 * leading edge: the checkbox is replaced, in the same 24pt column, by a
 * calendar or fork-and-knife glyph. Nothing here is actionable and nothing
 * pretends to be — there is simply no visual argument being made about that.
 *
 * This reverses the original treatment, which was deliberately card-less on the
 * grounds that a glance should separate what you can act on from what's merely
 * true about the day. In use that isn't what it did: a run of bare rows between
 * inset cards reads as a *different list* wedged into this one, and the seam is
 * loudest in exactly the section that has most of them (Meals). Blending in
 * costs the at-a-glance distinction and buys back one list.
 *
 * Two things that predate this and still hold:
 *
 * - **The icon sits *in* the checkbox column rather than beside it** (hence the
 *   left margin matching a card's own), so every title on the screen starts at
 *   the same x. Getting that wrong is what made the first mock read as two
 *   lists interleaved — and it matters more now, not less, since the card no
 *   longer signals which kind of row this is.
 * - **It carries no `SelectionDot`**, which is what makes it inert during a
 *   bulk edit: that control's design is that every *eligible* row grows an
 *   empty ring the moment selection starts, so a row without one is already
 *   saying it isn't part of this. Nothing else had to learn about these rows —
 *   `useTaskSelection` is keyed by task id, and `PaintSelection`'s registry
 *   only ever holds rows that registered themselves.
 *
 * The one alternative still rejected is a **quiet card** — card surface at
 * reduced opacity, or on a dimmer background. That reads as a disabled or
 * already-completed task, which is a worse thing to be mistaken for than a
 * plain one. If these need to recede again, it isn't by half-drawing the card.
 */
export function DayContextRow({ row, onPress }: Props) {
  const { colors, shadows } = useTheme();
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
      <View style={styles.content}>
        <Text style={[styles.title, row.now && styles.titleNow]} numberOfLines={1}>
          {row.title}
        </Text>
        {/* One meta chip, shaped like TaskItem's. Every caption these rows can
            carry says *when* — "4:15 PM", "All day", "Now", "Lunch" — so one
            clock covers all four, and it's the glyph the row's own time-ish
            meta would use if it were a task. */}
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons
              name="time-outline"
              size={iconSize.xs}
              color={row.now ? colors.accent : colors.textTertiary}
            />
            <Text style={[styles.caption, row.now && styles.captionNow]} numberOfLines={1}>
              {row.caption}
            </Text>
          </View>
        </View>
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[styles.card, shadows.card]}
        accessible
        accessibilityLabel={`${row.title}, ${row.caption}`}
      >
        <View style={styles.row}>{body}</View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, shadows.card]}
      onPress={() => { haptics.tap(); onPress(); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.caption}`}
      accessibilityHint={row.kind === 'event' ? "Opens the day's events" : 'Opens Meal plan'}
    >
      <View style={styles.row}>{body}</View>
    </TouchableOpacity>
  );
}

// Every number below is TaskItem's, and that's the point — they're duplicated
// rather than exported because this row is *shaped like* a task rather than
// built from one, and a shared style object would be the first step towards
// giving it the rest of TaskItem's behaviour.
const makeStyles = (colors: Colors) => StyleSheet.create({
  // TaskItem.itemWrapper. No cardClip counterpart: nothing here slides sideways
  // over a swipe panel, so there is nothing to clip and the radius can sit on
  // the card itself.
  card: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  // TaskItem.row.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingRight: spacing.md,
  },
  // Matches a task row's checkbox column exactly — spacing.md of card padding
  // plus the 24pt box — so every title on the list starts at the same x. This
  // is now the only thing telling these rows apart from their neighbours, so
  // it's also the only place the difference is allowed to show.
  slot: {
    width: 24,
    marginLeft: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
  },
  // The one emphasis in the treatment, and only while an event is actually
  // running — see ContextRow.now. Weight only: the title is already at full
  // strength now that the row is a card, so the colour has nowhere left to go.
  titleNow: {
    fontWeight: fontWeight.medium,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  caption: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
  },
  captionNow: {
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
});
