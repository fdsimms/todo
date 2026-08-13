import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContextRow } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, fontWeight, border, iconSize, interaction, checkboxRadius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  row: ContextRow;
  /** Opens the day's events, or the meal plan. Omit for a row with nowhere to go. */
  onPress?: () => void;
  /**
   * Marks the meal cooked. Meal rows only — an event is EventKit's row and this
   * app only reads it, so there is nothing here to tick. Omit and the glyph goes
   * back to being a plain glyph.
   */
  onMarkCooked?: () => void;
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
 * calendar or fork-and-knife glyph.
 *
 * This reverses the original treatment, which was deliberately card-less on the
 * grounds that a glance should separate what you can act on from what's merely
 * true about the day. In use that isn't what it did: a run of bare rows between
 * inset cards reads as a *different list* wedged into this one, and the seam is
 * loudest in exactly the section that has most of them (Meals). Blending in
 * costs the at-a-glance distinction and buys back one list.
 *
 * **A meal's glyph is a button, and it's drawn as one** — the fork and knife
 * sits inside a rounded box borrowed from the checkbox (`checkboxRadius`,
 * `border.md`, `bgQuaternary`; see GLYPH_BOX_SIZE for the one number that
 * differs) in the column the checkbox would have used. An event's does not, and
 * that split is the rule: the leading control says whether the row is yours to
 * finish.
 * The row used to state flatly that nothing here was actionable, which was true
 * of an event and never really true of a meal — a leftover or a takeaway
 * planned for tonight is a thing you do, and the only place to tick it off was
 * the Meal plan screen. A bare glyph is not something anyone taps, so the
 * border is what makes the capability findable rather than a secret.
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
 *   only ever holds rows that registered themselves. A tickable glyph doesn't
 *   change that: ticking one meal is not being selected for a bulk edit, and
 *   Today's bulk bar acts on tasks.
 *
 * The card is a plain `View` with **two touchables side by side** rather than
 * one wrapping the other, copied from `TaskItem` for its reason as much as its
 * look: a `TouchableOpacity` is `accessible` by default, so a nested button is
 * swallowed into the parent's label and VoiceOver never offers it. The leading
 * gutter belongs to the glyph (its `hitSlop` reaches the card edge) and the
 * content drops its own left slop so it can't win that back — later sibling,
 * so hit-testing reaches it first.
 *
 * The one alternative still rejected is a **quiet card** — card surface at
 * reduced opacity, or on a dimmer background. That reads as a disabled or
 * already-completed task, which is a worse thing to be mistaken for than a
 * plain one. If these need to recede again, it isn't by half-drawing the card.
 */
export function DayContextRow({ row, onPress, onMarkCooked }: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const glyphName = row.kind === 'event' ? 'calendar-outline' : 'restaurant-outline';

  const leading = onMarkCooked ? (
    <TouchableOpacity
      style={styles.slot}
      onPress={() => { haptics.success(); onMarkCooked(); }}
      activeOpacity={interaction.activeOpacity}
      hitSlop={{ top: 12, bottom: 12, left: spacing.md, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={`Mark ${row.title} cooked`}
    >
      <View style={styles.glyphBox}>
        <Ionicons name={glyphName} size={GLYPH_SIZE} color={colors.textSecondary} />
      </View>
    </TouchableOpacity>
  ) : (
    <View style={styles.slot}>
      <Ionicons name={glyphName} size={iconSize.sm} color={colors.textTertiary} />
    </View>
  );

  const body = (
    <>
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
    </>
  );

  return (
    <View style={[styles.card, shadows.card]}>
      <View style={styles.row}>
        {leading}
        {onPress ? (
          <TouchableOpacity
            style={styles.content}
            onPress={() => { haptics.tap(); onPress(); }}
            activeOpacity={interaction.activeOpacity}
            // TaskItem.content's slop, and deliberately 0 on the left for its
            // reason — that gap is the glyph's.
            hitSlop={{ top: 14, bottom: 14, left: 0, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}, ${row.caption}`}
            accessibilityHint={row.kind === 'event' ? "Opens the day's events" : 'Opens Meal plan'}
          >
            {body}
          </TouchableOpacity>
        ) : (
          <View style={styles.content} accessible accessibilityLabel={`${row.title}, ${row.caption}`}>
            {body}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * The tickable glyph's box, and the glyph inside it.
 *
 * 22 rather than TaskItem's 20, and the glyph well under `iconSize.sm`: a
 * checkbox is empty, and `restaurant-outline` is a detailed glyph that closes
 * up against a border it's within 2pt of — at 20/16 the fork and knife is a
 * smudge. 22 is the largest box the 24pt column takes and still reads as the
 * checkbox's sibling rather than as something louder than the tasks around it;
 * 13 is what leaves even clearance inside it. Both are literals for the reason
 * TaskItem's own in-box glyphs are (12pt checkmark in a 20pt circle) — a size
 * chosen against one specific box isn't a scale step.
 */
const GLYPH_BOX_SIZE = 22;
const GLYPH_SIZE = 13;

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
  // TaskItem.circle, minus the states a checkbox has and this doesn't: there is
  // no half-done meal, and a cooked one leaves the list rather than filling in.
  glyphBox: {
    width: GLYPH_BOX_SIZE,
    height: GLYPH_BOX_SIZE,
    borderRadius: checkboxRadius(GLYPH_BOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
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
