import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { segmentRows } from '../utils/segmentColumns';

export interface SegmentOption<T> {
  value: T;
  label: string;
  /** Ionicons glyph, for the option sets that carry one. */
  icon?: string;
  /**
   * A colour swatch before the label, on *every* segment rather than only the
   * chosen one — priority, whose colour is information (it's the same dot the
   * task row shows) and not decoration. Filling the selected segment with it
   * instead was the old pill treatment, and it says the colour only once you've
   * already picked: you could never see that Urgent is red without choosing it.
   */
  dot?: string;
  /** Spoken label, when the visible one is too terse to read aloud ("2nd"). */
  accessibilityLabel?: string;
  /**
   * Dimmed and unpressable. For an option that exists but isn't available yet
   * — the chain editor's "On the next repeat" with no repeat set. Shown rather
   * than dropped, so the choice, and what unlocks it, stay visible.
   */
  disabled?: boolean;
}

interface Props<T> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * Lay the segments out as this many equal-width columns instead of one row.
   * For a set whose labels won't fit across the screen — four options where one
   * of them is "Same day as due date".
   *
   * Explicit rather than measured: a control that decides its own shape from
   * text metrics reflows when the theme's font changes, and there are only ever
   * a handful of these sets. Wrapping *ragged* (each segment its natural width)
   * is the thing this exists to avoid — that's a row of pills again, just
   * inside a box.
   *
   * The rows are built by `segmentRows`, not by wrapping one flex line; see
   * that module for why a percentage-width cell can't make this grid.
   */
  columns?: number;
  /** Names the group for screen readers: "Repeats". */
  label?: string;
  /**
   * Which surface the track sits on. `card` (the default) is inside a
   * `bgSecondary` card or sheet, where `bgTertiary` reads as a step down.
   * `page` is straight onto `colors.bg`, where in the light theme those two are
   * a shade apart and the track all but disappears — the reason this control
   * used to be unusable outside a card. Same distinction `InlineAction` and
   * `PillGroup` already draw, and it only changes the light theme: on either
   * dark palette `bgTertiary` stands off the page perfectly well.
   */
  surface?: 'page' | 'card';
}

/**
 * Pick exactly one of a small, closed set — the task's kind, the repeat type,
 * the end mode, priority.
 *
 * The distinction it draws is the one the app kept losing: **a closed
 * single-choice set is one control, and an open or multi-select set is many.**
 * Rendered as free-width pills, four options read as four objects, so an
 * editor holding four such rows reads as sixteen things to consider rather
 * than four questions to answer — which is what made these sheets hard to
 * scan. A bounded track with equal segments reads as one field whatever it
 * contains.
 *
 * So: reach for this whenever the options are fixed and exactly one is chosen.
 * Keep pills (or `PillGroup`) for the other two jobs — a set the user builds
 * themselves (tags, categories, aisles), and a set where several can be on at
 * once (weekdays, time-of-day segments). Those genuinely are many objects, and
 * a weekday row sitting next to one of these should look different from it.
 *
 * The selected segment is *raised* rather than filled with the accent: a row of
 * these otherwise puts a saturated blue blob at a random horizontal position in
 * every row, which is most of the noise. Elevation survives grayscale
 * accessibility mode as well as a border does, and it leaves the accent to mean
 * "you can change this" the way it does everywhere else.
 *
 * Four things the #1497 sweep looked at and deliberately left as pills. They're
 * here so the next one doesn't have to re-derive them:
 *
 * - **Effort.** Eight options, each a name over a duration ("M" / "~1-2hr"),
 *   plus a Custom that opens a number pad. A segment is one line of text by
 *   construction, and a 4×2 grid of two-line cells is the pill grid it would
 *   have replaced. It stays pills.
 * - **A row of *presets* beside a free input** — quick add's timer minutes, the
 *   link-app shortcuts above a URL field. The set on screen isn't the set of
 *   possible values, so no segment can be the current one; a preset is a
 *   shortcut, and shortcuts are objects.
 * - **A filter over a list** (the meal-type row in `SuggestMealsSheet`). It
 *   narrows what's on screen rather than setting a value on anything, "All" is a
 *   reset and not a value, and which options exist depends on the user's data.
 *   The app's other filter rows are pills; one track among them would be the
 *   drift, not the fix.
 * - **A unit beside a `CountStepper`** (the nudge cadence's Days/Weeks/Months).
 *   It has a state no track can show — *no* unit lit, which is how "Never"
 *   reads — and it sits inline next to the stepper rather than owning a row.
 *
 * It assumed a card or sheet surface until #1669: `bgTertiary` against a light
 * theme's `bg` is nearly invisible, which is what kept it out of the one place
 * a lens switch belongs — straight under a screen's header. `surface="page"`
 * is that fix, and it's why the meal plan's By day / Whole week switch can be a
 * track rather than a second row of pills under the hub's own. `RecipeScaleChips`
 * — the factor row that note named — is still pills and is now unblocked rather
 * than settled: #1786 holds the question, including whether the `CountStepper`
 * it's paired with is its own reason to stay a chip row.
 */
export function SegmentedControl<T extends string | number | boolean | null>({
  options, value, onChange, columns, label, surface = 'card',
}: Props<T>) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark, surface), [colors, isDark, surface]);

  const renderSegment = (opt: SegmentOption<T>) => {
    const selected = opt.value === value;
    return (
      <TouchableOpacity
        key={String(opt.value)}
        style={[
          styles.segment,
          selected && styles.segmentSelected,
          opt.disabled && styles.segmentDisabled,
        ]}
        onPress={() => {
          if (selected) return;
          haptics.tap();
          onChange(opt.value);
        }}
        disabled={opt.disabled}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled: opt.disabled }}
        accessibilityLabel={opt.accessibilityLabel ?? opt.label}
      >
        {!!opt.icon && (
          <Ionicons
            name={opt.icon as never}
            size={iconSize.sm}
            color={selected ? colors.text : colors.textSecondary}
          />
        )}
        {!!opt.dot && <View style={[styles.dot, { backgroundColor: opt.dot }]} />}
        <Text
          style={[styles.segmentText, selected && styles.segmentTextSelected]}
          numberOfLines={1}
        >
          {opt.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      style={[styles.track, !!columns && styles.trackGrid]}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {columns
        ? segmentRows(options, columns).map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((opt, j) => (
                opt ? renderSegment(opt) : <View key={`gap-${j}`} style={styles.segment} />
              ))}
            </View>
          ))
        : options.map(renderSegment)}
    </View>
  );
}

const makeStyles = (colors: Colors, isDark: boolean, surface: 'page' | 'card') => StyleSheet.create({
  track: {
    flexDirection: 'row',
    // On a light page the track steps *down* rather than up: nothing sits above
    // `bgSecondary` in that palette, so a lighter track would leave the raised
    // segment below with no surface of its own to be raised onto.
    backgroundColor: !isDark && surface === 'page' ? colors.bgSunken : colors.bgTertiary,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  // In grid mode the track stacks its rows; each row lays its own cells out.
  trackGrid: { flexDirection: 'column' },
  row: { flexDirection: 'row', gap: 2 },
  segment: {
    flex: 1,
    // Not `minTouchTarget`: a segment is wide, and a stack of 44pt tracks turns
    // an editor into a scroll. 32 + the track's 2pt padding is `pillHeight`,
    // so a track and the weekday circles beside it are the same height.
    minHeight: interaction.pillHeight - 4,
    minWidth: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  /**
   * Raised, not accent-filled. In light the card colour reads as lifted off
   * the track; in dark that's the *page* colour and would read as a hole, so
   * it takes the one surface above `bgTertiary` instead.
   */
  segmentSelected: {
    backgroundColor: isDark ? colors.bgQuaternary : colors.bgSecondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.35 : 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  segmentDisabled: { opacity: 0.4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  segmentText: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  segmentTextSelected: { color: colors.text, fontWeight: fontWeight.semibold },
});
