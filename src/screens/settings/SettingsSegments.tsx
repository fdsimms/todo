import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useColors } from '../../theme/ThemeContext';
import { makeSettingsStyles } from './settingsStyles';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl';

interface Props<T> {
  options: SegmentOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  /** Spoken label per option; without it a screen reader gets the bare word. */
  accessibilityLabelFor?: (option: SegmentOption<T>) => string;
  /**
   * Set when the control sits directly under its own label row, so the two read
   * as one field rather than as a row and a separate strip.
   */
  attached?: boolean;
  /** Passed through — for a set whose labels won't fit across one row. */
  columns?: number;
  /** Names the group for screen readers, when no label row sits above it. */
  label?: string;
}

/**
 * A settings row's segmented control, in the padding the surrounding card
 * expects.
 *
 * This used to be `SettingsPills`, which drew its *own* segmented control —
 * equal-width cells, `accent + '22'` fill, accent border — months before
 * `SegmentedControl` existed (#1486). Two treatments for the one job is the
 * drift #1497 exists to end, so the look is now the app's single one and this
 * file is only the padding. The border that treatment is documented for (the
 * cue that survives grayscale accessibility mode) is not lost: the raised
 * segment carries a surface change and a shadow, neither of which is a hue.
 *
 * An *open* set the user builds — their own categories — is not this control
 * and never was: it's `PillGroup`, which caps and filters instead of squeezing
 * fifteen names into fifteen columns.
 */
export function SettingsSegments<T extends string | number | boolean | null>({
  options, selected, onSelect, accessibilityLabelFor, attached, columns, label,
}: Props<T>) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const labelled = useMemo(
    () => (accessibilityLabelFor
      ? options.map(o => ({ ...o, accessibilityLabel: accessibilityLabelFor(o) }))
      : options),
    [options, accessibilityLabelFor],
  );

  return (
    <View style={[styles.segmentRow, attached && styles.segmentRowAttached]}>
      <SegmentedControl
        options={labelled}
        value={selected}
        onChange={onSelect}
        columns={columns}
        label={label}
      />
    </View>
  );
}
