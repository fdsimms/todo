import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

export interface SegmentOption<T> {
  value: T;
  label: string;
  /** Ionicons glyph, for the option sets that carry one. */
  icon?: string;
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
   */
  columns?: number;
  /** Names the group for screen readers: "Repeats". */
  label?: string;
}

/**
 * Pick exactly one of a small, closed set — the repeat type, the end mode,
 * priority, effort.
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
 * accessibility mode as well as `SettingsPills`' border does, and it leaves the
 * accent to mean "you can change this" the way it does everywhere else.
 */
export function SegmentedControl<T extends string | number | boolean | null>({
  options, value, onChange, columns, label,
}: Props<T>) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // A cell in an N-column grid, less the gap it shares with its neighbours.
  const cellStyle = columns
    ? { flexBasis: `${100 / columns}%` as const, flexGrow: 0, flexShrink: 0 }
    : undefined;

  return (
    <View
      style={[styles.track, !!columns && styles.trackWrapped]}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            style={[
              styles.segment,
              cellStyle,
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
            <Text
              style={[styles.segmentText, selected && styles.segmentTextSelected]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) => StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  // `gap` alone would leave the rows touching; the row gap has to match it.
  trackWrapped: { flexWrap: 'wrap', rowGap: 2 },
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
  segmentText: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  segmentTextSelected: { color: colors.text, fontWeight: fontWeight.semibold },
});
